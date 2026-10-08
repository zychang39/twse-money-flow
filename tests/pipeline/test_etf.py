"""主動式 ETF：清單判定、持股變化、跨檔加碼／減碼排行（手算）。"""

from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from pipeline.derive import etf

U = 1_000_000.0  # 受益權單位數不變：超額股數＝原始股數差


def _holdings() -> pd.DataFrame:
    rows = [
        # 00981A：2330 加 1000 股、2317 減 1000 股、2454 新增
        ("2026-09-23", "00981A", "2330", "台積電", 10000, 9.0, U),
        ("2026-09-23", "00981A", "2317", "鴻海", 3000, 3.0, U),
        ("2026-09-24", "00981A", "2330", "台積電", 11000, 9.5, U),
        ("2026-09-24", "00981A", "2317", "鴻海", 2000, 2.6, U),
        ("2026-09-24", "00981A", "2454", "聯發科", 800, 1.2, U),
        # 00982A：2330 加 2000 股、2317 全數出清
        ("2026-09-23", "00982A", "2330", "台積電", 5000, 6.0, U),
        ("2026-09-23", "00982A", "2317", "鴻海", 1000, 1.0, U),
        ("2026-09-24", "00982A", "2330", "台積電", 7000, 7.1, U),
    ]
    return pd.DataFrame(rows, columns=["date", "etf", "code", "name", "shares", "weight", "units"])


def test_holdings_changes() -> None:
    ch = etf.holdings_changes(_holdings()).set_index(["etf", "code"])
    assert ch.loc[("00981A", "2330"), "change_shares"] == 1000
    assert ch.loc[("00981A", "2317"), "change_shares"] == -1000
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
    assert red[0]["code"] == "2317" and red[0]["etfs"] == 2 and red[0]["net_shares"] == -2000
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
            "mcap_yi": None,
            "mcap_basis": None,
            "ret": {"1d": 2.5, "5d": None, "20d": None, "60d": None, "120d": None, "ytd": None, "1y": None},
            "listed": "2026-09-23",
            "days": 2,
            "holdings_date": None,
            "holdings_n": None,
            "holdings_foreign": None,
        }
    ]
    # 2026-10-09：市值＝最新持股日的受益權單位數 × 收盤價（沒有單位數用基金淨資產）；今年以來以去年最後收盤為基準
    h = pd.DataFrame(
        {
            "date": ["2026-09-24"] * 3,
            "etf": ["00981A", "00981A", "00992A"],
            "code": ["2330", "NVDA US", "2330"],
            "name": ["台積電", "NVIDIA", "台積電"],
            "shares": [1000, 10, 5],
            "weight": [5.0, 1.0, 9.0],
            "units": [1e9, 1e9, None],
            "aum": [None, None, 3e9],
            "foreign": [False, True, False],
        }
    )
    row = etf.active_etfs(p, h)[0]
    assert row["mcap_yi"] == 205.0 and row["mcap_basis"] == "units"
    assert (row["holdings_date"], row["holdings_n"], row["holdings_foreign"]) == ("2026-09-24", 2, 1)
    assert list(etf.domestic(h)["code"]) == ["2330", "2330"]
    adj = pd.Series([10.0, 11.0, 12.0], index=["2025-12-30", "2025-12-31", "2026-01-02"])
    assert etf._returns(adj, list(adj.index))["ytd"] == 9.09


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


# ------------------------------------------------------------------ §7 加減碼判定（扣除受益權單位數變動）
def _two_days(rows0, rows1, u0, u1, etf_code="00981A"):
    cols = ["date", "etf", "code", "name", "shares", "weight", "units"]
    a = [("2026-09-23", etf_code, c, c, s, w, u0) for c, s, w in rows0]
    b = [("2026-09-24", etf_code, c, c, s, w, u1) for c, s, w in rows1]
    return pd.DataFrame(a + b, columns=cols)


