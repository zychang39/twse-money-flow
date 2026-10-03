"""主動式 ETF：清單判定、持股變化、跨檔加碼／減碼排行（手算）。"""

from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from pipeline.derive import etf


def _holdings() -> pd.DataFrame:
    rows = [
        # 00981A：2330 加 1000 股、2317 減 500 股、2454 新增
        ("2026-09-23", "00981A", "2330", "台積電", 10000, 9.0),
        ("2026-09-23", "00981A", "2317", "鴻海", 3000, 3.0),
        ("2026-09-24", "00981A", "2330", "台積電", 11000, 9.5),
        ("2026-09-24", "00981A", "2317", "鴻海", 2500, 2.6),
        ("2026-09-24", "00981A", "2454", "聯發科", 800, 1.2),
        # 00982A：2330 加 2000 股、2317 全數出清
        ("2026-09-23", "00982A", "2330", "台積電", 5000, 6.0),
        ("2026-09-23", "00982A", "2317", "鴻海", 1000, 1.0),
        ("2026-09-24", "00982A", "2330", "台積電", 7000, 7.1),
    ]
    return pd.DataFrame(rows, columns=["date", "etf", "code", "name", "shares", "weight"])


def test_holdings_changes() -> None:
    ch = etf.holdings_changes(_holdings()).set_index(["etf", "code"])
    assert ch.loc[("00981A", "2330"), "change_shares"] == 1000
    assert ch.loc[("00981A", "2317"), "change_shares"] == -500
    assert ch.loc[("00981A", "2454"), "change_shares"] == 800
    assert ch.loc[("00982A", "2317"), "change_shares"] == -1000
    assert ch.loc[("00982A", "2317"), "shares"] == 0
    assert ch.loc[("00982A", "2317"), "name"] == "鴻海"


def test_holdings_changes_kind() -> None:
    """M2：變動分類 new（新增）／add（加碼）／reduce（減碼）／exit（剔除）；只有一天資料時無法分類（None）。"""
    ch = etf.holdings_changes(_holdings()).set_index(["etf", "code"])
    assert ch.loc[("00981A", "2330"), "kind"] == "add"
    assert ch.loc[("00981A", "2317"), "kind"] == "reduce"
    assert ch.loc[("00981A", "2454"), "kind"] == "new"
    assert ch.loc[("00982A", "2317"), "kind"] == "exit"
    assert ch.loc[("00982A", "2330"), "kind"] == "add"
    assert etf.kind_counts(etf.holdings_changes(_holdings())) == {"new": 1, "add": 2, "reduce": 1, "exit": 1}
    assert etf.change_kind(None, 100) is None and etf.change_kind(100, 100) == "hold"
    one_day = _holdings()
    one_day = one_day[one_day["date"] == "2026-09-24"]
    first = etf.holdings_changes(one_day)
    assert first["kind"].isna().all() and first["change_shares"].isna().all()
    assert etf.kind_counts(first) == {"new": 0, "add": 0, "reduce": 0, "exit": 0}
    assert [etf.KIND_LABEL[k] for k in ("new", "add", "reduce", "exit")] == ["新增", "加碼", "減碼", "剔除"]


def test_ranking_counts_etfs_and_value() -> None:
    ch = etf.holdings_changes(_holdings())
    r = etf.ranking(ch, {"2330": 2500.0, "2317": 200.0, "2454": 1500.0})
    add = {x["code"]: x for x in r["add"]}
    assert add["2330"]["etfs"] == 2 and add["2330"]["net_shares"] == 3000
    assert add["2330"]["net_value"] == round(3000 * 2500 / 1e8, 2)
    assert r["add"][0]["code"] == "2330"  # 跨檔數優先
    red = r["reduce"]
    assert red[0]["code"] == "2317" and red[0]["etfs"] == 2 and red[0]["net_shares"] == -1500
    # M2：排行列帶分類——2330 兩檔都是加碼 → add；2454 只有一檔且是新增 → new；2317 一檔減碼＋一檔剔除 → reduce
    assert add["2330"]["kind"] == "add" and add["2454"]["kind"] == "new"
    assert red[0]["kind"] == "reduce"


def test_holders_by_stock_keeps_exit_with_kind() -> None:
    """M2：個股的 ETF 持有清單保留本次剔除的 ETF（kind=exit、shares 0），每列帶 kind。"""
    ch = etf.holdings_changes(_holdings())
    h = etf.holders_by_stock(ch, {"00981A": "主動統一台股增長"})
    assert {x["etf"] for x in h["2330"]} == {"00981A", "00982A"}
    assert {x["etf"]: x["kind"] for x in h["2317"]} == {"00981A": "reduce", "00982A": "exit"}
    assert next(x for x in h["2330"] if x["etf"] == "00981A")["name"] == "主動統一台股增長"
    assert next(x for x in h["2330"] if x["etf"] == "00981A")["kind"] == "add"
    assert h["2454"][0]["kind"] == "new"


def test_empty_holdings() -> None:
    empty = pd.DataFrame()
    ch = etf.holdings_changes(empty)
    assert ch.empty
    assert etf.ranking(ch, {}) == {"add": [], "reduce": []}
    assert etf.holders_by_stock(ch, {}) == {}
    assert etf.kind_counts(ch) == {"new": 0, "add": 0, "reduce": 0, "exit": 0}


