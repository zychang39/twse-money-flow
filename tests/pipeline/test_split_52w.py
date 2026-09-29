"""#2（可用性測試第 2 輪）：距 52 週高點用還原價。

golden：tests/fixtures/golden/split_52w.json（區間內有 1:4 分割），vitest（web/src/lib/fundamentals.test.ts）共用。
分割前的原始高點 480 要先乘上還原因子 0.25（= 120）再和現價比較；用原始價會得到假的 −77%。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline.derive import indicators as ind
from pipeline.derive import metrics
from pipeline.derive.build import Panels

GOLDEN = json.loads((Path(__file__).parents[1] / "fixtures/golden/split_52w.json").read_text(encoding="utf-8"))
DATES: list[str] = GOLDEN["dates"]
CLOSE = pd.DataFrame({"S": [np.nan if v is None else v for v in GOLDEN["close"]]}, index=DATES)
EVENTS = pd.DataFrame([{"date": GOLDEN["split_date"], "code": "S", "factor": GOLDEN["split_factor"]}])


def test_adjustment_factor_from_split_event() -> None:
    af = ind.adjustment_table(DATES, ["S"], EVENTS)
    assert af["S"].tolist() == pytest.approx(GOLDEN["af"])


def test_dist_from_high_uses_adjusted_prices() -> None:
    af = ind.adjustment_table(DATES, ["S"], EVENTS)
    dist = ind.dist_from_high(CLOSE * af, GOLDEN["window"]) * 100
    last = dist["S"].dropna().iloc[-1]
    assert last == pytest.approx(GOLDEN["expected"]["dist_52w_high_pct"], abs=1e-6)
    # 對照：用原始價會把分割前的高點當成現在的價位
    raw = (ind.dist_from_high(CLOSE, GOLDEN["window"]) * 100)["S"].dropna().iloc[-1]
    assert raw == pytest.approx(GOLDEN["expected"]["raw_dist_pct_wrong"], abs=1e-6)


def test_build_metrics_dist_52w_high_is_adjusted() -> None:
    """整條 build_metrics 路徑：dist_52w_high 面板取自 Panels.adj_close（close × af）。"""
    af = ind.adjustment_table(DATES, ["S"], EVENTS)
    nan = pd.DataFrame(np.nan, index=DATES, columns=["S"])
    p = Panels(
        dates=DATES, codes=["S"], names={"S": "S"}, markets={"S": "twse"}, industries={}, shares={},
        open=CLOSE, high=CLOSE, low=CLOSE, close=CLOSE, volume=nan + 1000, value=nan + 1e6, change=nan + 0,
        af=af, foreign_net=nan, trust_net=nan, dealer_net=nan, total_net=nan, margin_balance=nan, margin_limit=nan,
        short_balance=nan, pe=nan, pb=nan, dy=nan,
    )  # fmt: skip
    mp = metrics.build_metrics(p, pd.DataFrame())
    last = mp.panels["dist_52w_high"]["S"].dropna().iloc[-1]
    assert last == pytest.approx(GOLDEN["expected"]["dist_52w_high_pct"], abs=1e-6)
