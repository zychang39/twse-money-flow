"""大盤狀態機（規格第二節）：加權股價指數（非報酬指數）收盤與 MA60／MA240 → 原始狀態 raw → 生效狀態 eff。純函式。

- raw(t)：1＝收盤 > MA60 且 > MA240；2＝收盤 ≤ MA60 且 > MA240；3＝收盤 ≤ MA240；0＝資料不足（MA240 無值）。
- eff(t)：第一個有 MA240 的日子 eff＝raw；降級（raw > eff(t−1)）當日生效；升級需要最近 upgrade_days 個交易日
  最差的 raw 都優於 eff(t−1)（這 upgrade_days 天都要有 raw，否則維持）。raw 無值的日子沿用前一日 eff。
- 曝險上限：狀態 1＝100%、2＝60%、3＝30%。
- 升級倒數：只在 raw(T) < eff(T) 時有值＝upgrade_days − k，k＝自 T 往回連續 raw < eff(T) 的天數。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.momentum_flow.params import PARAMS

INSUFFICIENT = 0


def moving_average(x: np.ndarray, n: int) -> np.ndarray:
    """截至當日（含）最近 n 日的簡單平均；不足 n 日為 NaN。"""
    return np.asarray(pd.Series(np.asarray(x, dtype=float)).rolling(n, min_periods=n).mean().to_numpy())


def raw_states(close: np.ndarray, ma60: np.ndarray, ma240: np.ndarray) -> np.ndarray:
    c, s, l_ = (np.asarray(a, dtype=float) for a in (close, ma60, ma240))
    out = np.zeros(len(c), dtype=np.int8)
    ok = np.isfinite(c) & np.isfinite(s) & np.isfinite(l_)
    with np.errstate(invalid="ignore"):
        out[ok & (c > s) & (c > l_)] = 1
        out[ok & (c <= s) & (c > l_)] = 2
        out[ok & (c <= l_)] = 3
    return out


def effective_states(raw: np.ndarray, upgrade_days: int | None = None) -> np.ndarray:
    n_up = int(upgrade_days or PARAMS["upgrade_days"])
    r = np.asarray(raw, dtype=np.int8)
    eff = np.zeros(len(r), dtype=np.int8)
    prev = INSUFFICIENT
    for t in range(len(r)):
        cur = int(r[t])
        if cur == INSUFFICIENT:
            eff[t] = prev
            continue
        if prev == INSUFFICIENT or cur > prev:
            eff[t] = cur
        else:
            window = r[max(0, t - n_up + 1) : t + 1]
            if len(window) == n_up and bool(np.all(window > 0)):
                worst = int(window.max())
                eff[t] = worst if worst < prev else prev
            else:
                eff[t] = prev
        prev = int(eff[t])
    return eff


def upgrade_countdown(raw: np.ndarray, eff: np.ndarray, t: int, upgrade_days: int | None = None) -> int | None:
    """T 日的升級倒數；raw(T) ≥ eff(T) 或資料不足時為 None。"""
    n_up = int(upgrade_days or PARAMS["upgrade_days"])
    cur = int(eff[t])
    if cur == INSUFFICIENT or int(raw[t]) == INSUFFICIENT or int(raw[t]) >= cur:
        return None
    k = 0
    i = t
    while i >= 0 and int(raw[i]) != INSUFFICIENT and int(raw[i]) < cur:
        k += 1
        i -= 1
    return max(0, n_up - k)


def entered_index(eff: np.ndarray, t: int) -> int:
    """目前生效狀態是從哪一列開始的（連續相同 eff 的起點）。"""
    i = t
    while i > 0 and int(eff[i - 1]) == int(eff[t]):
        i -= 1
    return i


def exposure_cap(state: int) -> float | None:
    return None if state == INSUFFICIENT else float(PARAMS["exposure"][int(state)])


def compute(dates: list[str], close: np.ndarray, history_days: int = 250) -> dict[str, Any]:
    """整段流程：回傳 T 日摘要與近 history_days 個交易日的每日 收盤／MA60／MA240／raw／eff，以及完整的 raw／eff 陣列。"""
    c = np.asarray(close, dtype=float)
    ma60 = moving_average(c, int(PARAMS["ma_short"]))
    ma240 = moving_average(c, int(PARAMS["ma_long"]))
    raw = raw_states(c, ma60, ma240)
    eff = effective_states(raw)
    t = len(dates) - 1
    state = int(eff[t]) if t >= 0 else INSUFFICIENT
    i0 = entered_index(eff, t) if t >= 0 else 0
    rows = []
    for i in range(max(0, len(dates) - history_days), len(dates)):
        rows.append(
            [
                dates[i],
                None if not np.isfinite(c[i]) else round(float(c[i]), 2),
                None if not np.isfinite(ma60[i]) else round(float(ma60[i]), 2),
                None if not np.isfinite(ma240[i]) else round(float(ma240[i]), 2),
                int(raw[i]) or None,
                int(eff[i]) or None,
            ]
        )
    return {
        "date": dates[t] if t >= 0 else None,
        "state": state or None,
        "raw": (int(raw[t]) or None) if t >= 0 else None,
        "exposure": exposure_cap(state),
        "entered": dates[i0] if state else None,
        "countdown": upgrade_countdown(raw, eff, t) if t >= 0 else None,
        "history_cols": ["date", "close", "ma60", "ma240", "raw", "eff"],
        "history": rows,
        "_raw": raw,
        "_eff": eff,
        "_ma60": ma60,
        "_ma240": ma240,
    }
