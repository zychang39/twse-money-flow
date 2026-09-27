"""主動式 ETF 持股：各投信真實樣本的解析、投信判定、每日任務（假客戶端回放）。"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import pytest

from pipeline import tasks, tasks_advanced
from pipeline.core import config
from pipeline.core.dates import TPE
from pipeline.core.http import FetchError
from pipeline.core.store import DataStore
from pipeline.derive import etf as etfmod
from pipeline.registry import SPECS
from pipeline.sources import etf_holdings as eh
from pipeline.sources.base import ParseError
from tests.pipeline.conftest import sample

COLS = ["date", "etf", "code", "name", "shares", "weight"]


def test_nomura():
    res = eh.parse_nomura(sample("etf_nomura_00980A.json"), "00980A")
    assert res.response_date == date(2026, 9, 24)
    assert list(res.df.columns) == COLS
    first = res.df.iloc[0]
    assert (first["code"], first["name"], first["shares"], first["weight"]) == (
        "2330",
        "台灣積體電路製造",
        753000.0,
        9.23,
    )
    assert set(res.df["etf"]) == {"00980A"} and set(res.df["date"]) == {"2026-09-24"}
    # 期貨表（TX）不列入
    assert "TX" not in set(res.df["code"])
    nodata = eh.parse_nomura(sample("etf_nomura_nodata.json"), "00980A")
    assert nodata.no_data and nodata.df.empty and "尚無" in nodata.message


def test_capital_uses_nav_date_and_fund_map():
    assert eh.parse_capital_items(sample("etf_capital_items.json"))["00982A"] == "399"
    res = eh.parse_capital(sample("etf_capital_399.json"), "00982A")
    # 申購買回清單適用日 date1＝2026-09-24；持股（淨值）日 date2＝2026-09-23
    assert res.response_date == date(2026, 9, 23)
    row = res.df.set_index("code").loc["2330"]
    assert (row["name"], row["shares"], row["weight"]) == ("台積電", 1794000.0, 8.8243)
    assert eh.parse_capital(sample("etf_capital_nodata.json"), "00982A").no_data


def test_yuanta_keeps_only_taiwan_listed():
    res = eh.parse_yuanta(sample("etf_yuanta_00990A.json"), "00990A")
    assert res.response_date == date(2026, 9, 22)  # PCF.trandate（公告日 2026-09-24）
    assert list(res.df["code"]) == ["2454", "2308", "2330", "2383"]
    assert not any(" " in c for c in res.df["code"])  # 美股（如 LITE US）略過
    assert eh.parse_yuanta(sample("etf_yuanta_nodata.json"), "00990A").no_data


def test_fubon_html():
    res = eh.parse_fubon(sample("etf_fubon_00405A.html"), "00405A")
    assert res.response_date == date(2026, 9, 24)
    assert len(res.df) == 6
    row = res.df.set_index("code").loc["3037"]
    assert (row["name"], row["shares"], row["weight"]) == ("欣興", 1720000.0, 7.7218)
    with pytest.raises(ParseError):
        eh.parse_fubon("<html>維護中</html>", "00405A")


def test_cathay_uses_query_date():
    assert eh.parse_cathay_list(sample("etf_cathay_list.json")) == {"00400A": "EA"}
    res = eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", date(2026, 9, 24))
    assert res.response_date == date(2026, 9, 24)
    assert res.df.iloc[0]["shares"] == 1034000.0 and res.df.iloc[0]["weight"] == 8.75
    assert eh.parse_cathay(sample("etf_cathay_nodata.json"), "00400A", date(2026, 9, 26)).no_data


def test_bad_payload_raises():
    for fn in (
        lambda: eh.parse_nomura(b"<html></html>", "00980A"),
        lambda: eh.parse_capital(b'{"foo": 1}', "00982A"),
        lambda: eh.parse_yuanta(b"[]", "00990A"),
        lambda: eh.parse_cathay(b'{"x": 1}', "00400A", date(2026, 9, 24)),
    ):
        with pytest.raises(ParseError):
            fn()


def test_issuer_detection_from_config():
    issuers = config.source("active_etf")["issuers"]
    assert eh.issuer_of("主動野村臺灣優選", issuers) == "nomura"
    assert eh.issuer_of("主動群益台灣強棒", issuers) == "capital"
    assert eh.issuer_of("主動元大AI新經濟", issuers) == "yuanta"
    assert eh.issuer_of("主動富邦台灣龍耀", issuers) == "fubon"
    assert eh.issuer_of("主動國泰動能高息", issuers) == "cathay"
    assert eh.issuer_of("主動統一台股增長", issuers) == "uni"
    assert eh.issuer_of("主動中信ARK創新", issuers) == "ctbc"
    assert eh.issuer_of("主動第一金優股息", issuers) == "fsitc"
    assert eh.issuer_of("某某台灣50", issuers) is None
    # 已實作的投信都要有端點；跳過／待處理的都要寫原因
    for iid, cfg in issuers.items():
        if cfg["status"] == "verified":
            assert cfg.get("url"), iid
        else:
            assert cfg["status"] in ("skipped", "pending") and cfg.get("reason"), iid


# ------------------------------------------------------------------ 每日任務
class JsonFakeClient:
    """回放樣本：依網址關鍵字與 JSON 本文回應；記錄每次請求。"""

    def __init__(self, routes: dict[str, bytes | Exception]):
        self.routes = routes
        self.calls: list[str] = []
        self.request_count = 0

    def _hit(self, key: str) -> bytes:
        self.request_count += 1
        self.calls.append(key)
        for k, payload in self.routes.items():
            if k in key:
                if isinstance(payload, Exception):
                    raise payload
                return payload
        return b'{"code":400,"data":null,"message":"not found"}'

    def get_bytes(self, url: str) -> bytes:
        return self._hit(url)

    def post_bytes(self, url: str, data: dict[str, str]) -> bytes:
        return self._hit(url)

    def post_json(self, url: str, body: dict[str, object]) -> bytes:
        return self._hit(url + " " + " ".join(f"{k}={v}" for k, v in body.items()))


def _ctx(tmp_path, routes, now=datetime(2026, 9, 24, 21, 45, tzinfo=TPE)):
    store = DataStore(tmp_path)
    ctx = tasks.RunContext(store=store, client=JsonFakeClient(routes), now=now)  # type: ignore[arg-type]
    ctx.manifest = store.load_manifest()
    store.write("twse_holidays", date(2026, 1, 1), SPECS["twse_holidays"].parse(sample("twse_holidaySchedule.json")).df)
    tasks.load_calendar(ctx, [2026], fetch_missing=False)
    quotes = pd.DataFrame(
        {
            "date": ["2026-09-24"] * 5,
            "code": ["00980A", "00982A", "00400A", "00981A", "2330"],
            "name": ["主動野村臺灣優選", "主動群益台灣強棒", "主動國泰動能高息", "主動統一台股增長", "台積電"],
        }
    )
    store.write("twse_quotes", date(2026, 9, 24), quotes)
    return ctx


def test_run_daily_fetches_supported_issuers_and_heals(tmp_path):
    ctx = _ctx(
        tmp_path,
        {
            "GetFundAssets FundID=00980A SearchDate=2026-09-24": sample("etf_nomura_00980A.json"),
            "GetFundAssets": sample("etf_nomura_nodata.json"),
            "etf/items": sample("etf_capital_items.json"),
            # 群益：持股日 09-23 要查公告日 09-24（lag_days=1）；最新一份（date=None）尚未公布
            "buyback fundId=399 date=2026/09/24": sample("etf_capital_399.json"),
            "buyback": sample("etf_capital_nodata.json"),
        },
    )
    tasks_advanced.run_etf_holdings(ctx, date(2026, 9, 24))
    calls = ctx.client.calls  # type: ignore[attr-defined]
    # 國泰（WAF 擋本工具 User-Agent）、統一（導向循環）依規則跳過：完全不發出請求
    assert not any("cathaysite" in c or "ezmoney" in c for c in calls)
    h = ctx.store.read_range("etf_holdings")
    assert set(h["etf"]) == {"00980A", "00982A"}
    assert sorted(h[h["etf"] == "00982A"]["date"].unique()) == ["2026-09-23"]
    assert sorted(h[h["etf"] == "00980A"]["date"].unique()) == ["2026-09-24"]
    # 持股日 09-24 → 公告日 09-29 還沒到，查最新；09-23 → 查公告日 09-24；09-22 → 查公告日 09-23
    capital = [c.rsplit(" ", 1)[-1] for c in calls if "buyback" in c]
    assert capital[:3] == ["date=None", "date=2026/09/24", "date=2026/09/23"]
    # 野村只有 09-24 → 第一次看到時往回找到 backfill_days 上限為止
    assert len([c for c in calls if "GetFundAssets" in c]) == int(config.source("active_etf")["backfill_days"])
    entry = ctx.manifest["sources"]["active_etf"]
    assert entry["last_status"] == "ok" and entry["last_success"] == "2026-09-24"
    assert "2/4 檔" in entry["last_message"]
    # 再跑一次：已取得的持股日不再請求；往回補只在第一次看到該 ETF 時做（野村只重試最近 3 個交易日中缺的 2 天）
    ctx.client.calls.clear()  # type: ignore[attr-defined]
    tasks_advanced.run_etf_holdings(ctx, date(2026, 9, 24))
    again = ctx.client.calls  # type: ignore[attr-defined]
    assert not any("SearchDate=2026-09-24" in c or "date=2026/09/24" in c for c in again)
    assert len([c for c in again if "GetFundAssets" in c]) == 2


def test_run_replaces_same_day_holdings(tmp_path):
    ctx = _ctx(tmp_path, {})
    old = pd.DataFrame(
        [
            ["2026-09-24", "00400A", "9999", "已賣出", 1000.0, 1.0],
            ["2026-09-23", "00400A", "9999", "已賣出", 1000.0, 1.0],
        ],
        columns=COLS,
    )
    ctx.store.write("etf_holdings", date(2026, 9, 1), old)
    new = eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", date(2026, 9, 24)).df
    tasks_advanced._replace_holdings(ctx, new)
    h = ctx.store.read_range("etf_holdings")
    assert "9999" not in set(h[h["date"] == "2026-09-24"]["code"])  # 同日整批取代
    assert "9999" in set(h[h["date"] == "2026-09-23"]["code"])  # 其他日期保留


def test_run_all_failed_is_failed_and_stops_on_4xx(tmp_path):
    ctx = _ctx(tmp_path, {"GetFundAssets": FetchError("HTTP 403：x"), "etf/items": FetchError("HTTP 503：y")})
    tasks_advanced.run_etf_holdings(ctx, date(2026, 9, 24))
    calls = ctx.client.calls  # type: ignore[attr-defined]
    # 4xx 或基金清單取不到 → 本輪不再請求該投信
    assert len([c for c in calls if "GetFundAssets" in c]) == 1
    assert len([c for c in calls if "etf/items" in c]) == 1 and not any("buyback" in c for c in calls)
    entry = ctx.manifest["sources"]["active_etf"]
    assert entry["last_status"] == "failed" and "HTTP 403" in entry["last_message"]


def test_changes_and_ranking_from_parsed_samples():
    a = eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", date(2026, 9, 23)).df
    b = eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", date(2026, 9, 24)).df
    b.loc[b["code"] == "2330", "shares"] += 50000
    ch = etfmod.holdings_changes(pd.concat([a, b], ignore_index=True))
    assert ch.set_index("code").loc["2330", "change_shares"] == 50000
    rk = etfmod.ranking(ch, {"2330": 1000.0})
    assert rk["add"][0]["code"] == "2330"
    # 只有一天（無法計算變化）時不應出錯
    assert etfmod.ranking(etfmod.holdings_changes(a), {}) == {"add": [], "reduce": []}
