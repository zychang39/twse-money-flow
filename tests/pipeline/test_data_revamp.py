"""2026-10 改版資料管線：盤中走勢（指數 1D／1W、個股 5 分 K）、三大法人金額、注意／處置、52 週寬度、資金環境驗證。"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from pipeline.core.store import DataStore
from pipeline.derive import envhist, intraday, stockdetail
from pipeline.derive.extras import breadth_52w, market_flows
from pipeline.sources import advanced as adv
from pipeline.sources import insti_amount, yahoo
from pipeline.sources.base import ParseError
from pipeline.tasks_kbar import done_codes, flush, priority_universe, prune, triggered_codes
from tests.pipeline.conftest import sample


# ------------------------------------------------------------------ Yahoo
def test_yahoo_5m_chart():
    res = yahoo.parse_chart(sample("yahoo_chart_2330_5m.json"), "2330")
    df = res.df
    assert res.response_date == date(2026, 10, 2)
    day = df[df["date"] == "2026-10-02"]
    # 13:25 四價皆空 → 略過；09:00 與 13:30（集合競價）成交量 0 → 空值
    assert "13:25" not in set(day["time"]) and len(day) == 54
    first, last = day.iloc[0], day.iloc[-1]
    assert first["time"] == "09:00" and np.isnan(first["volume"])
    assert last["time"] == "13:30" and last["close"] == 2500 and np.isnan(last["volume"])
    # 與證交所日線一致：開 2505、高 2515、低 2495、收 2500
    assert (day["open"].iloc[0], day["high"].max(), day["low"].min()) == (2505, 2515, 2495)
    assert day.iloc[1]["volume"] == 157180
    assert yahoo.symbol("6488", "tpex") == "6488.TWO" and yahoo.symbol("2330", "twse") == "2330.TW"


def test_yahoo_rounds_float32_prices():
    payload = {
        "chart": {
            "result": [
                {
                    "meta": {"gmtoffset": 28800, "exchangeTimezoneName": "Asia/Taipei"},
                    "timestamp": [1790902800],
                    "indicators": {
                        "quote": [
                            {
                                "open": [112.349998],
                                "high": [112.4],
                                "low": [112.3],
                                "close": [112.349998],
                                "volume": [0],
                            }
                        ]
                    },
                }
            ],
            "error": None,
        }
    }
    df = yahoo.parse_chart(payload, "0050").df
    assert df.iloc[0]["close"] == 112.35 and df.iloc[0]["time"] == "09:00"


def test_yahoo_index_fallback_format():
    res = yahoo.parse_index_chart(sample("yahoo_chart_TWII_1m.json"))
    day = res.df[res.df["date"] == "2026-10-02"]
    assert len(day) == 271
    assert day.iloc[0]["time"] == "09:00:59" and day.iloc[-1]["time"] == "13:30:59"
    assert intraday.downsample_minutes(day)[-1]["v"] == pytest.approx(48475.74, abs=0.01)


def test_yahoo_error_and_empty():
    with pytest.raises(ParseError):
        yahoo.parse_chart({"chart": {"result": None, "error": {"code": "Bad", "description": "x"}}}, "1")
    assert yahoo.parse_chart({"chart": {"result": None, "error": {"code": "Not Found"}}}, "1").no_data


# ------------------------------------------------------------------ 三大法人金額
def test_insti_amount_twse():
    res = insti_amount.parse_twse(sample("twse_rwd_BFI82U.json"))
    m = res.df.set_index("item")["net"]
    assert res.response_date == date(2026, 10, 2)
    assert m["foreign"] == 2_621_799_962 and m["trust"] == 5_768_811_349
    assert m["dealer_self"] + m["dealer_hedge"] == 4_741_375_500 - 2_714_959_070
    assert m["total"] == 10_417_027_741


def test_insti_amount_tpex():
    res = insti_amount.parse_tpex(sample("tpex_insti_summary.json"))
    m = res.df.set_index("item")["net"]
    assert res.response_date == date(2026, 10, 2)
    assert set(m.index) == {"foreign", "foreign_dealer", "trust", "dealer_self", "dealer_hedge", "total"}
    assert m["foreign"] == 4_132_835_121 and m["trust"] == -1_637_492_546 and m["total"] == 4_701_726_734
    empty = insti_amount.parse_tpex({"tables": [{"date": "115/10/03", "fields": [], "data": []}]})
    assert empty.no_data


def _panel(dates: list[str], codes: list[str], markets: dict[str, str], vals: dict[str, float]) -> SimpleNamespace:
    def frame(v: float) -> pd.DataFrame:
        return pd.DataFrame(v, index=dates, columns=codes)

    return SimpleNamespace(
        dates=dates,
        markets=markets,
        close=frame(vals["close"]),
        foreign_net=frame(vals["fn"]),
        trust_net=frame(vals["tn"]),
        dealer_net=frame(vals["dn"]),
    )


def test_market_flows_actual_then_estimate(tmp_path):
    store = DataStore(tmp_path)
    dates = ["2026-10-01", "2026-10-02"]
    p = _panel(dates, ["2330", "6488"], {"2330": "twse", "6488": "tpex"}, {"close": 100, "fn": 1e6, "tn": 0, "dn": 0})
    for sid, parse, name in (
        ("twse_insti_amount", insti_amount.parse_twse, "twse_rwd_BFI82U.json"),
        ("tpex_insti_amount", insti_amount.parse_tpex, "tpex_insti_summary.json"),
    ):
        store.write(sid, date(2026, 10, 2), parse(sample(name)).df)
    flows = market_flows(SimpleNamespace(store=store), p)
    est, real = flows
    # 10/01 沒有官方金額 → 張數 × 收盤估算（兩檔各 1e6 股 × 100 元 = 2 億）並標 est
    assert est["est"] is True and est["foreign"] == 2.0 and est["trust"] == 0
    # 10/02 上市＋上櫃實際金額（億元）
    assert "est" not in real
    assert real["foreign"] == pytest.approx((2_621_799_962 + 4_132_835_121) / 1e8, abs=0.01)
    assert real["dealer"] == pytest.approx((2_026_416_430 + 1_053_327_631 + 1_153_056_528) / 1e8, abs=0.01)


# ------------------------------------------------------------------ 指數 1D／1W
def _five_sec(day: str, base: float) -> pd.DataFrame:
    times = pd.date_range(f"{day} 09:00:00", f"{day} 13:30:00", freq="5s")
    vals = base + np.arange(len(times)) * 0.01
    return pd.DataFrame({"date": day, "time": times.strftime("%H:%M:%S"), "taiex": vals})


def test_index_intraday_points_days_and_fallback(tmp_path):
    store = DataStore(tmp_path)
    dates = ["2026-09-24", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]
    for i, d in enumerate(dates):
        if d == "2026-09-30":  # 這一天證交所取不到 → Yahoo 備援
            yh = yahoo.parse_index_chart(sample("yahoo_chart_TWII_1m.json")).df
            store.write("yahoo_twii", date(2026, 9, 30), yh[yh["date"] == "2026-10-02"].assign(date=d))
        else:
            store.write("twse_intraday_index", date.fromisoformat(d), _five_sec(d, 100 + i))
    taiex = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0], index=dates)
    data = intraday.index_intraday(store, dates, taiex)
    assert data is not None
    assert data["date"] == "2026-10-02" and data["prev_close"] == 4.0 and data["prev_date"] == "2026-10-01"
    assert len(data["points"]) == 271 and data["points"][0]["t"] == "09:00" and data["points"][-1]["t"] == "13:30"
    assert [d["date"] for d in data["days"]] == dates
    assert all(len(d["points"]) == 55 for d in data["days"])
    assert data["days"][0]["prev_close"] is None and data["days"][1]["prev_close"] == 1.0
    assert data["fallback"] is True and data["fallback_dates"] == ["2026-09-30"]
    assert data["source"].startswith("證交所")
    # 開盤不取 09:00:00（開盤前＝前一日收盤）那一筆
    assert data["ohlc"]["o"] == pytest.approx(104.01) and data["ohlc"]["c"] == pytest.approx(104 + 3240 * 0.01)


def test_intraday_index_parser_still_works():
    t = adv.parse_twse_intraday_index(sample("twse_MI_5MINS_INDEX.json"))
    pts = intraday.downsample_minutes(t.df)
    assert pts[0]["t"] == "09:00" and intraday.every5(pts)[-1]["t"] == "13:30"


# ------------------------------------------------------------------ 個股 5 分 K
def test_kbar_store_and_files(tmp_path):
    store = DataStore(tmp_path)
    df = yahoo.parse_chart(sample("yahoo_chart_2330_5m.json"), "2330").df
    keep = {"2026-10-01", "2026-10-02"}
    assert flush(store, [df], keep) == len(df)
    assert done_codes(store, date(2026, 10, 2)) == {"2330"}
    store.write("yahoo_kbar", date(2026, 9, 1), df.head(1).assign(date="2026-09-01"))
    assert prune(store, [date(2026, 10, 1), date(2026, 10, 2)]) == 1
    dates = ["2026-09-30", "2026-10-01", "2026-10-02"]
    close = pd.DataFrame({"2330": [2480.0, 2510.0, 2500.0]}, index=dates)
    out = tmp_path / "out"
    state = {"target": "2026-10-02", "empty": ["9999"], "failed": ["8888"]}
    rep = intraday.kbar_files(store, dates, close, {"2330", "9999", "8888", "7777"}, out, kbar_state=state)
    assert rep == {
        "kbar_codes": 1,
        "kbar_no_trade": 0,
        "kbar_missing": 1,
        "kbar_failed": 1,
        "kbar_not_fetched": 1,
        "kbar_date": "2026-10-02",
    }
    import json

    idx = json.loads((out / "intraday" / "index.json").read_text())
    # 2026-10-06：三種「沒有 K 棒」分開——來源無資料（missing）、抓取失敗（failed）、還沒抓（not_fetched）
    assert idx["codes"] == ["2330"] and idx["missing"] == ["9999"] and "非官方" in idx["source"]
    assert idx["failed"] == ["8888"] and idx["not_fetched"] == ["7777"]
    # 抓取進度不是最近交易日（kbar 排程還沒跑）→ 全部算「未抓取」，不是「來源未提供」
    out2 = tmp_path / "out2"
    intraday.kbar_files(
        store, dates, close, {"2330", "9999"}, out2, kbar_state={"target": "2026-10-01", "empty": ["9999"]}
    )
    idx2 = json.loads((out2 / "intraday" / "index.json").read_text())
    assert idx2["missing"] == [] and idx2["not_fetched"] == ["9999"]
    f = json.loads((out / "intraday" / "2330.json").read_text())
    last = f["days"][-1]
    assert last["date"] == "2026-10-02" and last["prev_close"] == 2510.0
    assert last["bars"][0][0] == "09:00" and last["bars"][0][5] is None and last["bars"][1][5] == 157180
    assert last["bars"][-1][:5] == ["13:30", 2500, 2500, 2500, 2500]
    # M1.1：每一檔有個股頁的股票都有檔案；資料源沒有 K 棒的標 missing（1D／1W 一律可切換）
    miss = json.loads((out / "intraday" / "9999.json").read_text())
    assert miss["days"][-1]["missing"] is True and miss["days"][-1]["bars"] == []


def test_kbar_no_trade(tmp_path):
    """當日無成交（成交股數 0）：該日 no_trade、bars 空、prev_close 為前一日收盤。"""
    from pipeline.core.store import DataStore
    from pipeline.derive import intraday

    store = DataStore(tmp_path / "data")
    dates = ["2026-10-01", "2026-10-02"]
    close = pd.DataFrame({"1234": [10.0, np.nan]}, index=dates)
    volume = pd.DataFrame({"1234": [1000.0, 0.0]}, index=dates)
    rep = intraday.kbar_files(store, dates, close, {"1234"}, tmp_path / "out", volume)
    assert rep["kbar_no_trade"] == 1
    import json

    f = json.loads((tmp_path / "out" / "intraday" / "1234.json").read_text())
    assert f["days"][-1] == {"date": "2026-10-02", "prev_close": 10.0, "bars": [], "no_trade": True}


def test_kbar_priority():
    quotes = pd.DataFrame(
        {
            "code": ["A1", "B1", "C1", "D1", "0050"],
            "close": [1.0, 1.0, 1.0, np.nan, 1.0],
            "value": [5.0, 4.0, 3.0, 9.0, 1.0],
            "market": ["twse", "tpex", "twse", "twse", "twse"],
        }
    ).assign(code=lambda x: x["code"].replace({"A1": "1101", "B1": "6488", "C1": "2330", "D1": "1102"}))
    sig = {"presets": [{"triggers": {"2026-01-01": ["0050"], "2025-01-01": ["2330"]}}]}
    trig = triggered_codes(sig, 1)
    assert trig == {"0050"}
    u = priority_universe(quotes, trig, top=1)
    assert [c for c, _m, _t in u] == ["1101", "0050", "6488", "2330"]
    assert [t for _c, _m, t in u] == [1, 2, 3, 3] and u[2][1] == "tpex"


# ------------------------------------------------------------------ 注意／處置
def test_attention_block():
    dates = [f"2026-09-{d:02d}" for d in range(1, 31)] + ["2026-10-01", "2026-10-02"]
    att = pd.DataFrame(
        {
            "date": ["2026-09-02", "2026-09-20", "2026-10-01", "2026-10-02", "2026-10-02"],
            "code": ["3016"] * 5,
            "reason": ["a", "b", "c", "d", "d2"],
        }
    )
    dis = pd.DataFrame(
        {
            "announce_date": ["2025-01-02", "2026-09-30", "2026-10-02", "2026-09-11"],
            "code": ["3016", "3016", "3016", None],
            "start": ["2025-01-03", "2026-10-01", "2026-10-05", None],
            "end": ["2025-01-10", "2026-10-12", "2026-10-09", None],
            "reason": ["連續三次", "連續三次及當日沖銷標準", "連續五次", "本日無處置資料"],
            "measure": ["第一次處置", "第一次處置", "第二次處置", "處置"],
            "interval_minutes": [5.0, 2.0, np.nan, np.nan],
        }
    )
    src = stockdetail.attention_sources(SimpleNamespace(attention=att, disposition=dis))
    a = stockdetail.attention_block(src, "3016", dates)
    assert a["count30"] == 3 and a["count10"] == 2  # 09-02 不在近 30 個營業日；同一天只算一次
    assert [d["date"] for d in a["days"]] == ["2026-10-02", "2026-10-01", "2026-09-20"]
    assert [d["start"] for d in a["disposition"]] == ["2026-10-05", "2026-10-01"]  # 近一年、新→舊
    assert a["active"] == {"start": "2026-10-01", "end": "2026-10-12", "interval": "2 分鐘"}
    assert a["upcoming"] == {"start": "2026-10-05", "end": "2026-10-09", "interval": None}
    none = stockdetail.attention_block(src, "2330", dates)
    assert none["count10"] == 0 and none["days"] == [] and none["active"] is None


# ------------------------------------------------------------------ 市場寬度 52 週
def test_breadth_52w():
    n = 250
    up = np.arange(n, dtype=float) + 1  # 最後一天創新高
    down = up[::-1].copy()  # 最後一天創新低
    flat_mid = np.r_[np.full(n - 1, 10.0), 5.0]
    flat_mid[0] = 1  # 最後一天不是新低（窗內有更低）
    young = np.r_[np.full(n - 100, np.nan), np.arange(100, dtype=float)]  # 上市未滿 240 日 → 不列入
    adj = pd.DataFrame({"A": up, "B": down, "C": flat_mid, "D": young})
    r = breadth_52w(adj)
    assert r == {"high52": 1, "low52": 1, "net52": 0, "n52": 3}
    assert breadth_52w(adj.iloc[:100])["high52"] is None


# ------------------------------------------------------------------ 資金環境
def test_percentile():
    s = pd.Series(np.arange(300, dtype=float))
    assert envhist.percentile(s) == 100.0
    s.iloc[-1] = -1
    assert envhist.percentile(s) == pytest.approx(0.4)
    assert envhist.percentile(pd.Series([1.0, 2.0])) is None


def test_asof_strict_no_lookahead():
    s = pd.Series([1.0, 2.0], index=["2026-10-01", "2026-10-02"])
    dates = ["2026-10-01", "2026-10-02", "2026-10-20"]
    assert envhist._asof(s, dates).tolist()[:2] == [1.0, 2.0]
    strict = envhist._asof(s, dates, strict=True)
    assert np.isnan(strict.iloc[0]) and strict.iloc[1] == 1.0
    assert np.isnan(envhist._asof(s, dates, max_gap=5).iloc[2])


def test_forward_returns_start_t_plus_1():
    tr = pd.Series([100.0, 110.0, 121.0, 133.1])
    r = envhist.forward_returns(tr, 1)
    assert r.iloc[0] == pytest.approx(10.0) and np.isnan(r.iloc[2])


def test_validate_rules():
    rng = np.random.default_rng(0)
    n = 600
    dates = [str(d.date()) for d in pd.bdate_range("2023-01-02", periods=n)]
    # 交替區段：保守 40%、積極 60%，保守後明顯下跌
    lab = np.where((np.arange(n) // 60) % 5 < 2, "conservative", "aggressive")
    ret = np.where(lab == "conservative", -0.004, 0.004) + rng.normal(0, 0.002, n)
    tr = pd.Series(100 * np.cumprod(1 + np.r_[0, ret[:-1]]), index=dates)
    out = envhist.validate(pd.Series(lab, index=dates), tr)
    by = {s["state"]: s for s in out["states"]}
    assert by["conservative"]["share"] == pytest.approx(0.4)
    assert by["conservative"]["r20"]["mean"] < 0 < by["aggressive"]["r20"]["mean"]
    assert out["show_conclusion"] is True
    # 保守占比 > 60% → 不顯示結論
    lab2 = np.where(np.arange(n) % 10 < 8, "conservative", "neutral")
    out2 = envhist.validate(pd.Series(lab2, index=dates), tr)
    assert out2["show_conclusion"] is False and "保守占比 80.0%" in out2["reason"]
    assert out2["period"] == [dates[0], dates[-1]] and out2["days"] == n


def test_env_state_rule():
    assert envhist.env_state(pd.Series(["red", "green", "green", "green", "yellow"])) == "conservative"
    assert envhist.env_state(pd.Series(["green", "green", "green", "yellow", None])) == "aggressive"
    assert envhist.env_state(pd.Series(["green", "yellow", None, None, None])) == "neutral"
    assert envhist.env_state(pd.Series([None] * 5)) is None


# ------------------------------------------------------------------ 處置與注意頁：不預測
def test_disposition_watchlist_facts_only():
    from pipeline.derive.flags import disposition_watchlist

    dates = [f"2026-09-{d:02d}" for d in range(1, 31)]
    att = pd.DataFrame(
        {
            "date": ["2026-09-28", "2026-09-29", "2026-09-30", "2026-09-10"],
            "code": ["1101", "1101", "1101", "2330"],
            "reason": ["a", "b", "c", "d"],
        }
    )
    dis = pd.DataFrame(
        {
            "code": ["3016"],
            "name": ["嘉晶"],
            "start": ["2026-09-29"],
            "end": ["2026-10-06"],
            "reason": ["連續三次"],
            "measure": ["第一次處置"],
            "interval_minutes": [2.0],
        }
    )
    accum = pd.DataFrame({"code": ["2330"], "situation": ["連續二次"]})
    ds = SimpleNamespace(attention=att, disposition=dis, attention_accum=accum)
    p = SimpleNamespace(dates=dates, names={"1101": "台泥", "2330": "台積電", "3016": "嘉晶"})
    out = disposition_watchlist(ds, p)
    assert set(out) == {"date", "watch", "disposition", "official"}
    w = {r["code"]: r for r in out["watch"]}
    assert "risk" not in w["1101"] and w["1101"]["consecutive"] == 3 and w["1101"]["in10"] == 3
    assert [r["code"] for r in out["watch"]] == ["1101", "2330"]  # 依近 10 日次數排序
    assert out["disposition"][0]["interval_minutes"] == 2.0
    assert out["official"] == [{"code": "2330", "name": "台積電", "situation": "連續二次"}]
