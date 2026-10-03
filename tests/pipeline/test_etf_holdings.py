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

COLS = ["date", "etf", "code", "name", "shares", "weight", "units"]


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
    # §3.4 受益權單位數：FundAsset.Units（Aum ÷ Units ＝ Nav 25.68）
    assert set(res.df["units"]) == {786230000.0}
    nodata = eh.parse_nomura(sample("etf_nomura_nodata.json"), "00980A")
    assert nodata.no_data and nodata.df.empty and "尚無" in nodata.message


def test_capital_uses_nav_date_and_fund_map():
    assert eh.parse_capital_items(sample("etf_capital_items.json"))["00982A"] == "399"
    res = eh.parse_capital(sample("etf_capital_399.json"), "00982A")
    # 申購買回清單適用日 date1＝2026-09-24；持股（淨值）日 date2＝2026-09-23
    assert res.response_date == date(2026, 9, 23)
    row = res.df.set_index("code").loc["2330"]
    assert (row["name"], row["shares"], row["weight"]) == ("台積電", 1794000.0, 8.8243)
    assert row["units"] == 2191436000.0  # pcf.totUnit（nav ÷ totUnit ＝ pUnit 23.19）
    assert eh.parse_capital(sample("etf_capital_nodata.json"), "00982A").no_data


def test_yuanta_keeps_only_taiwan_listed():
    res = eh.parse_yuanta(sample("etf_yuanta_00990A.json"), "00990A")
    assert res.response_date == date(2026, 9, 22)  # PCF.trandate（公告日 2026-09-24）
    assert list(res.df["code"]) == ["2454", "2308", "2330", "2383"]
    assert not any(" " in c for c in res.df["code"])  # 美股（如 LITE US）略過
    assert set(res.df["units"]) == {2361522000.0}  # PCF.osunit（trandate 當日；preunit 是下一日預估，不用）
    assert eh.parse_yuanta(sample("etf_yuanta_nodata.json"), "00990A").no_data


def test_fubon_html():
    res = eh.parse_fubon(sample("etf_fubon_00405A.html"), "00405A")
    assert res.response_date == date(2026, 9, 24)
    assert len(res.df) == 6
    row = res.df.set_index("code").loc["3037"]
    assert (row["name"], row["shares"], row["weight"]) == ("欣興", 1720000.0, 7.7218)
    assert res.df["units"].isna().all()  # 舊樣本裁切時沒有保留單位數區塊 → 空值，不是錯誤
    # §3.4：「基金在外流通單位數(單位)」（淨資產 25,894,314,148 ÷ 2,727,745,000 ＝ 每單位淨值 9.49）
    live = eh.parse_fubon(sample("etf_fubon_00405A_20261002.html"), "00405A")
    assert live.response_date == date(2026, 10, 2) and len(live.df) == 6
    assert set(live.df["units"]) == {2727745000.0}
    assert live.df.set_index("code").loc["3037", "shares"] == 2020000.0
    with pytest.raises(ParseError):
        eh.parse_fubon("<html>維護中</html>", "00405A")


def test_cathay_uses_query_date():
    assert eh.parse_cathay_list(sample("etf_cathay_list.json")) == {"00400A": "EA"}
    res = eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", date(2026, 9, 24))
    assert res.response_date == date(2026, 9, 24)
    assert res.df.iloc[0]["shares"] == 1034000.0 and res.df.iloc[0]["weight"] == 8.75
    assert res.df["units"].isna().all()  # 國泰端點沒有單位數
    assert eh.parse_cathay(sample("etf_cathay_nodata.json"), "00400A", date(2026, 9, 26)).no_data


def test_taishin_html_uses_nav_label_and_bloomberg_codes():
    # 查詢 DataDate（適用日）2026-10-02 → 頁面「2026/10/1預估發行受益權單位數」＝清單製作時的淨值日
    res = eh.parse_taishin(sample("etf_taishin_00986A.html"), "00986A")
    assert res.response_date == date(2026, 10, 1)
    assert list(res.df.columns) == COLS
    # 彭博代碼「2330 TT」去掉 TT；海外持股（NVDA US、GOOGL US…）不列入
    assert list(res.df["code"]) == ["2330"]
    row = res.df.iloc[0]
    assert (row["name"], row["shares"], row["weight"]) == ("台積電", 18000.0, 7.6628)
    assert row["units"] == 39327000.0  # 「已發行受益權單位總數」（淨資產 ÷ 單位數 ＝ 14.81）
    # 查無資料：版面仍在、日期 0001/1/1、沒有「預估發行受益權單位數」列
    nodata = eh.parse_taishin(sample("etf_taishin_nodata.html"), "00986A")
    assert nodata.no_data and nodata.df.empty
    with pytest.raises(ParseError):
        eh.parse_taishin(sample("etf_taishin_00986A.html"), "00987A")  # 頁面 ETF_ID 與查詢不符


