"""波段策略（2026-10-01；2026-10-02 第二輪）：每一套的截斷測試（時間點正確性）、固定日期三段、九項門檻、事件分布與組合模擬的手算。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.evidence import engine, swing, universe
from pipeline.evidence import indicators as ind
from pipeline.evidence.data import EvData, cfg, revenue_table

T, C = 320, 6


def _dates(n: int) -> list[str]:
    return [d.date().isoformat() for d in pd.bdate_range("2024-01-02", periods=n)]


def _ev(n: int, seed: int = 7) -> EvData:
    """人造資料：隨機漫步價格、固定量與成交值、外資淨買超、每月營收。"""
    rng = np.random.default_rng(seed)
    dates = _dates(n)
    close = 100 * np.cumprod(1 + rng.normal(0.001, 0.02, size=(n, C)), axis=0)
    close[:, 2] *= 1.5  # 讓某一檔容易創高
    high, low, op = close * 1.01, close * 0.99, close * 1.0
    vol = 2_000_000.0 * np.exp(rng.normal(0, 0.6, size=(n, C)))  # 量有變化（量比條件需要）
    value = np.full((n, C), 3e8)
    value[:, 5] = 1e7  # 一檔不在 universe（成交值太低）
    foreign = rng.normal(0, 1e5, size=(n, C))
    trust = rng.normal(3e5, 2e5, size=(n, C))  # 投信偏買（法人建倉條件需要）
    codes = [f"{2000 + i}" for i in range(C)]
    yms = pd.period_range("2022-01", pd.Period(dates[-1][:7], "M"), freq="M")
    rev_rows = []
    for c in codes[:5]:
        base = 1000.0
        for p_ in yms:
            base *= 1 + rng.normal(0.02, 0.05)
            rev_rows.append({"code": c, "ym": str(p_), "revenue": base, "yoy": rng.normal(10, 20)})
    ev = EvData(
        dates=dates,
        codes=codes,
        names={c: c for c in codes},
        open=op,
        high=high,
        low=low,
        close=close,
        raw_close=close.copy(),
        volume=vol,
        value=value,
        foreign=foreign,
        trust=trust,
        hedge=np.zeros((n, C)),
        margin=np.full((n, C), 1000.0),
        disposition=np.zeros((n, C), dtype=bool),
        taiex=np.linspace(15000, 18000, n),
        taiex_tr=np.linspace(30000, 36000, n),
    )
    ev.revenue = revenue_table(pd.DataFrame(rev_rows), dates, codes, 10)
    ev.markets = {c: "twse" for c in codes}
    return ev


def _truncate(ev: EvData, n: int) -> EvData:
    """只保留前 n 列（T 日之後的資料全部拿掉；月營收只保留生效日 ≤ 最後一天的月份，再重算訊號列）。"""
    e2 = EvData(
        dates=ev.dates[:n],
        codes=ev.codes,
        names=ev.names,
        open=ev.open[:n],
        high=ev.high[:n],
        low=ev.low[:n],
        close=ev.close[:n],
        raw_close=ev.raw_close[:n],
        volume=ev.volume[:n],
        value=ev.value[:n],
        foreign=ev.foreign[:n],
        trust=ev.trust[:n],
        hedge=ev.hedge[:n],
        margin=ev.margin[:n],
        disposition=ev.disposition[:n],
        taiex=ev.taiex[:n],
        taiex_tr=ev.taiex_tr[:n],
    )
    rev = ev.revenue[["code", "ym", "revenue", "yoy"]]
    last_day = ev.dates[n - 1]
    keep = rev[[(pd.Period(x, "M") + 1).strftime("%Y-%m-10") <= last_day for x in rev["ym"]]]
    e2.revenue = revenue_table(keep, e2.dates, ev.codes, 10)
    e2.markets = ev.markets
    return e2


def _signals(ev: EvData, spec: dict, params: dict) -> np.ndarray:
    c = cfg()
    rules = dict(c["universe"])
    rules.update({"min_listed_days": 20, "min_avg_value": 2e7})
    uni = universe.build(ev, rules)
    f = ind.build_features(ev, uni, c["indicators"])
    mk = engine.market(ev, uni, {**c, "horizons": [5], "horizons_ref": []})
    return swing.signal_mask(spec, ev, f, uni, mk, params)


SPECS = [
    {"id": "rev_strong", "base": "rev_high12", "hold": 40, "params": {"rs_min": 50, "bias_max": 0.2}},
    {
        "id": "high_flow",
        "base": "high52",
        "hold": 20,
        "params": {"value_min": 1e8},
        "filters": ["foreign5_pos", "regime_up"],
    },
    {"id": "rs_flow", "base": "rs90", "hold": 40, "params": {"value_min": 1e8}, "filters": ["foreign5_pos"]},
    {"id": "rev_confirm", "base": "rev_confirm", "hold": 40, "params": {"rs_min": 30, "vol_ratio": 1.0}},
    {"id": "squeeze_breakout", "base": "squeeze_breakout", "hold": 40, "params": {"rs_min": 30, "vol_ratio": 1.0}},
    {"id": "inst_pullback", "base": "inst_pullback", "hold": 20, "params": {"rs_min": 30, "trust_ratio": 0.5}},
]


def test_every_registered_strategy_has_a_truncation_case():
    """config/swing.yml 的每一套都要有截斷測試（第二輪規則）。"""
    ids = {s["id"] for s in swing.cfg()["strategies"]}
    assert ids <= {s["id"] for s in SPECS}, ids - {s["id"] for s in SPECS}


@pytest.mark.parametrize("spec", SPECS, ids=[s["id"] for s in SPECS])
def test_truncation_does_not_change_past_signals(spec):
    """把資料截斷在任一日 T 之後，T 日（含）以前每一天的訊號必須完全不變。

    這個測試也抓到了 revenue_table 的前視：生效日晚於資料最後一天的月份原本會落在最後一列（審查修正 2026-10-01）。
    """
    ev = _ev(T)
    full = _signals(ev, spec, spec["params"])
    assert full[260:].any(), "人造資料應該要有訊號，否則測試沒有鑑別力"
    for n in (265, 280, 300, 319):
        part = _signals(_truncate(ev, n), spec, spec["params"])
        np.testing.assert_array_equal(part, full[:n], err_msg=f"截斷在第 {n} 列後，之前的訊號改變了（{spec['id']}）")


def test_segments_fixed_dates():
    g = {"dev": ["2017-01-01", "2022-01-01"], "val": ["2022-01-01", "2024-11-01"], "test": ["2024-11-01", None]}
    s = swing.segments("2016-02-01", "2026-09-30", g)
    assert s["dev"] == ("2017-01-01", "2022-01-01")
    assert s["val"] == ("2022-01-01", "2024-11-01")
    assert s["test"] == ("2024-11-01", "2026-10-01")
    # 訊號期間晚於開發段起點 → 開發段從訊號起點開始
    assert swing.segments("2018-06-01", "2026-09-30", g)["dev"][0] == "2018-06-01"


def test_shift_mask():
    m = np.zeros((5, 2), dtype=bool)
    m[1, 0] = True
    out = swing.shift_mask(m, 3)
    assert out[4, 0] and out.sum() == 1 and not swing.shift_mask(m, 0)[4, 0]


def test_event_dist_hand():
    d = pd.DataFrame(
        {
            "date": list("abcdefg"),
            "c": range(7),
            "net": [0.1, -0.05, -0.05, 0.2, -0.1, -0.1, -0.1],
            "mae": [-0.01] * 7,
        }
    )
    r = swing.event_dist(d)
    assert r["win"] == pytest.approx(2 / 7 * 100, abs=0.01)
    assert r["avg_win"] == pytest.approx(15.0) and r["avg_loss"] == pytest.approx(-8.0)
    assert r["payoff"] == pytest.approx(15 / 8, abs=0.01)
    assert r["loss_streak"]["max"] == 3 and r["loss_streak"]["p50"] == 2.5


GATES = {
    "t_corr_min": 3,
    "test_vs_dev_min": 0.5,
    "year_pass_ratio": 0.7,
    "perturb_pct": 0.2,
    "delay_days": [1, 3],
    "delay_keep_ratio": 0.5,
    "per_month_min": 10,
    "win_payoff": [[50, 1.5], [55, 1.2]],
    "portfolio_mdd_ratio": 1.2,
}


def _passing() -> dict:
    return {
        "segments": {"dev": {"mean_excess": 2.0}, "val": {"mean_excess": 1.0}, "test": {"mean_excess": 1.5}},
        "full": {"mean_excess": 2.0, "t_corr": 3.2, "per_month": 12, "concentration": {}},
        "other": {"mean_excess": 1.0},
        "years": {
            "2023": {"n": 5, "mean_excess": 1},
            "2024": {"n": 5, "mean_excess": 1},
            "2025": {"n": 5, "mean_excess": 1},
            "2026": {"n": 5, "mean_excess": -1},
        },
        "perturb": [{"param": "x", "mult": 0.8, "mean_excess": 0.3}, {"param": "x", "mult": 1.2, "mean_excess": 0.1}],
        "delays": [{"delay": 1, "mean_excess": 1.5}, {"delay": 3, "mean_excess": 1.0}],
        "dist": {"win": 52.0, "payoff": 1.6},
        "portfolio": {"ann_return": 12.0, "mdd": -30.0, "bench_ew": {"ann_return": 8.0, "mdd": -28.0}},
    }


def test_gates_nine_rules():
    g = swing.gates(_passing(), GATES)
    assert g["passed"] and len(g["checks"]) == 9 and all(g["checks"].values())
    # (1) 20 日扣成本超額 ≤ 0
    r = _passing()
    r["other"]["mean_excess"] = 0.0
    assert not swing.gates(r, GATES)["checks"]["net_40_20"]
    # (2) 校正後 t 2.99
    r = _passing()
    r["full"]["t_corr"] = 2.99
    assert not swing.gates(r, GATES)["checks"]["t_corrected"]
    # (3) 測試段低於開發段一半；驗證段為負
    r = _passing()
    r["segments"]["test"]["mean_excess"] = 0.9
    assert not swing.gates(r, GATES)["checks"]["segments"]
    r = _passing()
    r["segments"]["val"]["mean_excess"] = -0.1
    assert not swing.gates(r, GATES)["checks"]["segments"]
    # (4) 逐年 2/4
    r = _passing()
    r["years"]["2025"]["mean_excess"] = -1
    assert not swing.gates(r, GATES)["checks"]["years"]
    # (5) 擾動有一個 ≤ 0
    r = _passing()
    r["perturb"][1]["mean_excess"] = 0.0
    assert not swing.gates(r, GATES)["checks"]["perturb"]
    # (6) 延後 3 日只剩 40%
    r = _passing()
    r["delays"][1]["mean_excess"] = 0.8
    assert not swing.gates(r, GATES)["checks"]["delays"]
    # (7) 每月 9.9
    r = _passing()
    r["full"]["per_month"] = 9.9
    assert not swing.gates(r, GATES)["checks"]["per_month"]
    # (8) 勝率 52%、賺賠比 1.4 → 不過；55%、1.2 → 過
    r = _passing()
    r["dist"] = {"win": 52.0, "payoff": 1.4}
    assert not swing.gates(r, GATES)["checks"]["win_payoff"]
    r["dist"] = {"win": 55.0, "payoff": 1.2}
    assert swing.gates(r, GATES)["checks"]["win_payoff"]
    # (9) 回撤比基準深 1.25 倍
    r = _passing()
    r["portfolio"]["mdd"] = -35.0
    assert not swing.gates(r, GATES)["checks"]["portfolio"]


def test_portfolio_turnover_counts_executed_trades():
    """第二輪查證 2：週轉率＝實際成交筆數 ÷ 年 ÷ 槽位；槽位滿了就跳過；固定持有日出場。"""
    n = 300
    ev = _ev(n)
    c = cfg()
    rules = dict(c["universe"])
    rules.update({"min_listed_days": 20, "min_avg_value": 2e7})
    uni = universe.build(ev, rules)
    mk = engine.market(ev, uni, {**c, "horizons": [40], "horizons_ref": []})
    # 五檔在同一天（第 100 列）發出訊號，之後第 110、150 列再各一檔
    t = np.array([100, 100, 100, 100, 100, 110, 150])
    cc = np.array([0, 1, 2, 3, 4, 3, 1])
    d = engine.evaluate(mk, t, cc, 40)
    d = d[d["status"] == "ok"]
    sim = swing.simulate_portfolio(mk, d, ev.value, 2, 1)
    # 2 個槽位：第 101 列進 2 檔，其餘 3 檔跳過；第 111 列槽位仍滿（出場在第 141 列）→ 跳過；第 151 列進 1 檔
    assert sim["executed"] == 3 and sim["skipped_full"] == 4
    assert sim["equity"].shape == (n - 1,) and np.isfinite(sim["equity"]).all()
    # 共用規則：全部不允許 → 沒有成交
    sim2 = swing.simulate_portfolio(mk, d, ev.value, 2, 1, allowed=np.zeros((n, C), dtype=bool))
    assert sim2["executed"] == 0 and sim2["skipped_rule"] == len(d)


def test_perf_hand():
    v = np.array([1.0, 1.1, 1.0, 1.2] + [1.2] * 20)
    p = swing.perf(v)
    assert p["mdd"] == pytest.approx(-100 / 11, abs=0.01) and p["dd_days"] == 1 and p["total"] == pytest.approx(20.0)
