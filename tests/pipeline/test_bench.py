"""v3 M2：基準組——策略層的迴歸、績效指標與回撤天數（手算預期值）。"""

from __future__ import annotations

import numpy as np
import pytest

from pipeline.evidence import strategies


def test_month_end_returns():
    """1/2 100 → 1/30 110（+10%）→ 2/27 99（−10%）。"""
    r = strategies.month_end_returns(
        np.array([100.0, 105, 110, 99]), ["2026-01-02", "2026-01-15", "2026-01-30", "2026-02-27"]
    )
    assert r.index.tolist() == ["2026-01", "2026-02"]
    assert r.to_numpy() == pytest.approx([0.10, -0.10])


def test_regress_exact_line():
    """y ＝ 0.01 ＋ 1.5x（沒有殘差）：β 1.5、月 α 1% → 年化 12%、R² 1。"""
    x = np.array([0.02, -0.01, 0.03, 0.0, -0.02, 0.01, 0.04])
    y = 0.01 + 1.5 * x
    out = strategies.regress(y, x)
    assert out["beta"] == 1.5 and out["alpha_ann"] == pytest.approx(12.0) and out["r2"] == 1.0
    assert out["months"] == 7


def test_regress_alpha_t_by_hand():
    """x ＝ [−1, 0, 1, −1, 0, 1]%、y ＝ x ＋ [0, 2, 0, 0, 2, 0]%（β 1）：α＝2/3%、殘差 [−2/3, 4/3, −2/3]×2；
    s² ＝ Σe² ÷ (6 − 2) ＝ (8/3 × 2 ÷ 1e4) ÷ 4 → se(α) ＝ √(s² × (X'X)⁻¹₀₀)，(X'X)⁻¹₀₀ ＝ Σx² ÷ (nΣx² − (Σx)²) ＝ 4e−4 ÷ (6 × 4e−4) ＝ 1/6。"""
    x = np.array([-0.01, 0.0, 0.01, -0.01, 0.0, 0.01])
    y = x + np.array([0, 0.02, 0, 0, 0.02, 0])
    out = strategies.regress(y, x)
    a = 0.02 / 3
    s2 = (2 * (4 / 9 + 16 / 9 + 4 / 9) * 1e-4) / 4
    t = a / np.sqrt(s2 / 6)
    assert out["beta"] == 1.0 and out["alpha_ann"] == pytest.approx(a * 12 * 100, abs=1e-3)
    assert out["alpha_t"] == pytest.approx(round(t, 2))


def test_drawdown_days_and_perf():
    """100 → 110（高點）→ 99 → 104.5 → 121：回撤 2 天（99、104.5），最大回撤 −10%。"""
    v = np.array([100.0, 110, 99, 104.5, 121] + [121.0] * 20)
    assert strategies.drawdown_days(v) == 2
    dates = [f"2026-{1 + i // 20:02d}-{1 + i % 20:02d}" for i in range(v.size)]
    p = strategies.perf(v, dates)
    assert p["mdd"] == pytest.approx(-10.0) and p["dd_days"] == 2 and p["total"] == pytest.approx(21.0)
    years = v.size / 252
    ann = 1.21 ** (1 / years) - 1
    assert p["ann_return"] == pytest.approx(ann * 100, abs=1e-3)
    assert p["calmar"] == pytest.approx(round(ann / 0.10, 2))