def test_proportional_creation_is_not_add() -> None:
    """申購 20%：單位數 ×1.2、每檔股數等比例 ×1.2（四捨五入到整張）→ 全部「不變」；修正前全部算加碼。"""
    before = [("2330", 100_000, 9.0), ("2317", 37_000, 3.0), ("2454", 8_000, 1.0)]
    after = [("2330", 120_000, 9.0), ("2317", 44_000, 3.0), ("2454", 10_000, 1.0)]  # 37 張 ×1.2＝44.4 → 44 張
    ch = etf.holdings_changes(_two_days(before, after, 1e6, 1.2e6)).set_index("code")
    assert set(ch["basis"]) == {"units"} and ch["flow"].iloc[0] == 1.2
    assert set(ch["kind"]) == {"hold"}
    assert set(ch["kind_raw"]) == {"add"}
    assert ch.loc["2317", "excess_shares"] == 44_000 - 37_000 * 1.2  # −400 股：零股尾差 < 1 張
    assert etf.kind_counts(ch.reset_index()) == {"new": 0, "add": 0, "reduce": 0, "exit": 0}
    assert etf.kind_counts(ch.reset_index(), "kind_raw")["add"] == 3


def test_redemption_with_one_real_add() -> None:
    """買回 10%：其餘等比例 ×0.9；2330 另外多買 50 張 → 只有 2330 是加碼，超額股數＝50 張。"""
    before = [("2330", 100_000, 9.0), ("2317", 30_000, 3.0), ("2454", 10_000, 1.0)]
    after = [("2330", 140_000, 9.0), ("2317", 27_000, 3.0), ("2454", 9_000, 1.0)]
    ch = etf.holdings_changes(_two_days(before, after, 1e6, 0.9e6)).set_index("code")
    assert ch.loc["2330", "kind"] == "add" and ch.loc["2330", "excess_shares"] == 50_000
    assert round(ch.loc["2330", "per_unit_change"], 4) == round(140 / 90 - 1, 4)
    assert ch.loc["2317", "kind"] == "hold" and ch.loc["2454", "kind"] == "hold"
    assert ch.loc["2317", "kind_raw"] == "reduce"  # 修正前：買回造成的等比例減少被當成減碼


def test_thresholds_one_lot_and_one_percent() -> None:
    """門檻：|超額股數| ≥ 1 張 且 |每單位持股數變化| ≥ 1%；新增／剔除不受門檻限制。"""
    assert etf.flow_kind(10_000, 10_999, 999.0, 0.0999) == "hold"  # 不到 1 張
    assert etf.flow_kind(500_000, 503_000, 3_000.0, 0.006) == "hold"  # 1 張以上但 < 1%
    assert etf.flow_kind(500_000, 505_000, 5_000.0, 0.01) == "add"
    assert etf.flow_kind(500_000, 495_000, -5_000.0, -0.01) == "reduce"
    assert etf.flow_kind(0, 1_000, None, None) == "new"
    assert etf.flow_kind(1_000, 0, None, None) == "exit"
    assert etf.flow_kind(1_000, 2_000, None, None) is None  # 無法估計流量倍數


def test_implied_flow_without_units() -> None:
    """沒有單位數（聯博）：以共同持股股數比的中位數估計；共同持股 < 5 檔時無法分類（新增／剔除照常）。"""
    before = [(c, 10_000 * (i + 1), 1.0) for i, c in enumerate(["1101", "1102", "1216", "1301", "1303"])]
    after = [(c, s * 2, w) for c, s, w in before]
    after[0] = ("1101", 60_000, 1.0)  # 1101：等比例應為 20,000，另外多 40 張
    after.append(("2330", 5_000, 1.0))
    ch = etf.holdings_changes(_two_days(before, after, None, None, "00404A")).set_index("code")
    assert set(ch["basis"]) == {"implied"} and ch["flow"].iloc[0] == 2.0
    assert ch.loc["1101", "kind"] == "add" and ch.loc["1101", "excess_shares"] == 40_000
    assert (ch.drop(index=["1101", "2330"])["kind"] == "hold").all()
    assert ch.loc["2330", "kind"] == "new"
    few = etf.holdings_changes(_two_days(before[:2], after[:2], None, None, "00404A")).set_index("code")
    assert few["basis"].isna().all() and few["kind"].isna().all()


