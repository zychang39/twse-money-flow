"""1.5 統計：日曆時間法、Wilson 信賴區間、日期分層 bootstrap、分組（逐年、樣本外、環境）。"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

NO_ENV = "本期間無此環境樣本"


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float | None, float | None]:
    """Wilson 95% 信賴區間（比例，0–1）。"""
    if n <= 0:
        return None, None
    p = k / n
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return center - half, center + half


def calendar_series(df: pd.DataFrame, col: str = "exc_mkt", key: str = "e") -> pd.Series:
    """日曆時間法：同一進場日的所有事件先平均成一個日報酬（index＝進場列，遞增）。"""
    s = df[[key, col]].dropna()
    return s.groupby(key)[col].mean().sort_index()


def mean_t(x: np.ndarray) -> tuple[float | None, float | None, float | None]:
    """平均、標準誤、t 值（樣本標準差 ddof=1）。"""
    n = x.size
    if n == 0:
        return None, None, None
    m = float(x.mean())
    if n < 2:
        return m, None, None
    se = float(x.std(ddof=1) / math.sqrt(n))
    return m, se, (m / se if se > 0 else None)


def newey_west_t(x: np.ndarray, lags: int) -> float | None:
    """Newey-West（Bartlett 權重）t 值：持有期重疊造成相鄰日報酬自我相關時的參考值（不用於判定）。"""
    n = x.size
    if n < 3:
        return None
    d = x - x.mean()
    s = float(d @ d) / n
    for k in range(1, min(lags, n - 1) + 1):
        w = 1 - k / (lags + 1)
        s += 2 * w * float(d[k:] @ d[:-k]) / n
    if s <= 0:
        return None
    return float(x.mean() / math.sqrt(s / n))


def bootstrap_ci(x: np.ndarray, reps: int, seed: int, alpha: float = 0.05) -> tuple[float | None, float | None]:
    """日期分層 bootstrap：以「日期」為抽樣單位（每個日期的事件平均視為一個觀測）重抽 reps 次，取平均的 2.5／97.5 百分位。"""
    n = x.size
    if n < 2:
        return None, None
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(reps, n))
    means = x[idx].mean(axis=1)
    lo, hi = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return float(lo), float(hi)


def pct(v: float | None) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v) * 100, 3)


def summarize(df: pd.DataFrame, cfg: dict[str, Any], horizon: int, col: str = "exc_mkt") -> dict[str, Any]:
    """一組事件（已去重）的完整統計。日曆時間法為主要統計；勝率、中位數、MAE、MFE 為事件層級。"""
    st = cfg["stats"]
    n = len(df)
    if n == 0:
        return {"n": 0, "dates": 0}
    cal = calendar_series(df, col).to_numpy()
    m, se, t = mean_t(cal)
    lo, hi = bootstrap_ci(cal, int(st["bootstrap"]), int(st["seed"]))
    wins = int((df["net"] > 0).sum())
    wl, wh = wilson(wins, n)
    ewins = int((df[col] > 0).sum())
    ewl, ewh = wilson(ewins, n)
    return {
        "n": n,
        "stocks": int(df["c"].nunique()),
        "dates": int(cal.size),
        "mean_excess": pct(m),
        "se": pct(se),
        "t": None if t is None else round(t, 2),
        "t_nw": None if (nw := newey_west_t(cal, horizon)) is None else round(nw, 2),
        "ci": [pct(lo), pct(hi)],
        "mean_net": pct(float(df["net"].mean())),
        "mean_exc_idx": pct(float(df["exc_idx"].mean())) if df["exc_idx"].notna().any() else None,
        "median_net": pct(float(df["net"].median())),
        "win": pct(wins / n),
        "win_ci": [pct(wl), pct(wh)],
        "win_excess": pct(ewins / n),
        "win_excess_ci": [pct(ewl), pct(ewh)],
        "mae": pct(float(df["mae"].mean())),
        "mae_worst": pct(float(df["mae"].min())),
        "mfe": pct(float(df["mfe"].mean())),
        "locked": int(df["locked"].sum()),
        "lock_loss": pct(float(df["lock_loss"].mean())) if df["lock_loss"].notna().any() else None,
        "delisted": int(df["delisted"].sum()),
        "halted": int(df["halted"].sum()) if "halted" in df.columns else 0,
        "dl100": delist_conservative(df, cfg, col),
        "bench": bench_stats(df, cfg),
    }


def bench_stats(df: pd.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
    """v3 M2：同一組事件對四種基準的超額（日曆時間法平均、t）；bootstrap 區間只算等權與 0050。"""
    from pipeline.evidence.engine import BENCH_COLS, BOOT_BENCH

    st = cfg["stats"]
    out: dict[str, Any] = {}
    for key, col in BENCH_COLS.items():
        if col not in df.columns or not df[col].notna().any():
            out[key] = None
            continue
        cal = calendar_series(df, col).to_numpy()
        m, _, t = mean_t(cal)
        item: dict[str, Any] = {"mean_excess": pct(m), "t": None if t is None else round(t, 2), "dates": int(cal.size)}
        if key in BOOT_BENCH:
            lo, hi = bootstrap_ci(cal, int(st["bootstrap"]), int(st["seed"]))
            item["ci"] = [pct(lo), pct(hi)]
        item["win"] = pct(float((df[col] > 0).mean()))
        out[key] = item
    return out


def delist_conservative(df: pd.DataFrame, cfg: dict[str, Any], col: str = "exc_mkt") -> dict[str, Any] | None:
    """v3 M1-2 保守版本：持有期間下市的事件淨報酬視為 −100%（基準報酬不變：超額＝−1 − 基準）。

    沒有下市事件時為 None（與主結果相同）。
    """
    if "delisted" not in df.columns or not df["delisted"].any():
        return None
    d = df.copy()
    m = d["delisted"].to_numpy(dtype=bool)
    neg_bench = d[col] - d["net"]  # 超額＝淨報酬 − 基準 → 超額 − 淨報酬＝−基準
    d.loc[m, col] = -1.0 + neg_bench[m]
    d.loc[m, "net"] = -1.0
    out = brief(d, cfg, col)
    out["affected"] = int(m.sum())
    return out


def brief(df: pd.DataFrame, cfg: dict[str, Any], col: str = "exc_mkt") -> dict[str, Any]:
    """分組用的精簡統計（日曆時間法平均、t、bootstrap 區間、事件數、勝率）。沒有樣本時標示「本期間無此環境樣本」。"""
    if len(df) == 0:
        return {"n": 0, "note": NO_ENV}
    st = cfg["stats"]
    cal = calendar_series(df, col).to_numpy()
    m, _, t = mean_t(cal)
    lo, hi = bootstrap_ci(cal, int(st["bootstrap"]), int(st["seed"]))
    return {
        "n": len(df),
        "dates": int(cal.size),
        "mean_excess": pct(m),
        "t": None if t is None else round(t, 2),
        "ci": [pct(lo), pct(hi)],
        "win": pct(float((df["net"] > 0).mean())),
    }


def oos_cut(dates: list[str], fraction: float) -> str | None:
    """樣本外起點：訊號期間（首次到最後訊號日的日曆時間）的最後 fraction。"""
    if not dates:
        return None
    first, last = pd.Timestamp(min(dates)), pd.Timestamp(max(dates))
    cut = last - (last - first) * fraction
    return cut.date().isoformat()


def groups(df: pd.DataFrame, cfg: dict[str, Any], oos_start: str | None, col: str = "exc_mkt") -> dict[str, Any]:
    """分組：逐年、樣本外（oos_start 之後）、大盤 240 日線上／下、60 日趨勢上／下、季底作帳／其他。"""
    out: dict[str, Any] = {"years": {}}
    for y, part in df.groupby("year"):
        out["years"][str(y)] = brief(part, cfg, col)
    if oos_start:
        out["oos"] = {**brief(df[df["date"] >= oos_start], cfg, col), "start": oos_start}
        out["ins"] = brief(df[df["date"] < oos_start], cfg, col)
    for key, flag in (("regime", "regime_up"), ("trend", "trend_up"), ("quarter_end", "quarter_end")):
        out[key] = {"on": brief(df[df[flag]], cfg, col), "off": brief(df[~df[flag]], cfg, col)}
    return out


def significant(s: dict[str, Any], t_threshold: float) -> bool:
    """顯著為正：平均 > 0、t ≥ 門檻、bootstrap 區間不含 0。"""
    m, t, ci = s.get("mean_excess"), s.get("t"), s.get("ci") or [None, None]
    return bool(m is not None and m > 0 and t is not None and t >= t_threshold and ci[0] is not None and ci[0] > 0)