def test_market_env_series() -> None:
    """M2：market.json 的 env.futures_series（外資台指期淨未平倉，大台約當口數）、temperature.pc_series（選擇權 P/C 比）。"""
    from pipeline.derive import extras

    dates = [f"2026-09-{d:02d}" for d in range(1, 25)]
    ti = pd.DataFrame(
        [
            {"date": d, "contract": c, "party": "外資及陸資", "long_oi": 0, "short_oi": 0, "net_oi": n}
            for d in dates
            for c, n in (("TXF", 1000), ("MXF", 400), ("TMF", 200))
        ]
    )
    pc = pd.DataFrame({"date": dates, "pc_oi_ratio": [80.0 + i for i in range(len(dates))], "pc_vol_ratio": 100.0})
    tables = {"taifex_insti": ti, "taifex_pc": pc}
    ds = SimpleNamespace(table=lambda name: tables.get(name, pd.DataFrame()), margin_total=pd.DataFrame())
    p = SimpleNamespace(dates=dates, value=pd.DataFrame({"2330": [1e9] * len(dates)}, index=dates))
    taiex = pd.Series(range(len(dates)), index=dates, dtype=float)
    env = extras.market_env(ds, p, taiex)
    fs = env["env"]["futures_series"]
    assert len(fs) == len(dates) and fs[-1] == {"date": "2026-09-24", "net": 1000 + 400 * 0.25 + 200 * 0.05}
    ps = env["temperature"]["pc_series"]
    assert len(ps) == len(dates) and ps[-1] == {"date": "2026-09-24", "pc": 103.0, "vol": 100.0}
    assert extras.pc_series(pd.DataFrame()) == []
    assert extras.pc_series(pd.DataFrame({"date": dates, "pc_oi_ratio": [90.0] * len(dates)}))[0]["vol"] is None
    # 沒有期交所資料時仍輸出空序列（前端寫原因）
    none = extras.market_env(SimpleNamespace(table=lambda _n: pd.DataFrame(), margin_total=pd.DataFrame()), p, taiex)
    assert none["env"]["futures_series"] == [] and none["temperature"]["pc_series"] == []


def test_active_etfs_from_codes() -> None:
    dates = ["2026-09-23", "2026-09-24"]
    close = pd.DataFrame({"00981A": [20.0, 20.5], "0050": [180.0, 181.0], "00992A": [None, None]}, index=dates)
    value = pd.DataFrame({"00981A": [2e9, 4e9], "0050": [1e10, 1e10], "00992A": [None, None]}, index=dates)
    p = SimpleNamespace(
        codes=list(close.columns),
        close=close,
        value=value,
        names={"00981A": "主動統一台股增長"},
        markets={"00981A": "twse"},
    )
    out = etf.active_etfs(p)
    assert out == [
        {
            "code": "00981A",
            "name": "主動統一台股增長",
            "market": "twse",
            "close": 20.5,
            "change_pct": 2.5,
            "value_million_20d": 3000.0,
        }
    ]


def test_turnover_series_ratio_uses_previous_20_days() -> None:
    """首頁成交金額（M2）：上市／上櫃／合計各一組，億元 ＋ ÷ 前 20 日平均（不含當日）；不足 20 日為 None。"""
    from pipeline.derive.extras import turnover_series

    dates = [f"2026-08-{d:02d}" for d in range(1, 23)]
    value = pd.DataFrame({"A": [1e11] * 21 + [2e11], "B": [1e11] * 22}, index=dates)
    p = SimpleNamespace(dates=dates, value=value, markets={"A": "twse", "B": "tpex"})
    out = turnover_series(p, days=60)
    assert len(out) == 22
    assert out[0]["total"] == {"value": 2000.0, "ma20_ratio": None}
    assert out[-2]["total"]["ma20_ratio"] == 1.0
    assert out[-1]["total"] == {"value": 3000.0, "ma20_ratio": 1.5}
    assert out[-1]["twse"] == {"value": 2000.0, "ma20_ratio": 2.0}
    assert out[-1]["tpex"] == {"value": 1000.0, "ma20_ratio": 1.0}


def test_market_breadth_counts_ma_and_60d_extremes() -> None:
    """市場寬度（M2）：站上均線比例只算普通股；創 60 日新高／新低家數。"""
    from pipeline.derive.extras import market_breadth

    dates = [f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(240)]
    up = pd.Series(range(1, 241), dtype=float)  # 一路上漲：站上所有均線、創 60 日新高
    down = pd.Series(range(240, 0, -1), dtype=float)  # 一路下跌：跌破、創 60 日新低
    close = pd.DataFrame({"2330": up.values, "2317": down.values, "0050": up.values}, index=dates)
    p = SimpleNamespace(codes=["2330", "2317", "0050"], adj_close=close)
    chg = pd.Series({"2330": 1.0, "2317": -1.0, "0050": 0.0})
    b = market_breadth(p, chg)
    assert (b["up"], b["down"], b["flat"], b["n"]) == (1, 1, 1, 2)
    assert b["above_ma20_pct"] == 50.0 and b["n_ma240"] == 2
    assert b["high60"] == 1 and b["low60"] == 1
