"""指標計算：以手算預期值驗證。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import indicators as ind

DATES = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]


def test_adjustment_factor_single_dividend():
    # 1/07 除息：前收 100、參考價 98 → 因子 0.98；1/07 以前（1/05、1/06）乘 0.98
    f = ind.adjustment_factor(DATES, [("2026-01-07", 0.98)])
    assert f.tolist() == [0.98, 0.98, 1.0, 1.0, 1.0]


def test_adjustment_factor_multiple_events_compound():
    # 1/06 除權息 0.9、1/09 減資 3.0 → 1/05：0.9 × 3.0 = 2.7；1/06–1/08：3.0；1/09：1
    f = ind.adjustment_factor(DATES, [("2026-01-06", 0.9), ("2026-01-09", 3.0)])
    assert f == pytest.approx([2.7, 3.0, 3.0, 3.0, 1.0])


def test_adjustment_ignores_invalid_and_out_of_range():
    f = ind.adjustment_factor(DATES, [("2025-12-31", 0.5), ("2026-01-07", float("nan")), ("2026-01-08", 0)])
    assert f.tolist() == [1.0] * 5


def test_adjusted_price_continuity_across_dividend():
    # 除息 2 元：前收 100 → 參考價 98；除息日開盤 98 → 還原後日報酬為 0（不是 −2%）
    raw = pd.Series([100.0, 100.0, 98.0, 99.0, 99.0], index=DATES)
    af = ind.adjustment_factor(DATES, [("2026-01-07", 98.0 / 100.0)])
    adj = raw * af
    assert adj.pct_change().iloc[2] == pytest.approx(0.0)
    assert adj.iloc[-1] == 99.0  # 最新價格等於原始價格


def test_adjustment_table():
    events = pd.DataFrame({"date": ["2026-01-07"], "code": ["A"], "factor": [0.5]})
    t = ind.adjustment_table(DATES, ["A", "B"], events)
    assert t["A"].tolist() == [0.5, 0.5, 1, 1, 1] and t["B"].tolist() == [1] * 5


@pytest.mark.parametrize(
    "values,expected",
    [
        ([1, -1, 2, 3, 4], 3),
        ([1, 2, -3, -1], -2),
        ([5, 0], 0),
        ([], 0),
        ([1, np.nan, 2], 2),  # 非交易日 NaN 忽略
        ([-1, -1, -1, -1, -1, -1], -6),
    ],
)
def test_streak_last(values, expected):
    assert ind.streak_last(np.array(values, dtype=float)) == expected


def test_streak_series():
    s = ind.streak_series(pd.Series([1.0, 2.0, -1.0, 0.0, 3.0]))
    assert s.tolist() == [1, 2, -1, 0, 1]


def test_rs_raw_and_percentile():
    adj = pd.DataFrame({"A": [100, 110, 121], "B": [100, 100, 90], "C": [100, 105, 110]}, dtype=float)
    raw = ind.rs_raw(adj, [1, 2], [0.5, 0.5])
    # A：R1 = 121/110−1 = 0.1、R2 = 0.21 → 0.155
    assert raw["A"].iloc[-1] == pytest.approx(0.155)
    pct = ind.cross_percentile(raw.iloc[[-1]])
    # 排名 B < C < A → 百分位 (rank−0.5)/3×100
    assert pct.iloc[0].tolist() == pytest.approx([(3 - 0.5) / 3 * 100, (1 - 0.5) / 3 * 100, (2 - 0.5) / 3 * 100])


def test_own_percentile():
    s = pd.Series([10.0, 20.0, 30.0, 20.0])
    p = ind.own_percentile(s, lookback=4, min_obs=3)
    # 最後一天 20：小於 20 的有 1 個（10）、等於 2 個 → (1 + 0.5×2)/4 = 50
    assert np.isnan(p.iloc[1]) and p.iloc[3] == pytest.approx(50.0)
    assert ind.last_percentile(np.array([10.0, 20.0, 30.0]), 30.0) == pytest.approx((2 + 0.5) / 3 * 100)


def test_cost_line_only_net_buy_days():
    net = pd.Series([1000.0, -500.0, 3000.0, 0.0])
    price = pd.Series([10.0, 11.0, 12.0, 13.0])
    cl = ind.cost_line(net, price, window=3)
    # 視窗 [0..2]：(1000×10 + 3000×12) / 4000 = 11.5
    assert cl.iloc[2] == pytest.approx(11.5)
    # 視窗 [1..3]：只有 3000@12 → 12
    assert cl.iloc[3] == pytest.approx(12.0)
    assert ind.cost_line(pd.Series([-1.0, -2.0]), pd.Series([1.0, 1.0]), 2).isna().all()


@pytest.mark.parametrize(
    "m,p,expected",
    [
        (5, -1, "up_price_down"),
        (5, 1, "up_price_up"),
        (-5, -1, "down_price_down"),
        (-5, 2, "down_price_up"),
        (1, -3, "flat"),
        (None, 1, None),
    ],
)
def test_margin_quadrant(m, p, expected):
    assert ind.margin_quadrant(m, p, 2) == expected


def test_revenue_metrics():
    idx = [f"{y}-{m:02d}" for y in (2025, 2026) for m in range(1, 13)][:20]  # 2025-01 … 2026-08
    vals = [100.0] * 12 + [110, 120, 130, 140, 150, 160, 170, 180]
    m = ind.revenue_metrics(pd.Series(vals, index=idx))
    assert m["ym"] == "2026-08"
    assert m["yoy"] == pytest.approx(80.0)
    assert m["mom"] == pytest.approx(180 / 170 * 100 - 100)
    assert m["is_12m_high"] is True and m["high_ratio"] == pytest.approx(100.0)
    assert m["growth_months"] == 8
    assert m["yoy_3m"] == pytest.approx((60 + 70 + 80) / 3)
    # 累計年增率：(110+…+180)/(100×8) − 1
    assert m["cum_yoy"] == pytest.approx((sum(vals[12:]) / 800 - 1) * 100)


def test_correlation():
    a = pd.Series(np.cumprod(1 + np.array([0.01, -0.02, 0.03, 0.01, -0.01] * 10)))
    assert ind.correlation(a, a * 2, window=60, min_obs=40) == pytest.approx(1.0)
    assert ind.correlation(a, a, window=10, min_obs=40) is None


def test_infer_split_event_from_price_gap():
    from pipeline.derive.adjust import all_events, infer_events, snap_ratio

    dates = [f"2025-06-{d:02d}" for d in range(2, 16)]
    # 1 拆 4：6/12 起價格約為 1/4；交易所標示不比價（漲跌為空）
    close = pd.DataFrame({"S": [200.0] * 10 + [50.5, 51.0, 50.0, 49.0]}, index=dates)
    open_ = pd.DataFrame({"S": [200.0] * 10 + [50.2, 50.8, 50.0, 49.0]}, index=dates)
    change = pd.DataFrame({"S": [0.0] * 10 + [np.nan, 0.5, -1.0, -1.0]}, index=dates)
    ev = infer_events(close, open_, change, known=set())
    assert ev.to_dict("records") == [{"date": "2025-06-12", "code": "S", "factor": 0.25, "source": "inferred"}]
    # 還原後在分割日沒有斷層
    af = ind.adjustment_factor(dates, zip(ev["date"], ev["factor"], strict=True))
    adj = close["S"] * af
    assert abs(adj.iloc[10] / adj.iloc[9] - 1) < 0.02
    assert snap_ratio(0.26) == 0.25 and snap_ratio(0.7) == 0.7
    # 官方事件已涵蓋時不重複推估
    official = pd.DataFrame({"date": ["2025-06-12"], "code": ["S"], "factor": [0.25]})
    both = all_events(close, open_, change, official)
    assert len(both) == 1 and both.iloc[0]["source"] == "official"


def test_infer_ignores_ipo_first_days_and_normal_moves():
    from pipeline.derive.adjust import infer_events

    dates = [f"2025-01-{d:02d}" for d in range(1, 11)]
    close = pd.DataFrame({"N": [10, 20, 40, 60, 80, 85, 90, 95, 99, 100.0]}, index=dates)  # 上市初期暴漲
    ev = infer_events(close, close, close * np.nan, known=set())
    assert ev.empty