def _panel() -> SimpleNamespace:
    dates = [f"2026-09-{d:02d}" for d in range(1, 25)]
    codes = ["2330", "2317", "2454"]
    close = pd.DataFrame({"2330": 1000.0, "2317": 200.0, "2454": 1500.0}, index=dates)
    volume = pd.DataFrame({"2330": 1e7, "2317": 1e7, "2454": 1e6}, index=dates)
    value = close * volume  # 均價＝收盤；20 日均額：2330 100 億、2317 20 億、2454 15 億
    return SimpleNamespace(
        dates=dates,
        codes=codes,
        names={"2330": "台積電", "2317": "鴻海", "2454": "聯發科", "00981A": "主動統一台股增長"},
        close=close,
        volume=volume,
        value=value,
        shares={"2330": 2.6e10, "2317": 1.4e10, "2454": 1.6e9},
    )


def test_cross_items_metrics_and_min_value() -> None:
    """每列：金額（億）＝超額股數 × 均價、佔 20 日均額 %、佔市值 %、幾檔同向；|金額| < 0.3 億不列入；三種口徑排序。"""
    h = pd.concat(
        [
            _two_days(
                [("2330", 100_000, 9.0), ("2317", 200_000, 3.0)], [("2330", 160_000, 9.5), ("2454", 1_000, 1.0)], U, U
            ),
            _two_days(
                [("2330", 50_000, 6.0), ("2317", 100_000, 1.0)],
                [("2330", 70_000, 7.0), ("2317", 0, 0.0)],
                U,
                U,
                "00982A",
            ),
        ],
        ignore_index=True,
    )
    mk = etf.Market(_panel())
    items = {x["code"]: x for x in etf.cross_items(etf.holdings_changes(h), mk, _panel().names)}
    a = items["2330"]
    assert (a["dir"], a["kind"], a["etfs_same_dir"]) == ("add", "add", 2)
    assert a["value_yi"] == 0.8  # (60,000 + 20,000) 股 × 1,000 元
    assert a["pct_avg20"] == 0.8  # 0.8 億 ÷ 100 億
    assert a["pct_mcap"] == round(8e7 / (2.6e10 * 1000) * 100, 4)
    assert {e["code"] for e in a["etfs"]} == {"00981A", "00982A"} and a["etfs"][0]["d_shares"] == 60_000
    r = items["2317"]
    assert (r["dir"], r["kind"], r["value_yi"], r["etfs_same_dir"]) == ("reduce", "exit", -0.6, 2)
    assert r["pct_avg20"] == -3.0
    assert "2454" not in items  # 新增 1 張＝0.015 億 < 0.3 億
    by_value = etf.sort_items(list(items.values()), "value")
    assert [x["dir"] for x in by_value] == ["add", "reduce"]
    assert etf.DEFAULT_METRIC == "pct_avg20" and set(etf.METRICS) == {"value", "pct_avg20", "pct_mcap"}


def test_stock_summary_count_net5_pct() -> None:
    """個股頁：持有檔數、近 5 日淨變動金額（億）、佔 20 日均成交額 %。"""
    h = _two_days(
        [("2330", 100_000, 9.0), ("2317", 200_000, 3.0)], [("2330", 160_000, 9.5), ("2317", 200_000, 3.0)], U, U
    )
    s = etf.stock_summary(h, _panel())
    assert s["2330"] == {"count": 1, "net5_value_yi": 0.6, "pct_avg20": 0.6, "date": "2026-09-24"}
    assert s["2317"]["count"] == 1 and s["2317"]["net5_value_yi"] == 0.0
    assert etf.stock_summary(pd.DataFrame(), _panel()) == {}


def test_coverage_counts_issuers_and_etfs_separately() -> None:
    """頁首涵蓋：有資料的 ETF 檔數與其投信家數；已實作的投信家數另列（舊版把兩者寫在同一句：9 家 vs 8 檔）。"""
    names = {
        "00980A": "主動野村臺灣優選",
        "00985A": "主動野村台灣50",
        "00982A": "主動群益台灣強棒",
        "00400A": "主動國泰動能高息",
    }
    snap = etf.holdings_changes(
        pd.concat([_two_days([("2330", 1, 1.0)], [("2330", 1, 1.0)], U, U, e) for e in ("00980A", "00985A", "00982A")])
    )
    cov = etf.coverage(snap, 32, "2026-09-24", names, [])
    assert (cov["covered"], cov["total"], cov["issuers"]) == (3, 32, 2)
    assert cov["issuer_names"] == ["群益投信", "野村投信"]
    assert cov["implemented_issuers"] >= cov["issuers"] and cov["implemented_etfs"] == 3
    text = etf.coverage_text(cov)
    assert (
        "3／32 檔" in text
        and "2 家投信（群益、野村）" in text
        and f"已實作 {cov['implemented_issuers']} 家投信" in text
    )


