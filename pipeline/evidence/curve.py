"""v3 M3-2 事件時間累積超額曲線與 alpha 衰減（METHODOLOGY §10.12）。

事件：主結果（判定用持有天數）的去重事件，與總表同一組。每筆事件在進場後第 k 個交易日（k＝1…K）收盤的累積報酬
  R_k ＝ 收盤(e+k−1) ÷ 開盤(e) − 1（還原價；停牌、下市後沿用最後收盤；不扣成本，曲線看的是形狀與時間）
減去同一段期間的基準：
  (a) 同日等權 universe：同一個進場日、訊號日在 universe 且進場日可進場的全部股票，同樣的 R_k 取平均；
  (c) 0050：還原收盤(e+k−1) ÷ 還原開盤(e) − 1。
日曆時間法：同一進場日的事件先平均，再對日期平均；95% 帶＝日期分層 bootstrap（同一組重抽權重用在每一個 k）。
峰值日＝平均累積超額最大的 k；alpha 耗盡日＝邊際超額（第 k 日 − 第 k−1 日）連續 5 日 ≤ 0 的第一天。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence.engine import Market


def filled_close(mk: Market) -> np.ndarray:
    """收盤沿用到下一個收盤（停牌、下市後保持最後收盤）；掛牌前維持空值。"""
    cached = getattr(mk, "_close_ff", None)
    if cached is None:
        cached = pd.DataFrame(mk.close).ffill().to_numpy()
        mk._close_ff = cached  # type: ignore[attr-defined]
    return np.asarray(cached)


def market_paths(mk: Market, K: int) -> np.ndarray:
    """(K, T)：以第 e 列開盤進場的同日等權 universe 在第 k 日收盤的平均累積報酬（k＝1…K）。"""
    cached = getattr(mk, "_mpath", None)
    if cached is not None and cached.shape[0] >= K:
        return np.asarray(cached[:K])
    T, C = mk.open.shape
    ff = filled_close(mk)
    elig = np.zeros((T, C), dtype=bool)
    elig[1:] = mk.universe[:-1] & mk.tradable[1:] & ~mk.limit_up_open[1:]
    out = np.full((K, T), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        for k in range(1, K + 1):
            rows = np.arange(T) + k - 1
            ok_rows = rows < T
            r = np.full((T, C), np.nan)
            r[ok_rows] = ff[rows[ok_rows]] / mk.open[ok_rows] - 1
            r = np.where(elig & np.isfinite(r), r, np.nan)
            cnt = np.isfinite(r).sum(axis=1)
            out[k - 1] = np.where(cnt > 0, np.nansum(r, axis=1) / np.maximum(cnt, 1), np.nan)
    mk._mpath = out  # type: ignore[attr-defined]
    return out


def etf_paths(mk: Market, code: str, K: int) -> np.ndarray | None:
    s = (mk.etf or {}).get(code)
    if s is None:
        return None
    T = len(mk.dates)
    out = np.full((K, T), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        for k in range(1, K + 1):
            rows = np.arange(T) + k - 1
            ok = rows < T
            out[k - 1, ok] = s["close"][rows[ok]] / s["open"][ok] - 1
    return out


def event_paths(mk: Market, e: np.ndarray, c: np.ndarray, K: int) -> np.ndarray:
    """(n, K)：每筆事件第 k 日收盤的累積報酬；超出資料範圍為空值。"""
    T = len(mk.dates)
    ff = filled_close(mk)
    rows = e[:, None] + np.arange(K)[None, :]
    ok = rows < T
    with np.errstate(invalid="ignore", divide="ignore"):
        r = ff[np.minimum(rows, T - 1), c[:, None]] / mk.open[e, c][:, None] - 1
    return np.where(ok, r, np.nan)


def date_matrix(e: np.ndarray, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """同一進場日平均 → (日期數, K)；回傳進場列與矩陣。"""
    df = pd.DataFrame(x)
    df["e"] = e
    g = df.groupby("e").mean()
    return g.index.to_numpy(), g.to_numpy()


def boot_band(D: np.ndarray, reps: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """日期分層 bootstrap 的 2.5／97.5 百分位（每個 k 用同一組重抽權重；空值不計入分母）。"""
    n = D.shape[0]
    if n < 2:
        nanv = np.full(D.shape[1], np.nan)
        return nanv, nanv
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(reps, n))
    W = np.zeros((reps, n))
    for i in range(reps):
        W[i] = np.bincount(idx[i], minlength=n)
    ok = np.isfinite(D)
    num = W @ np.where(ok, D, 0.0)
    den = W @ ok.astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        means = num / den
    lo, hi = np.nanquantile(means, [0.025, 0.975], axis=0)
    return lo, hi


def peak_day(mean: np.ndarray) -> int | None:
    """平均累積超額最大的 k（1 起算）；全部空值 → None。"""
    if not np.isfinite(mean).any():
        return None
    return int(np.nanargmax(mean)) + 1


def exhaustion_day(mean: np.ndarray, run: int = 5) -> int | None:
    """alpha 耗盡日：邊際超額（第 k 日 − 第 k−1 日）連續 run 日 ≤ 0 的第一天 k（第 1 日的邊際＝第 1 日本身）。"""
    m = np.asarray(mean, dtype=float)
    marg = np.diff(np.concatenate([[0.0], m]))
    bad = ~(marg > 0)  # ≤ 0（空值也視為沒有新增超額）
    for k in range(len(m) - run + 1):
        if bad[k : k + run].all():
            return k + 1
    return None


def curve(mk: Market, events: pd.DataFrame, K: int, reps: int, seed: int) -> dict[str, Any]:
    """一組（已去重、可進場）事件的累積超額曲線：等權與 0050 各一條，附 95% 帶、峰值日與 alpha 耗盡日。"""
    if events.empty:
        return {"n": 0}
    e = events["e"].to_numpy(dtype=np.int64)
    c = events["c"].to_numpy(dtype=np.int64)
    R = event_paths(mk, e, c, K)
    out: dict[str, Any] = {"n": len(events), "k": list(range(1, K + 1))}
    benches: dict[str, np.ndarray | None] = {"ew": market_paths(mk, K), "0050": etf_paths(mk, "0050", K)}
    for key, B in benches.items():
        if B is None:
            continue
        X = R - B[:, e].T
        _, D = date_matrix(e, X)
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(np.where(np.isfinite(D), D, np.nan), axis=0)
        lo, hi = boot_band(D, reps, seed)
        out[key] = {
            "mean": [_r(v) for v in mean],
            "lo": [_r(v) for v in lo],
            "hi": [_r(v) for v in hi],
            "dates": [int(v) for v in np.isfinite(D).sum(axis=0)],
            "peak": peak_day(mean),
            "exhaust": exhaustion_day(mean),
        }
    return out


def _r(v: float) -> float | None:
    return None if not np.isfinite(v) else round(float(v) * 100, 3)
