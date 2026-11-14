"""興櫃股票行情（DECISIONS #465）：真實樣本的解析、每日任務、歷史回補的接力、另外輸出的前端資料。"""

from __future__ import annotations

import json
from datetime import date, datetime

import pandas as pd

from pipeline import tasks, tasks_advanced
from pipeline.core.dates import TPE
from pipeline.derive import esb as esbmod
from pipeline.sources import esb
from tests.pipeline.conftest import sample
from tests.pipeline.test_tasks import make_ctx

LATEST = "tpex_esb_latest_statistics"
HISTORY = "emerging/historical"


def test_parse_latest_uses_average_and_skips_no_trade():
    res = esb.parse_latest(sample("tpex_esb_latest.json"))
    assert res.response_date == date(2026, 11, 13)
    assert list(res.df.columns) == esb.ESB_COLS
    # 樣本 5 列：2 列當日沒有成交（均價 0）不列入
    assert list(res.df["code"]) == ["1260", "1269", "6930"]
    row = res.df.set_index("code").loc["6930"]
    # 價格＝日均價（興櫃沒有收盤價）；成交金額＝均價 × 成交股數
    assert (row["name"], row["close"], row["high"], row["low"], row["last"]) == ("盛新", 32.59, 33.95, 32.0, 33.0)
    assert row["volume"] == 196279.0 and row["value"] == round(32.59 * 196279)
    assert row["prev"] == 33.3  # 前日均價：還沒回補歷史時，當日漲跌用它算


def test_parse_history_month_and_no_data():
    res = esb.parse_history(sample("tpex_esb_history_6930.json"), "6930", "盛新")
    assert list(res.df.columns) == esb.ESB_COLS and len(res.df) == 10
    first = res.df.iloc[0]
    assert (first["date"], first["close"], first["high"], first["low"]) == ("2026-10-15", 52.99, 63.1, 44.0)
    assert (first["volume"], first["value"], first["trades"]) == (3418887.0, 181171511.0, 1878.0)
    assert set(res.df["code"]) == {"6930"} and set(res.df["name"]) == {"盛新"}
    none = esb.parse_history(sample("tpex_esb_history_nodata.json"), "6930")
    assert none.no_data and none.df.empty and "查無" in none.message


def _many(n: int = 60) -> bytes:
    """把樣本的一列複製成 n 檔（每日任務要求至少 50 檔才算正常）。"""
    base = json.loads(sample("tpex_esb_latest.json"))[0]
    return json.dumps(
        [{**base, "SecuritiesCompanyCode": str(7000 + i), "CompanyName": f"示範{i}"} for i in range(n)]
    ).encode()


def test_daily_writes_snapshot_and_rejects_short_response(tmp_path):
    ctx = make_ctx(tmp_path, {LATEST: _many()}, now=datetime(2026, 11, 13, 21, 45, tzinfo=TPE))
    assert tasks_advanced.run_esb_quotes(ctx, date(2026, 11, 13)) == "ok"
    day = ctx.store.read("tpex_esb_quotes", date(2026, 11, 13))
    assert day is not None and len(day) == 60 and day["code"].iloc[0] == "7000"
    assert ctx.manifest["sources"]["tpex_esb"]["last_status"] == "ok"
    # 筆數太少（格式變動或只回一部分）→ 失敗，不覆蓋已存的
    ctx2 = make_ctx(tmp_path, {LATEST: sample("tpex_esb_latest.json")}, now=datetime(2026, 11, 13, 21, 45, tzinfo=TPE))
    assert tasks_advanced.run_esb_quotes(ctx2, date(2026, 11, 13)) == "failed"
    assert len(ctx2.store.read("tpex_esb_quotes", date(2026, 11, 13))) == 60


