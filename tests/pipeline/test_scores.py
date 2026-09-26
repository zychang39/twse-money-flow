"""分數系統與逐日面板：手算驗證、無前視（月營收生效日）。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import metrics, scores
from pipeline.derive.metrics import MetricPanels

DATES = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]


def panel(values: list[float], code: str = "A") -> pd.DataFrame:
    return pd.DataFrame({code: values}, index=DATES, dtype=float)


def test_map_score_linear_and_matrix():
    assert scores.map_score(np.array([-5.0, 0.0, 3.0, 99.0]), {"type": "linear", "x0": -5, "x1": 5}).tolist() == [
        0,
        50,
        80,
        100,
    ]
    m = {
        "type": "margin_matrix",
        "threshold_pct": 2,
        "scores": {"up_price_down": 15, "up_price_up": 40, "flat": 50, "down_price_down": 55, "down_price_up": 80},
    }
    x = panel([5, 5, -5, 1])
    pc = panel([-1, 1, 2, -3])
    assert scores.map_score(x, m, pc)["A"].tolist() == [15, 40, 80, 50]


def test_compute_scores_chip_and_composite():
    mp = MetricPanels(dates=DATES, codes=["A"])
    mp.panels = {
        "foreign_streak": panel([0, 1, 2, 3]),  # 最新 3 → 80
        "trust_streak": panel([0, 0, 0, -5]),  # → 0
        "margin_change_5d": panel([0, 0, 0, 5]),
        "price_change_5d": panel([0, 0, 0, -2]),  # 融資增、股價跌 → 15
        "rs_percentile": panel([np.nan, np.nan, 50, 90]),  # 權重 2 → 90
        "dist_52w_high": panel([0, 0, 0, 0]),  # → 100
    }
    out = scores.compute_scores(mp)
    assert out["chip"]["A"].iloc[-1] == pytest.approx((80 + 0 + 15) / 3)
    # 動能：RS 90（權重 2）、距高點 100（權重 1）、均線缺 → (180 + 100) / 3
    assert out["momentum"]["A"].iloc[-1] == pytest.approx(280 / 3)
    assert out["composite"]["A"].iloc[-1] == pytest.approx((95 / 3 + 280 / 3) / 2)
    # 只有一個類別有分數時不給綜合分
    only = MetricPanels(dates=DATES, codes=["A"])
    only.panels = {"rs_percentile": panel([10, 20, 30, 40])}
    single = scores.compute_scores(only)
    assert single["momentum"]["A"].iloc[-1] == 40 and np.isnan(single["composite"]["A"].iloc[-1])


def test_rolling_own_percentile_matches_definition():
    s = pd.DataFrame({"A": [10.0, 20.0, 30.0, 20.0, np.nan, 20.0]})
    got = metrics.rolling_own_percentile(s, lookback=4, min_obs=3)["A"].tolist()
    assert np.isnan(got[1]) and got[2] == pytest.approx(5 / 6 * 100) and got[3] == pytest.approx(50)
    assert np.isnan(got[4]) and got[5] == pytest.approx(100 / 3)


def test_revenue_effective_date_no_lookahead():
    assert metrics.effective_date_for_month("2026-08", None, 10) == "2026-09-10"
    assert metrics.effective_date_for_month("2026-12", None, 10) == "2027-01-10"
    assert metrics.effective_date_for_month("2026-08", "2026-09-05", 10) == "2026-09-05"
    dates = ["2026-09-04", "2026-09-07", "2026-09-10", "2026-09-11"]
    rev = pd.DataFrame(
        {
            "code": ["A"] * 14,
            "ym": [f"2025-{m:02d}" for m in range(7, 13)] + [f"2026-{m:02d}" for m in range(1, 9)],
            "revenue": [100.0] * 13 + [150.0],
            "first_seen": [None] * 14,
        }
    )
    out = metrics.revenue_panels(rev, dates, ["A"])
    yoy = out["revenue_yoy"]["A"]
    # 2026-08 營收在 9/10（含）才生效；9/04、9/07 看到的是 7 月（年增 0%）
    assert yoy.loc["2026-09-07"] == pytest.approx(0.0)
    assert yoy.loc["2026-09-10"] == pytest.approx(50.0) and yoy.loc["2026-09-11"] == pytest.approx(50.0)


def test_as_of_panel_forward_fill():
    rec = pd.DataFrame({"code": ["A", "A"], "effective": ["2026-09-22", "2026-09-24"], "v": [1.0, 2.0]})
    out = metrics.as_of_panel(rec, "v", DATES, ["A"])["A"].tolist()
    assert np.isnan(out[0]) and out[1:] == [1.0, 1.0, 2.0]
