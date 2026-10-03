"""2026-10-03 判定卡與分級（pipeline/evidence/judge.py）：分級規則、隨機選股模擬可重現、出場規則樣本內／樣本外切分。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.evidence import engine, exits, judge

G = dict(judge.DEFAULTS["grade"])


def card(sig_t, opp_ex=1.0, opp_t=2.5, ps=0.9, bs=0.8):
    return {
        "sig": {"t": sig_t, "excess": 1.0},
        "opp": {"excess": opp_ex, "t": opp_t, "port": {"sharpe": ps}, "bench_port": {"sharpe": bs}},
    }


def test_grade_rules_prespecified():
    # 有效：四項全過
    g = judge.grade(card(3.2), 9.0, 5000, G)
    assert g["id"] == "valid" and g["label"] == "有效" and "待前瞻驗證" in g["notes"]
    assert judge.grade(card(3.2), 9.0, 5000, G, forward_ready=True)["notes"] == []
    # 訊號顯著但任一項 0050 條件不過 → 訊號顯著・未勝 0050
    for c in (card(3.0, opp_ex=-0.1), card(3.0, opp_t=1.99), card(3.0, ps=0.5, bs=0.6), card(3.0, ps=None)):
        g = judge.grade(c, 9.0, 5000, G)
        assert g["id"] == "sig_only" and g["label"] == "訊號顯著・未勝 0050"
    # 2.0 ≤ t < 3.0 → 觀察中（即使 0050 條件全過）
    assert judge.grade(card(2.99), 9.0, 5000, G)["id"] == "watch"
    assert judge.grade(card(2.0), 9.0, 5000, G)["id"] == "watch"
    # t < 2、沒有 t → 無效
    assert judge.grade(card(1.99), 9.0, 5000, G)["id"] == "invalid"
    assert judge.grade(card(None), 9.0, 5000, G)["label"] == "無效"
    # 負的 t 不會因為取絕對值而過門檻
    assert judge.grade(card(-3.5), 9.0, 5000, G)["id"] == "invalid"


def test_grade_sample_insufficient_caps_at_watch():
    g = judge.grade(card(4.0), 2.9, 5000, G)  # 期間 < 3 年
    assert g["id"] == "watch" and "樣本不足" in g["notes"] and "待前瞻驗證" not in g["notes"]
    g = judge.grade(card(4.0), 9.0, 299, G)  # 去重樣本 < 300
    assert g["id"] == "watch" and "樣本不足" in g["notes"]
    g = judge.grade(card(3.5, opp_ex=-1), 9.0, 100, G)  # 訊號顯著・未勝 0050 也降為觀察中
    assert g["id"] == "watch"
    g = judge.grade(card(1.0), 1.0, 10, G)  # 無效仍是無效，但附註樣本不足
    assert g["id"] == "invalid" and "樣本不足" in g["notes"]
    assert judge.grade(card(4.0), 3.0, 300, G)["id"] == "valid"  # 門檻含等號


def test_grade_rule_text_has_thresholds():
    txt = judge.grade_rule_text(G)
    assert "t ≥ 3" in txt and "t ≥ 2" in txt and "Sharpe" in txt and "300" in txt
    for word in ("買進", "賣出", "推薦"):
        assert word not in txt


def _market(T=60, C=6, seed=0):
    rng = np.random.default_rng(seed)
    close = 100 * np.cumprod(1 + rng.normal(0.001, 0.02, (T, C)), axis=0)
    mk = engine.Market(
        dates=[(pd.Timestamp("2021-10-01") + pd.offsets.BDay(i)).date().isoformat() for i in range(T)],
        open=close.copy(),
        high=close * 1.01,
        low=close * 0.99,
        close=close,
        volume=np.ones((T, C)),
        universe=np.ones((T, C), bool),
        bench=np.linspace(100, 110, T),
        bench_is_tr=True,
        regime_up=np.ones(T, bool),
        trend_up=np.ones(T, bool),
        quarter_end=np.zeros(T, bool),
        limit_up_pct=100,
        gap_pct=100,
        limit_down_pct=-100,
        horizons=[5],
        etf={"0050": {"open": np.linspace(50, 55, T), "close": np.linspace(50, 55, T)}},
    )
    return mk


def _trades(mk, n=40, seed=1, hold=5):
    rng = np.random.default_rng(seed)
    T, C = mk.close.shape
    e = rng.integers(1, T - hold - 1, n)
    c = rng.integers(0, C, n)
    x = e + hold
    return pd.DataFrame({"e": e, "c": c, "x": x, "entry": mk.open[e, c], "px": mk.open[x, c]})


def test_book_spec_order_is_value_desc_and_matches_old_simulate():
    """預先指定排序＝訊號日成交值由大到小；與舊的 strategies.simulate 逐日權益相同。"""
    from pipeline.evidence.strategies import simulate

    mk = _market()
    tr = _trades(mk)
    value = np.arange(mk.close.size, dtype=float).reshape(mk.close.shape)[:, ::-1].copy()
    book = judge.Book(mk, tr, value, 1)
    keys = book.spec_keys()
    # 同一天：成交值較大者排序鍵較小
    for idx in book.by_day.values():
        if idx.size > 1:
            ordered = idx[np.argsort(keys[idx])]
            assert list(book.v[ordered]) == sorted(book.v[ordered], reverse=True)
    for k in (1, 3, 5):
        assert book.run(k, keys) == pytest.approx(simulate(mk, tr, value, k, 1))


def test_random_selection_reproducible_with_seed():
    mk = _market(T=120, C=10)
    tr = _trades(mk, n=200, seed=4)
    book = judge.Book(mk, tr, np.ones(mk.close.shape), 1)
    a = judge.random_selection(book, 5, 30, 7)
    b = judge.random_selection(book, 5, 30, 7)
    assert a == b and a["n"] == 30 and a["seed"] == 7
    assert a["cagr"]["p5"] <= a["cagr"]["p50"] <= a["cagr"]["p95"]
    assert a["mdd"]["p5"] <= a["mdd"]["p50"] <= a["mdd"]["p95"] <= 0
    c = judge.random_selection(book, 5, 30, 8)
    assert c != a  # 不同種子 → 不同的抽樣


def test_max_adverse_window():
    """權益 1 → 1.2 → 0.9 → 1.0 → 0.6 → 1.5：任一日起 w 日內相對起點的最大跌幅。
    w＝1、2：最壞為 1.0 → 0.6（−40%）；w＝3：1.2 → 0.6（−50%，等於全期間最大回撤）。"""
    eq = np.array([1.0, 1.2, 0.9, 1.0, 0.6, 1.5])
    assert judge.max_adverse(eq, 1)["value"] == pytest.approx(-40.0)
    r = judge.max_adverse(eq, 2, [f"d{i}" for i in range(6)])
    assert r["value"] == pytest.approx(-40.0) and r["start"] == "d3" and r["window"] == 2
    assert judge.max_adverse(eq, 3)["value"] == pytest.approx(-50.0)


def test_cagr_mdd_matches_perf():
    from pipeline.evidence.strategies import perf

    eq = 1 + np.cumsum(np.r_[0, np.random.default_rng(2).normal(0.001, 0.01, 299)])
    a, m = judge.cagr_mdd(eq)
    p = perf(eq, [(pd.Timestamp("2020-01-01") + pd.Timedelta(days=i)).date().isoformat() for i in range(300)])
    assert round(a * 100, 3) == p["ann_return"] and round(m * 100, 3) == p["mdd"]


def test_exits_split_selects_in_sample_only():
    """出場規則只用 train_end 以前的事件選；樣本外另列且不影響選擇。"""
    mk = _market(T=80, C=8, seed=3)
    rng = np.random.default_rng(5)
    t = rng.integers(0, 60, 120)
    c = rng.integers(0, 8, 120)
    cand = engine.evaluate(mk, t, c, 5)
    cand = cand[cand["status"] == "ok"]

    class Ev:
        volume = mk.volume
        close, high, low = mk.close, mk.high, mk.low

    cfg = {
        "horizons": [5],
        "primary_horizon": 5,
        "verdict": {"wf_min_events": 5},
        "exits": {
            "max_days": 10,
            "stop_pct": [-5],
            "stop_cap": 5,
            "trailing_pct": [8],
            "ma_days": [10],
            "exhaust_days": 3,
            "exhaust_vol": 0.5,
            "exhaust_move_pct": 2,
        },
    }
    train_end = mk.dates[30]
    r = exits.compare_split(mk, cand, Ev(), cfg, train_end, min_events=5, fallback=("fixed", "5"))
    assert r["train_end"] == train_end and r["chosen"]["basis"] == "in_sample"
    dates = np.asarray(mk.dates)
    for row in r["rules"]:
        assert row["in_sample"]["n"] == len(engine.dedupe(cand[dates[cand["t"]] <= train_end])) or row["rule"] != "fixed"
        assert "oos" in row and "label" in row
    best = max(r["rules"], key=lambda x: x["in_sample"]["rel"]["0050"])
    assert r["chosen"]["rule"] == best["rule"] and sum(x["chosen"] for x in r["rules"]) == 1
    # 樣本內沒有事件 → 預先指定的固定持有
    r2 = exits.compare_split(mk, cand, Ev(), cfg, "2000-01-01", min_events=5, fallback=("fixed", "5"))
    assert r2["chosen"]["basis"] == "fallback" and r2["chosen"]["rule"] == "fixed" and r2["note"]


def test_yearly_table_diff():
    rows = judge.yearly_table({"yearly": {"2022": 10.0, "2023": -5.0}}, {"yearly": {"2022": 12.5, "2023": 1.0}})
    assert rows == [
        {"year": "2022", "port": 10.0, "bench": 12.5, "diff": -2.5},
        {"year": "2023", "port": -5.0, "bench": 1.0, "diff": -6.0},
    ]


def test_multi_test_reason():
    class T:
        def __init__(self, nv, ng):
            self.variants = {f"v{i}": None for i in range(nv)}
            self.grid = list(range(ng))

    j = judge.jcfg({})
    r = judge.multi_test([T(1, 0), T(3, 27)], j)
    # (1 + 0 + 0) + (1 + 2 + 27) = 31 個指標假說；＋ 11 次波段嘗試；× 2 種判定持有期
    assert r["M"] == (31 + 11) * 2 and r["t_min"] == 3.0
    assert "84" in r["reason"] and "0.27%" in r["reason"]
    assert r["bonferroni_t"] > 3.0
