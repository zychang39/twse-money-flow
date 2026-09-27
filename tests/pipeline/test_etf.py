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


def test_ranking_counts_etfs_and_value() -> None:
    ch = etf.holdings_changes(_holdings())
    r = etf.ranking(ch, {"2330": 2500.0, "2317": 200.0, "2454": 1500.0})
    add = {x["code"]: x for x in r["add"]}
    assert add["2330"]["etfs"] == 2 and add["2330"]["net_shares"] == 3000
    assert add["2330"]["net_value"] == round(3000 * 2500 / 1e8, 2)
    assert r["add"][0]["code"] == "2330"  # 跨檔數優先
    red = r["reduce"]
    assert red[0]["code"] == "2317" and red[0]["etfs"] == 2 and red[0]["net_shares"] == -1500


def test_holders_by_stock_skips_sold_out() -> None:
    ch = etf.holdings_changes(_holdings())
    h = etf.holders_by_stock(ch, {"00981A": "主動統一台股增長"})
    assert {x["etf"] for x in h["2330"]} == {"00981A", "00982A"}
    assert [x["etf"] for x in h["2317"]] == ["00981A"]
    assert next(x for x in h["2330"] if x["etf"] == "00981A")["name"] == "主動統一台股增長"


def test_empty_holdings() -> None:
    empty = pd.DataFrame()
    ch = etf.holdings_changes(empty)
    assert ch.empty
    assert etf.ranking(ch, {}) == {"add": [], "reduce": []}
    assert etf.holders_by_stock(ch, {}) == {}


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
        {"code": "00981A", "name": "主動統一台股增長", "market": "twse", "close": 20.5, "value_million_20d": 3000.0}
    ]