def test_history_backfill_keeps_snapshot_rows_and_resumes(tmp_path, monkeypatch):
    now = datetime(2026, 11, 13, 21, 45, tzinfo=TPE)
    ctx = make_ctx(
        tmp_path, {LATEST: _many(), "date=2026/10/01&code=7000": sample("tpex_esb_history_6930.json")}, now=now
    )
    tasks_advanced.run_esb_quotes(ctx, date(2026, 11, 13))
    # 沒有時間限制：10、11 兩個月 × 60 檔，全部查完
    assert tasks_advanced.run_esb_history(ctx, date(2026, 10, 1), date(2026, 11, 13)) == 0
    assert ctx.manifest["backfilled"]["tpex_esb"] == ["2026-10", "2026-11"]
    assert ctx.manifest["esb_history_progress"] == {}
    d = ctx.store.read("tpex_esb_quotes", date(2026, 10, 15))
    assert d is not None and list(d["code"]) == ["7000"] and d["close"].iloc[0] == 52.99
    # 當日行情已存的那一天（有最後成交價）不被歷史資料覆蓋
    assert len(ctx.store.read("tpex_esb_quotes", date(2026, 11, 13))) == 60
    # 做完的月份不再請求
    before = ctx.client.request_count
    assert tasks_advanced.run_esb_history(ctx, date(2026, 10, 1), date(2026, 11, 13)) == 0
    assert ctx.client.request_count == before

    # 時間用完 → 回傳還沒做完的月數，查過的代號記在 manifest，下一段接著做
    ctx2 = make_ctx(tmp_path / "b", {LATEST: _many()}, now=now)
    tasks_advanced.run_esb_quotes(ctx2, date(2026, 11, 13))
    calls = {"n": 0}

    def out_of_time() -> bool:
        calls["n"] += 1
        return calls["n"] > 70  # 第一個月 60 檔 + 第二個月 10 檔

    monkeypatch.setattr(ctx2, "out_of_time", out_of_time)
    assert tasks_advanced.run_esb_history(ctx2, date(2026, 10, 1), date(2026, 11, 13)) == 1
    assert ctx2.manifest["backfilled"]["tpex_esb"] == ["2026-11"]
    assert len(ctx2.manifest["esb_history_progress"]["2026-10"]) == 10
    monkeypatch.setattr(ctx2, "out_of_time", lambda: False)
    before = ctx2.client.request_count
    assert tasks_advanced.run_esb_history(ctx2, date(2026, 10, 1), date(2026, 11, 13)) == 0
    assert ctx2.client.request_count - before == 50  # 只查還沒查過的 50 檔


def test_history_needs_snapshot_first(tmp_path):
    ctx = make_ctx(tmp_path, {})
    assert tasks_advanced.run_esb_history(ctx, date(2026, 8, 1), date(2026, 9, 24)) == 0
    assert "先跑每日任務" in ctx.manifest["sources"]["tpex_esb"]["last_message"]


def test_backfill_default_is_12_months_and_only_when_named():
    assert tasks.default_backfill_start(["tpex_esb"], date(2026, 11, 14)) == date(2025, 11, 1)
    from pipeline.registry import CUSTOM_BACKFILL

    assert "tpex_esb" in CUSTOM_BACKFILL


def test_panels_use_average_price_and_skip_listed():
    dates = ["2026-11-11", "2026-11-12", "2026-11-13"]
    q = pd.DataFrame(
        [
            {
                "date": "2026-11-11",
                "code": "6930",
                "name": "盛新",
                "high": 31.0,
                "low": 29.0,
                "close": 30.0,
                "volume": 1000.0,
                "value": 30000.0,
            },
            # 11/12 沒有成交（沒有那一列）
            {
                "date": "2026-11-13",
                "code": "6930",
                "name": "盛新",
                "high": 34.0,
                "low": 32.0,
                "close": 33.0,
                "volume": 2000.0,
                "value": 66000.0,
            },
            {
                "date": "2026-11-13",
                "code": "2330",
                "name": "已上市",
                "high": 1.0,
                "low": 1.0,
                "close": 1.0,
                "volume": 1.0,
                "value": 1.0,
            },
        ]
    )
    p = esbmod.build_panels(q, dates, {"2330"})
    assert p.codes == ["6930"] and p.markets == {"6930": "esb"}  # 已在上市櫃面板的代號不輸出興櫃版本
    assert list(p.open["6930"].dropna()) == [30.0, 33.0]  # 沒有開盤價：以均價代替
    assert pd.isna(p.close.loc["2026-11-12", "6930"])
    assert p.change.loc["2026-11-13", "6930"] == 3.0  # 對前一個有成交日的均價
    assert float(p.af["6930"].iloc[-1]) == 1.0 and p.foreign_net["6930"].isna().all()
    # 剛開始抓、沒有前一天的資料：用當日行情的前日均價算漲跌
    one = esbmod.build_panels(q[q["date"] == "2026-11-13"].assign(prev=31.5), dates, {"2330"})
    assert one.change.loc["2026-11-13", "6930"] == 1.5
