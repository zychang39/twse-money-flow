"""v3 M3-2：事件時間累積超額曲線、峰值日與峰值是否落在觀察窗邊界（手算預期值；2026-10-03 移除 alpha 耗盡日）。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.evidence import curve, engine

NaN = np.nan


def test_peak_day_and_edge_flag():
    """累積超額 [1, 2, 3, 3, 2.5, 2.4, 2.4, 2.3, 2.5]：峰值第 3、4 日（取第一個＝3），不在窗邊界；
    一路上升的曲線峰值在最後一天（第 K 日）→ peak_at_edge。alpha 耗盡日已移除。"""
    m = np.array([1, 2, 3, 3, 2.5, 2.4, 2.4, 2.3, 2.5])
    assert curve.peak_day(m) == 3
    assert not curve.at_edge(3, len(m))
    up = np.array([1.0, 2, 3, 4, 5, 6])
    assert curve.peak_day(up) == 6 and curve.at_edge(6, 6)
    assert curve.peak_day(np.array([NaN, NaN])) is None
    assert not curve.at_edge(None, 120)
    assert not hasattr(curve, "exhaustion_day")


def _market(close: np.ndarray, uni: np.ndarray) -> engine.Market:
    T, _ = close.shape
    return engine.Market(
        dates=[f"2026-01-{i + 5:02d}" for i in range(T)],
        open=close.copy(),
        high=close.copy(),
        low=close.copy(),
        close=close,
        volume=np.where(np.isfinite(close), 1.0, 0.0),
        universe=uni,
        bench=np.full(T, 100.0),
        bench_is_tr=True,
        regime_up=np.ones(T, bool),
        trend_up=np.ones(T, bool),
        quarter_end=np.zeros(T, bool),
        limit_up_pct=100,
        gap_pct=100,
        limit_down_pct=-100,
        horizons=[2],
        etf={"0050": {"open": np.full(T, 50.0), "close": np.array([50.0, 50, 51, 52, 52])}},
    )


def test_curve_ew_and_0050_by_hand():
    """兩檔、開＝收：A 100 → 110 → 121 → 121 → 121；B 100 → 100 → 90 → 停牌（沿用 90）。訊號第 0 列、第 1 列開盤進場。
    A（開盤 110）：第 1、2、3 日收盤 110、121、121 → 0%、10%、10%；B（開盤 100）：100、90、90 → 0%、−10%、−10%。
    同日等權＝0、0、0 → A 相對等權 0、10、10%。0050 開盤 50、第 1–3 日收盤 50、51、52 → 0、2、4% → A 相對 0050：0、8、6%。"""
    close = np.array(
        [[100.0, 100], [110, 100], [121, 90], [121, NaN], [121, NaN]],
    )
    uni = np.ones((5, 2), bool)
    mk = _market(close, uni)
    mk.close = close.copy()
    ev = pd.DataFrame({"e": [1], "c": [0]})
    out = curve.curve(mk, ev, 3, reps=50, seed=1)
    # 進場第 1 列開盤＝110：A 第 1、2、3 日收盤 110、121、121 → 0%、10%、10%
    # 等權：A 0、10、10%；B 100 → 90 → 90：0、−10、−10% → 平均 0、0、0；相對等權＝0、10、10%
    assert out["ew"]["mean"] == pytest.approx([0.0, 10.0, 10.0])
    # 0050 開盤 50、收盤 50、51、52 → 0%、2%、4% → 相對 0050：0、8、6%
    assert out["0050"]["mean"] == pytest.approx([0.0, 8.0, 6.0])
    assert out["ew"]["peak"] == 2 and out["0050"]["peak"] == 2
    assert out["ew"]["peak_at_edge"] is False and "exhaust" not in out["ew"] and out["days"] == 3


def test_boot_band_constant_series():
    D = np.ones((10, 3)) * 0.02
    lo, hi = curve.boot_band(D, 100, 7)
    assert lo == pytest.approx([0.02] * 3) and hi == pytest.approx([0.02] * 3)


def test_per_day_table_annualizes():
    """超額 ÷ N × 250：10 日 +1.00% → 25.0%；60 日 +3.00% → 12.5%；120 日標為參考。"""
    from pipeline.evidence.data import cfg
    from pipeline.evidence.run import per_day_table

    hs = {
        "10": {"n": 100, "mean_excess": 1.0, "t": 2.0},
        "60": {"n": 80, "mean_excess": 3.0, "t": 2.5},
        "120": {"n": 50, "mean_excess": 5.0},
    }
    out = per_day_table(hs, cfg())
    assert out["10"]["per_day_ann"] == 25.0 and out["60"]["per_day_ann"] == 12.5
    assert out["120"]["ref"] and not out["10"]["ref"]


def test_choose_n_walk_forward_not_in_sample_max():
    """訓練期（第 1 年）：N＝5 每持有日年化 1% × 50 ＝ 50%，N＝10 為 1.5% × 25 ＝ 37.5% → 選 5；
    驗證期 N＝10 表現較好也不改（不挑全樣本最大值）。"""
    from pipeline.evidence.data import cfg
    from pipeline.evidence.run import choose_n

    c = cfg()

    def frame(n_days: int, train: float, valid: float) -> pd.DataFrame:
        rows = []
        for i in range(40):  # 訓練期 40 個進場日
            rows.append(
                {
                    "t": i,
                    "c": i,
                    "e": i + 1,
                    "x": i + 1 + n_days,
                    "status": "ok",
                    "date": f"2024-{1 + i // 20:02d}-{1 + i % 20:02d}",
                    "exc_mkt": train,
                    "net": train,
                }
            )
        for i in range(40):  # 驗證期
            rows.append(
                {
                    "t": 100 + i,
                    "c": 100 + i,
                    "e": 101 + i,
                    "x": 101 + i + n_days,
                    "status": "ok",
                    "date": f"2025-{3 + i // 20:02d}-{1 + i % 20:02d}",
                    "exc_mkt": valid,
                    "net": valid,
                }
            )
        return pd.DataFrame(rows)

    frames = {5: frame(5, 0.01, 0.0), 10: frame(10, 0.015, 0.05)}
    c2 = {**c, "horizons": [5, 10]}
    out = choose_n(frames, [("2024-01-01", "2025-01-01"), ("2025-01-01", "2026-01-01")], c2)
    assert out["chosen"] == 5
    st = out["steps"][0]
    assert st["train_per_day_ann"] == pytest.approx(50.0) and st["valid_mean_excess"] == pytest.approx(0.0)