def test_validation_without_history_is_unverified() -> None:
    v = etf._empty_validation("尚無兩次以上的持股揭露")
    assert v["verified"] is False and v["metric"] is None and v["n"] == 0
    assert etf.unverified_label(v) == "排序口徑未驗證（樣本 0 筆、無）"
    v2 = {"verified": False, "n": 12, "period": ["2026-01-05", "2026-08-01"]}
    assert etf.unverified_label(v2) == "排序口徑未驗證（樣本 12 筆、2026-01-05～2026-08-01）"
    assert etf.unverified_label({"verified": True}) is None


def test_creation_into_cash_is_not_reduce() -> None:
    """實測最常見的情況：申購 5%（單位數 ×1.05）但多數持股股數不變（申購款留現金）→ 不變，不是減碼；
    同一天實際加買的 2330 才是加碼，計入股數＝min(實際增加, 超額股數)。"""
    before = [("2330", 100_000, 9.0), ("2317", 30_000, 3.0), ("2454", 10_000, 1.0)]
    after = [("2330", 120_000, 9.0), ("2317", 30_000, 3.0), ("2454", 10_000, 1.0)]
    ch = etf.holdings_changes(_two_days(before, after, 1e6, 1.05e6)).set_index("code")
    assert ch.loc["2317", "excess_shares"] < -1000 and ch.loc["2317", "kind"] == "hold"
    assert ch.loc["2317", "trade_shares"] == 0
    assert ch.loc["2330", "kind"] == "add"
    assert ch.loc["2330", "excess_shares"] == 15_000 and ch.loc["2330", "trade_shares"] == 15_000
    # 買回時仍加買：實際 +10 張、超額 +20 張 → 計入 10 張
    assert etf.trade_shares(100_000, 110_000, 20_000.0) == 10_000
    assert etf.trade_shares(100_000, 100_000, -5_000.0) == 0.0
    assert etf.trade_shares(100_000, 0, -90_000.0) == -90_000


def test_detail_payload_overseas_rows_and_pre_cutover_days() -> None:
    """2026-10-09：海外持股列標 f＝1；有海外持股的 ETF 不用「存檔時略過海外持股」的舊日子（否則海外持股全變新增）。"""
    old = pd.DataFrame(
        {
            "date": ["2026-10-06"],
            "etf": ["00990A"],
            "code": ["2330"],
            "name": ["台積電"],
            "shares": [1000.0],
            "weight": [5.0],
            "units": [1e8],
        }
    )
    new = pd.DataFrame(
        {
            "date": ["2026-10-07", "2026-10-07", "2026-10-08", "2026-10-08"],
            "etf": ["00990A"] * 4,
            "code": ["2330", "NVDA US", "2330", "NVDA US"],
            "name": ["台積電", "NVIDIA", "台積電", "NVIDIA"],
            "shares": [1000.0, 10.0, 2000.0, 10.0],
            "weight": [5.0, 3.0, 9.0, 3.0],
            "units": [1e8] * 4,
            "aum": [None] * 4,
            "foreign": [False, True, False, True],
        }
    )
    payload = etf.detail_payload(pd.concat([old, new], ignore_index=True), "00990A", "主動元大AI新經濟")
    assert payload is not None and payload["dates"] == ["2026-10-07", "2026-10-08"]
    rows = {r["c"]: r for r in payload["rows"]}
    assert rows["NVDA US"]["f"] == 1 and "f" not in rows["2330"]
    # 只有台股的 ETF：舊日子照常保留
    only_tw = etf.detail_payload(pd.concat([old, new[new["code"] == "2330"]], ignore_index=True), "00990A", "x")
    assert only_tw is not None and only_tw["dates"] == ["2026-10-06", "2026-10-07", "2026-10-08"]