def test_kgi_partial_html_unescapes_entities():
    # 適用日 2026/10/05 的清單；持股日＝「(2026/10/02)每受益權單位淨資產價值」
    res = eh.parse_kgi(sample("etf_kgi_J024.html"), "00407A")
    assert res.response_date == date(2026, 10, 2)
    assert list(res.df["code"]) == ["2330", "3037", "2454", "3017", "2383", "2412"]  # 含 display:none 的「看更多」列
    row = res.df.set_index("code").loc["3037"]  # 原始儲存格「3037  」帶尾端空白
    assert (row["name"], row["shares"], row["weight"]) == ("欣興", 1150000.0, 6.40)
    assert row["units"] == 2272739000.0  # 「已發行受益權單位總數」（HTML 實體還原後）
    assert eh.parse_kgi("<div>查無資料</div>", "00407A").no_data


def test_ab_isin_and_equity_section():
    for code, isin in (
        ("00404A", "TW00000404A5"),
        ("00980D", "TW00000980D8"),
        ("00984D", "TW00000984D0"),
        ("00994A", "TW00000994A5"),
    ):
        assert eh.isin_of(code) == isin  # 官網連結與第一金頁面上的實際 ISIN
    res = eh.parse_ab(sample("etf_ab_TW00000404A5.json"), "00404A")
    assert res.response_date == date(2026, 10, 2)  # asOfDate "10/02/2026"
    assert list(res.df["code"]) == ["6515", "2301", "3034", "7769"]  # 期貨、選擇權段不列入
    row = res.df.set_index("code").loc["3034"]
    assert (row["name"], row["shares"], row["weight"]) == ("聯詠科技", 160000.0, 1.991489)
    assert res.df["units"].isna().all() and eh.UNITS_FIELD["ab"] is None  # 聯博沒有揭露單位數
    assert eh.parse_ab(b'{"domesticHoldings": []}', "00404A").no_data


def test_fsitc_webmethod_nested_json():
    res = eh.parse_fsitc(sample("etf_fsitc_183.json"), "00408A")
    assert res.response_date == date(2026, 10, 2)  # sdate（查詢日 10/03 無參數＝最新）
    assert list(res.df["code"]) == ["2330", "2454", "3037", "6669"]  # group 4（現金）、5（配置摘要）不列入
    row = res.df.iloc[0]
    assert (row["name"], row["shares"], row["weight"]) == ("台積電", 33998.0, 5.65)  # D 股數、C 權重
    assert eh.parse_fsitc(b'{"d": null}', "00408A").no_data
    assert res.df["units"].isna().all()  # Get_hd 沒有單位數；由 Get_BuySellA 另取（見 fetcher 測試）
    assert eh.parse_fsitc_units(sample("etf_fsitc_pcf_183.json")) == 139634000.0
    for bad in (b'{"d": null}', b'{"code": 400}', b"<html>", b'{"d": "[]"}'):
        assert eh.parse_fsitc_units(bad) is None


def test_fhtrust_xlsx_stdlib_reader():
    res = eh.parse_fhtrust(sample("etf_fhtrust_ETF26.xlsx"), "00409A")
    assert res.response_date == date(2026, 10, 1)  # 工作表「日期: 2026/10/01」
    codes = list(res.df["code"])
    assert "8046" in codes and codes[-1] == "2360" and not any(" " in c for c in codes)  # LITE US、009150 KS 等海外略過
    row = res.df.set_index("code").loc["8046"]
    assert (row["name"], row["shares"], row["weight"]) == ("南亞電路", 446000.0, 4.078)
    assert row["units"] == 1502948000.0  # 摘要區「基金在外流通單位數」的下一列
    assert len(eh.xlsx_rows(sample("etf_fhtrust_ETF26.xlsx"))) == 60
    nodata = eh.parse_fhtrust(sample("etf_fhtrust_nodata.json"), "00409A")  # HTTP 200 的「查無資料」
    assert nodata.no_data and nodata.df.empty


