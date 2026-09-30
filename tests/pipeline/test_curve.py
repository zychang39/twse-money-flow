"""v3 M3-2：事件時間累積超額曲線、峰值日與 alpha 耗盡日（手算預期值）。"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline.evidence import curve, engine

NaN = np.nan


def test_peak_and_exhaustion_day():
    """累積超額 [1, 2, 3, 3, 2.5, 2.4, 2.4, 2.3, 2.5]：峰值第 3、4 日（取第一個＝3）；
    邊際 [1, 1, 1, 0, −0.5, −0.1, 0, −0.1, +0.2] → 第 4 日起連續 5 日 ≤ 0 → 耗盡日 4。"""
    m = np.array([1, 2, 3, 3, 2.5, 2.4, 2.4, 2.3, 2.5])
    assert curve.peak_day(m) == 3
    assert curve.exhaustion_day(m) == 4
    assert curve.exhaustion_day(np.array([1.0, 2, 3, 4, 5, 6])) is None
    assert curve.peak_day(np.array([NaN, NaN])) is None


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


def test_boot_band_constant_series():
    D = np.ones((10, 3)) * 0.02
    lo, hi = curve.boot_band(D, 100, 7)
    assert lo == pytest.approx([0.02] * 3) and hi == pytest.approx([0.02] * 3)
