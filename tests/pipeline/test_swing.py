"""波段策略（2026-10-01）：截斷測試（時間點正確性）、三段切分、門檻、事件分布的手算。"""

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
    vol = np.full((n, C), 2_000_000.0)
    value = np.full((n, C), 3e8)
    value[:, 5] = 1e7  # 一檔不在 universe（成交值太低）
    foreign = rng.normal(0, 1e5, size=(n, C))
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
        trust=np.zeros((n, C)),
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
]


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


def test_segments_60_20_20():
    s = swing.segments("2022-01-01", "2026-12-31", {"dev": 0.6, "val": 0.2})
    assert s["dev"][0] == "2022-01-01" and s["test"][1] == "2027-01-01"
    # 1825 天：60% → 第 1095 天（2024-12-31）、80% → 第 1460 天（2025-12-31）
    assert s["dev"][1] == "2024-12-31" and s["val"] == ("2024-12-31", "2025-12-31") and s["test"][0] == "2025-12-31"


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


def test_gates_all_rules():
    sw = {
        "gates": {
            "t_corrected_min": 3,
            "test_vs_dev_min": 0.5,
            "year_pass_ratio": 0.7,
            "per_month_min": 10,
            "perturb_pct": 0.2,
        }
    }
    r = {
        "segments": {"dev": {"mean_excess": 2.0}, "test": {"mean_excess": 1.5}},
        "full": {"t_corr": 3.2, "per_month": 12},
        "years": {
            "2023": {"n": 5, "mean_excess": 1},
            "2024": {"n": 5, "mean_excess": 1},
            "2025": {"n": 5, "mean_excess": 1},
            "2026": {"n": 5, "mean_excess": -1},
        },
        "perturb": [{"param": "x", "mult": 0.8, "mean_excess": 0.3}, {"param": "x", "mult": 1.2, "mean_excess": 0.1}],
    }
    g = swing.gates(r, sw, {"id": "rev_high12", "mean_excess": 1.0})
    assert g["passed"] and all(g["checks"].values())
    # 測試段低於開發段一半 → 不過；校正後 t 剛好 3 → 不過（要 > 3）；每月 9.9 → 不過
    r2 = {**r, "segments": {"dev": {"mean_excess": 2.0}, "test": {"mean_excess": 0.9}}}
    assert not swing.gates(r2, sw, {"mean_excess": 0.5})["checks"]["test_vs_dev"]
    r3 = {**r, "full": {"t_corr": 3.0, "per_month": 9.9}}
    g3 = swing.gates(r3, sw, {"mean_excess": 0.5})
    assert not g3["checks"]["t_corrected"] and not g3["checks"]["per_month"]
    # 逐年 2/4 為正 → 不過
    r4 = {**r, "years": {**r["years"], "2025": {"n": 5, "mean_excess": -1}}}
    assert not swing.gates(r4, sw, {"mean_excess": 0.5})["checks"]["years"]
    # 測試段沒有贏過現有最佳 → 不過
    assert not swing.gates(r, sw, {"id": "x", "mean_excess": 1.6})["checks"]["test_beats_best"]
