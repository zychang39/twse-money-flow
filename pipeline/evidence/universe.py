"""1.1 樣本範圍：逐日的 universe（T, C）bool，用全期間的逐日行情（含之後下市者）建立，避免存活者偏差。"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def listed_days(close: np.ndarray) -> np.ndarray:
    """每一天距離該股第一次出現收盤價的交易日數（第一天為 1；尚未掛牌為 0）。

    資料起點（2016-09-01）之前已上市的股票從資料起點起算，評估期間（2022 起）一律滿 120 日。
    """
    seen = np.isfinite(close)
    started = np.maximum.accumulate(seen, axis=0)
    return np.cumsum(started, axis=0)


def rolling_mean(a: np.ndarray, n: int, min_periods: int | None = None) -> np.ndarray:
    return pd.DataFrame(a).rolling(n, min_periods=min_periods or n).mean().to_numpy()


def build(ev: Any, rules: dict[str, Any]) -> np.ndarray:
    """universe[t, c]：訊號日 t 可納入評估。

    條件（全部成立）：普通股（載入時已排除 ETF、ETN、存託憑證、受益證券）、上市櫃滿 min_listed_days 個交易日、
    20 日平均成交值 ≥ min_avg_value、收盤價（未還原）≥ min_close、當天有收盤價、不在處置期間、
    不是變更交易（全額交割）或管理股票（v3 M1：逐日標記，見 data.full_delivery_mask）。
    """
    n = int(rules.get("avg_value_days", 20))
    avg_value = rolling_mean(np.nan_to_num(ev.value, nan=0.0), n)
    ok = (
        np.isfinite(ev.raw_close)
        & (listed_days(ev.raw_close) >= int(rules["min_listed_days"]))
        & (np.nan_to_num(avg_value) >= float(rules["min_avg_value"]))
        & (np.nan_to_num(ev.raw_close) >= float(rules["min_close"]))
    )
    if rules.get("exclude_disposition", True):
        ok &= ~ev.disposition
    fd = getattr(ev, "full_delivery", None)
    if rules.get("exclude_full_delivery", True) and fd is not None and fd.shape == ok.shape:
        ok &= ~fd
    return ok
