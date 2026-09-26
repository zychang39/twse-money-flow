"""指標計算（純函式，皆有手算測試）。寬表慣例：index = 日期（遞增），columns = 代號。"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
import pandas as pd


# ------------------------------------------------------------------ 還原價
def adjustment_factor(dates: list[str], events: Iterable[tuple[str, float]]) -> np.ndarray:
    """回傳每個日期的還原因子：adj(t) = raw(t) × Π{f_e : 事件日 e > t}。

    events：(事件日 ISO, 因子 f = 參考價 ÷ 前收盤)。事件日當天及之後因子為 1（已是除權息後價格）。
    """
    n = len(dates)
    factor = np.ones(n)
    for ev_date, f in events:
        if not f or not np.isfinite(f) or f <= 0:
            continue
        idx = np.searchsorted(np.asarray(dates), ev_date, side="left")  # 第一個 >= 事件日的位置
        if idx > 0:
            factor[:idx] *= f
    return factor


def adjustment_table(dates: list[str], codes: list[str], events: pd.DataFrame) -> pd.DataFrame:
    """寬表版還原因子。events 需有 date、code、factor 欄。"""
    out = pd.DataFrame(1.0, index=dates, columns=codes)
    if events.empty:
        return out
    ev = events.dropna(subset=["factor"])
    ev = ev[(ev["factor"] > 0) & np.isfinite(ev["factor"])]
    for code, part in ev.groupby("code"):
        if code in out.columns:
            out[code] = adjustment_factor(dates, zip(part["date"], part["factor"], strict=True))
    return out


# ------------------------------------------------------------------ 連買天數
def streak_last(values: np.ndarray) -> int:
    """最新連續淨買超天數（>0）；最新為淨賣超時回傳負的連續天數；0 或缺值中斷。"""
    vals = [v for v in values if v == v]  # 去除 NaN（非交易日）
    if not vals:
        return 0
    last = vals[-1]
    if last == 0:
        return 0
    sign = 1 if last > 0 else -1
    count = 0
    for v in reversed(vals):
        if (v > 0 and sign > 0) or (v < 0 and sign < 0):
            count += 1
        else:
            break
    return sign * count


def streak_series(values: pd.Series) -> pd.Series:
    """每一天的連買（正）／連賣（負）天數，供回測逐日使用。"""
    out = np.zeros(len(values), dtype=float)
    run = 0
    for i, v in enumerate(values.to_numpy(dtype=float)):
        if v != v:  # NaN
            out[i] = np.nan
            continue
        if v > 0:
            run = run + 1 if run > 0 else 1
        elif v < 0:
            run = run - 1 if run < 0 else -1
        else:
            run = 0
        out[i] = run
    return pd.Series(out, index=values.index)


def streak_table(net: pd.DataFrame) -> pd.DataFrame:
    return net.apply(streak_series)


# ------------------------------------------------------------------ 動能
def pct_change_n(adj: pd.DataFrame, n: int) -> pd.DataFrame:
    return adj / adj.shift(n) - 1


def rs_raw(adj: pd.DataFrame, windows: list[int], weights: list[float]) -> pd.DataFrame:
    """RS 原始值 = Σ w_k × R_k；任一視窗資料不足則為 NaN。"""
    total = None
    for n, w in zip(windows, weights, strict=True):
        part = pct_change_n(adj, n) * w
        total = part if total is None else total + part
    assert total is not None
    return total


def cross_percentile(frame: pd.DataFrame) -> pd.DataFrame:
    """每一列（日期）在橫斷面上的百分位（0–100），平均排名處理相同值。"""
    ranks = frame.rank(axis=1, method="average")
    counts = frame.notna().sum(axis=1)
    return (ranks.sub(0.5).div(counts, axis=0) * 100).where(frame.notna())


def moving_average(adj: pd.DataFrame, n: int) -> pd.DataFrame:
    return adj.rolling(n, min_periods=n).mean()


def dist_from_high(adj: pd.DataFrame, n: int) -> pd.DataFrame:
    high = adj.rolling(n, min_periods=min(n, 60)).max()
    return adj / high - 1


# ------------------------------------------------------------------ 估值百分位
def own_percentile(series: pd.Series, lookback: int, min_obs: int) -> pd.Series:
    """每一天的值在自身過去 lookback 日（含當日）中的百分位：(小於 + 0.5×等於) ÷ 有效數 × 100。"""
    arr = series.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    for i in range(len(arr)):
        cur = arr[i]
        if cur != cur:
            continue
        window = arr[max(0, i - lookback + 1) : i + 1]
        window = window[~np.isnan(window)]
        if len(window) < min_obs:
            continue
        out[i] = ((window < cur).sum() + 0.5 * (window == cur).sum()) / len(window) * 100
    return pd.Series(out, index=series.index)


def last_percentile(values: np.ndarray, current: float) -> float | None:
    vals = values[~np.isnan(values)]
    if len(vals) == 0 or current != current:
        return None
    return float(((vals < current).sum() + 0.5 * (vals == current).sum()) / len(vals) * 100)


# ------------------------------------------------------------------ 法人成本線
def cost_line(net_shares: pd.Series, avg_price: pd.Series, window: int) -> pd.Series:
    """只納入視窗內淨買超 > 0 的日子：Σ(淨買 × 均價) ÷ Σ 淨買。無淨買超日 → NaN。"""
    buys = net_shares.clip(lower=0).fillna(0)
    weighted = (buys * avg_price).where(buys > 0, 0).fillna(0)
    num = weighted.rolling(window, min_periods=1).sum()
    den = buys.rolling(window, min_periods=1).sum()
    return (num / den).where(den > 0)


# ------------------------------------------------------------------ 融資 × 股價四象限
def margin_quadrant(margin_change_pct: float | None, price_change_pct: float | None, threshold: float) -> str | None:
    if margin_change_pct is None or price_change_pct is None:
        return None
    if margin_change_pct != margin_change_pct or price_change_pct != price_change_pct:
        return None
    if margin_change_pct > threshold:
        return "up_price_down" if price_change_pct < 0 else "up_price_up"
    if margin_change_pct < -threshold:
        return "down_price_down" if price_change_pct < 0 else "down_price_up"
    return "flat"


# ------------------------------------------------------------------ 月營收
def revenue_metrics(rev: pd.Series) -> dict[str, float | int | bool | str | None]:
    """rev：index 為 'YYYY-MM'（遞增）、值為月營收。回傳最新月份的各項指標（百分比單位）。"""
    rev = rev.dropna().sort_index()
    if rev.empty:
        return {}
    months = list(rev.index)
    latest = months[-1]

    def shift_year(ym: str) -> str:
        return f"{int(ym[:4]) - 1:04d}-{ym[5:7]}"

    def yoy_at(ym: str) -> float | None:
        prev = shift_year(ym)
        if prev in rev.index and rev[prev] > 0:
            return float(rev[ym] / rev[prev] - 1) * 100
        return None

    yoys = [yoy_at(m) for m in months]
    yoy = yoys[-1]
    mom = float(rev.iloc[-1] / rev.iloc[-2] - 1) * 100 if len(rev) >= 2 and rev.iloc[-2] > 0 else None
    last12 = rev.iloc[-12:]
    is_high = bool(len(rev) >= 12 and rev.iloc[-1] >= last12.max())
    high_ratio = float(rev.iloc[-1] / last12.max() * 100) if len(rev) >= 2 and last12.max() > 0 else None
    valid3 = [y for y in yoys[-3:] if y is not None]
    valid12 = [y for y in yoys[-12:] if y is not None]
    yoy3 = float(np.mean(valid3)) if len(valid3) == 3 else None
    yoy12 = float(np.mean(valid12)) if len(valid12) >= 6 else None
    growth = 0
    for y in reversed(yoys):
        if y is not None and y > 0:
            growth += 1
        else:
            break
    year = latest[:4]
    cum = rev[[m for m in months if m[:4] == year]].sum()
    cum_prev_months = [shift_year(m) for m in months if m[:4] == year]
    cum_prev = rev.reindex(cum_prev_months).sum() if all(m in rev.index for m in cum_prev_months) else None
    cum_yoy = float(cum / cum_prev - 1) * 100 if cum_prev else None
    return {
        "ym": latest,
        "revenue": float(rev.iloc[-1]),
        "yoy": yoy,
        "mom": mom,
        "cum_yoy": cum_yoy,
        "is_12m_high": is_high,
        "high_ratio": high_ratio,
        "yoy_3m": yoy3,
        "yoy_12m": yoy12,
        "yoy_trend": (yoy3 - yoy12) if yoy3 is not None and yoy12 is not None else None,
        "growth_months": growth,
    }


# ------------------------------------------------------------------ 相關性
def correlation(a: pd.Series, b: pd.Series, window: int, min_obs: int) -> float | None:
    ra, rb = a.pct_change(fill_method=None).iloc[-window:], b.pct_change(fill_method=None).iloc[-window:]
    both = pd.concat([ra, rb], axis=1).dropna()
    if len(both) < min_obs:
        return None
    return float(both.iloc[:, 0].corr(both.iloc[:, 1]))