def test_bad_payload_raises():
    for fn in (
        lambda: eh.parse_nomura(b"<html></html>", "00980A"),
        lambda: eh.parse_capital(b'{"foo": 1}', "00982A"),
        lambda: eh.parse_yuanta(b"[]", "00990A"),
        lambda: eh.parse_cathay(b'{"x": 1}', "00400A", date(2026, 9, 24)),
        lambda: eh.parse_taishin("<html>維護中</html>", "00986A"),
        lambda: eh.parse_kgi("<html>維護中</html>", "00407A"),
        lambda: eh.parse_ab(b'{"x": 1}', "00404A"),
        lambda: eh.parse_fsitc(b'{"x": 1}', "00408A"),
        lambda: eh.parse_fhtrust(b"<html>maintenance</html>", "00409A"),
        lambda: eh.parse_fhtrust(b"PK\x03\x04broken", "00409A"),
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
    assert eh.issuer_of("主動台新龍頭成長", issuers) == "taishin"
    assert eh.issuer_of("主動凱基台灣", issuers) == "kgi"
    assert eh.issuer_of("主動聯博台灣優息", issuers) == "ab"
    assert eh.issuer_of("主動復華未來50", issuers) == "fhtrust"
    assert eh.issuer_of("某某台灣50", issuers) is None
    # 已實作的投信都要有端點；跳過／待處理的都要寫原因
    for iid, cfg in issuers.items():
        if cfg["status"] == "verified":
            assert cfg.get("url"), iid
        else:
            assert cfg["status"] in ("skipped", "pending") and cfg.get("reason"), iid
    # 沒有清單端點的投信：config 的 funds 要涵蓋文件列出的主動式 ETF
    assert set(issuers["kgi"]["funds"]) == {"00407A"}
    assert set(issuers["fsitc"]["funds"]) == {"00408A", "00994A"}
    assert set(issuers["fhtrust"]["funds"]) == {"00409A", "00991A", "00998A"}


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


def test_fetcher_builds_requests_for_new_issuers(tmp_path):
    """台新、凱基、聯博、第一金、復華：查詢日 → 網址／本文的組法，與回應日期（持股日）。"""
    routes = {
        "tsit.com.tw/ETF/Home/Pcf/00986A?FundType=ALL&DataDate=2026-10-02": sample("etf_taishin_00986A.html"),
        "kgifund.com.tw/Fund/RedemptionVC": sample("etf_kgi_J024.html"),
        "investor/TW00000404A5/holdings?date=2026-10-02": sample("etf_ab_TW00000404A5.json"),
        "WebAPI.aspx/Get_hd pStrFundID=183 pStrDate=": sample("etf_fsitc_183.json"),
        "WebAPI.aspx/Get_BuySellA pStrFundID=183 pStrDate=": sample("etf_fsitc_pcf_183.json"),
        "api/assetsExcel/ETF26/20261001": sample("etf_fhtrust_ETF26.xlsx"),
        "api/assetsExcel/ETF26/20261003": sample("etf_fhtrust_nodata.json"),
    }
    ctx = _ctx(tmp_path, routes)
    f = tasks_advanced._EtfFetcher(ctx, config.source("active_etf")["issuers"])
    assert f.fetch("taishin", "00986A", date(2026, 10, 2)).response_date == date(2026, 10, 1)  # 適用日 → 淨值日
    assert f.fetch("kgi", "00407A", date(2026, 10, 5)).response_date == date(2026, 10, 2)
    assert f.fetch("ab", "00404A", date(2026, 10, 2)).response_date == date(2026, 10, 2)
    fs = f.fetch("fsitc", "00408A", None)
    assert fs.response_date == date(2026, 10, 2)  # 不帶日期＝最新
    assert set(fs.df["units"]) == {139634000.0}  # §3.4：同一公告日的申購買回清單摘要（第二個請求）
    assert f.fetch("fhtrust", "00409A", date(2026, 10, 1)).response_date == date(2026, 10, 1)
    assert f.fetch("fhtrust", "00409A", date(2026, 10, 3)).no_data  # 「查無資料」不是錯誤
    assert "funds 沒有" in f.fetch("fhtrust", "00986D", date(2026, 10, 1)).message  # config 沒列的代號不請求
    calls = ctx.client.calls  # type: ignore[attr-defined]
    assert any(c.endswith("RedemptionVC") for c in calls)  # 凱基：POST 表單（本文不在網址）
    assert "https://www.fsitc.com.tw/WebAPI.aspx/Get_hd pStrFundID=183 pStrDate=" in calls  # 第一金：POST JSON
    assert "https://www.fsitc.com.tw/WebAPI.aspx/Get_BuySellA pStrFundID=183 pStrDate=" in calls
    assert not any("00986D" in c for c in calls)


def test_run_replaces_same_day_holdings(tmp_path):
    ctx = _ctx(tmp_path, {})
    old = pd.DataFrame(
        [
            ["2026-09-24", "00400A", "9999", "已賣出", 1000.0, 1.0, None],
            ["2026-09-23", "00400A", "9999", "已賣出", 1000.0, 1.0, None],
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


def test_rows_without_units_are_refetched_for_issuers_that_disclose_units(tmp_path):
    """§3.4：改版前存的持股沒有 units 欄；有揭露單位數的投信（野村）回補時把這些持股日視為缺漏重抓，
    沒有揭露單位數的投信（聯博、國泰）不重抓。"""
    ctx = _ctx(tmp_path, {"GetFundAssets FundID=00980A SearchDate=2026-09-24": sample("etf_nomura_00980A.json")})
    old = eh.parse_nomura(sample("etf_nomura_00980A.json"), "00980A").df.drop(columns=["units"])
    ctx.store.write("etf_holdings", date(2026, 9, 1), old)
    tasks_advanced.run_etf_holdings(ctx, date(2026, 9, 24), days=[date(2026, 9, 24)])
    calls = ctx.client.calls  # type: ignore[attr-defined]
    assert any("SearchDate=2026-09-24" in c for c in calls)
    h = ctx.store.read_range("etf_holdings")
    assert set(h.loc[h["etf"] == "00980A", "units"]) == {786230000.0}
    ctx.client.calls.clear()  # type: ignore[attr-defined]
    tasks_advanced.run_etf_holdings(ctx, date(2026, 9, 24), days=[date(2026, 9, 24)])
    assert not any("SearchDate=2026-09-24" in c for c in ctx.client.calls)  # type: ignore[attr-defined]
