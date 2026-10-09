"""候選池用的訊號（規格第三節）：沿用策略庫既有的訊號定義與生效日，只在指標效度評估的 universe 內計算。

- 營收高帶量（swing.yml `rev_confirm`）：營收創 12 個月新高的生效日（次月 10 日當天或之後第一個交易日）收盤上漲、
  量 ≥ vol_ratio × 前 20 日均量，且 RS 百分位 ≥ rs_min（參數取自 config/swing.yml，與策略庫同一份）。
- 營收一年高（strategies.yml `revenue_year_high` → 效度測試 rev_high12）：當月營收 > 前 12 個月最高（12 個月都有資料），
  訊號列同上。
- 漲多投信買（`leader_trust` → 效度測試 combo_rs_trust）：RS 百分位 ≥ combo_rs 且投信連買 ≥ combo_trust_run 日，
  事件為兩者首次同時成立日（config/evidence.yml indicators）。只供顯示。
RS 百分位在這裡沿用效度評估的算法（universe 內的百分位名次，evidence.indicators.cs_percentile）；
檢查清單的 RS 另用 App 個股頁的定義（checklist.cross_pct），兩者在 PR 說明中並列。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.evidence import indicators as ind
from pipeline.momentum_flow.data import FlowData


def strategy_params() -> dict[str, float]:
    swing = config.load("swing")
    spec: dict[str, Any] = next((s for s in swing.get("strategies", []) if s.get("id") == "rev_confirm"), {})
    p = dict(spec.get("params") or {})
    ev = config.load("evidence")["indicators"]
    return {
        "rev_confirm_rs_min": float(p.get("rs_min", 70)),
        "rev_confirm_vol_ratio": float(p.get("vol_ratio", 1.5)),
        "combo_rs": float(ev.get("combo_rs", 80)),
        "combo_trust_run": float(ev.get("combo_trust_run", 3)),
    }


def window_any(mask: np.ndarray, n: int) -> np.ndarray:
    """最近 n 列（含當列）是否曾成立。"""
    m = pd.DataFrame(mask.astype(np.int8)).rolling(n, min_periods=1).max().to_numpy()
    return np.asarray(m) > 0


def compute(fd: FlowData) -> dict[str, Any]:
    ev = fd.ev
    T = fd.T
    p = strategy_params()
    uni = fd.ev_universe
    rf = ind.revenue_features(ev.revenue)
    ev12 = ind.revenue_event(rf, "high12", T, fd.codes)
    rs_ev = ind.cs_percentile(ind.rs_raw(fd.close), uni)
    with np.errstate(invalid="ignore"):
        up = ind.ret(fd.close, 1) > 0
        big = ind.volume_ratio(fd.volume, 20) >= p["rev_confirm_vol_ratio"]
        a = ev12 & up & big & (rs_ev >= p["rev_confirm_rs_min"]) & uni
        b = ev12 & uni
        trust = np.nan_to_num(fd.trust, nan=0.0)
        trun = ind.run_length(trust > 0) >= int(p["combo_trust_run"])
        rs80 = rs_ev >= p["combo_rs"]
    ref = ind.first_true(rs80 & trun, np.isfinite(rs_ev) & np.isfinite(fd.trust)) & uni
    return {"a": a, "b": b, "ref": ref, "rev_features": rf, "rs_ev": rs_ev, "params": p}
