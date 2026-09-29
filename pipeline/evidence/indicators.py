"""1.9 指標定義（全部使用還原價；量能用成交股數；均線用收盤價簡單移動平均）。

每個函式都是純函式（輸入 (T, C) 陣列），有手算預期值的單元測試（tests/pipeline/test_evidence.py）。
籌碼買賣超一律以「淨買超股數 ÷ 前 20 日均量（不含當日）」標準化。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


# ------------------------------------------------------------------ 共用
def shift(a: np.ndarray, k: int) -> np.ndarray:
    """往後移 k 列（out[t] = a[t−k]），前 k 列為 NaN。"""
    out = np.full_like(a, np.nan, dtype=float)
    if k < len(a):
        out[k:] = a[: len(a) - k]
    return out


def rolling(a: np.ndarray, n: int, fn: str, min_periods: int | None = None) -> np.ndarray:
    r = pd.DataFrame(a).rolling(n, min_periods=min_periods or n)
    return np.asarray(getattr(r, fn)().to_numpy())


def ret(close: np.ndarray, k: int) -> np.ndarray:
    """近 k 日報酬：close[t] ÷ close[t−k] − 1。"""
    with np.errstate(invalid="ignore", divide="ignore"):
        return close / shift(close, k) - 1


def cross_up(x: np.ndarray, level: float) -> np.ndarray:
    """當日 ≥ level 且前一日 < level（前一日要有值）。"""
    prev = shift(x, 1)
    with np.errstate(invalid="ignore"):
        return (x >= level) & (prev < level)


def first_true(cond: np.ndarray, evaluable: np.ndarray | None = None) -> np.ndarray:
    """首次成立：當日成立、前一日可判斷但不成立。"""
    prev = np.vstack([np.ones((1, cond.shape[1]), dtype=bool), cond[:-1]])
    ok_prev = np.vstack(
        [np.zeros((1, cond.shape[1]), dtype=bool), (evaluable if evaluable is not None else np.ones_like(cond))[:-1]]
    )
    return cond & ~prev & ok_prev


def avg_volume_prev(volume: np.ndarray, n: int = 20) -> np.ndarray:
    """前 n 日均量（不含當日；至少 15 天有量）。"""
    return shift(rolling(volume, n, "mean", min_periods=max(1, n * 3 // 4)), 1)


def run_length(pos: np.ndarray) -> np.ndarray:
    """連續成立天數（當日不成立為 0）。"""
    out = np.zeros(pos.shape, dtype=np.int32)
    run = np.zeros(pos.shape[1], dtype=np.int32)
    for t in range(pos.shape[0]):
        run = np.where(pos[t], run + 1, 0)
        out[t] = run
    return out


def cs_percentile(x: np.ndarray, universe: np.ndarray) -> np.ndarray:
    """每日在 universe 內的百分位排名（0–100；平均名次 ÷ 有效檔數 × 100）。不在 universe 或無值為 NaN。"""
    v = np.where(universe & np.isfinite(x), x, np.nan)
    ranks = pd.DataFrame(v).rank(axis=1, pct=True).to_numpy() * 100
    return np.asarray(ranks)


# ------------------------------------------------------------------ 動能
def rs_raw(close: np.ndarray) -> np.ndarray:
    """RS = 0.4 R63 + 0.2 R126 + 0.2 R189 + 0.2 R252（需有 252 日以上資料）。"""
    return 0.4 * ret(close, 63) + 0.2 * ret(close, 126) + 0.2 * ret(close, 189) + 0.2 * ret(close, 252)


def high52_ratio(close: np.ndarray, n: int = 252) -> np.ndarray:
    """收盤 ÷ 近 n 日最高收盤（不含當日；需滿 n 日）。"""
    prior_max = shift(rolling(close, n, "max"), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return close / prior_max


def ma(close: np.ndarray, n: int) -> np.ndarray:
    return rolling(close, n, "mean")


def bias(close: np.ndarray, n: int = 20) -> np.ndarray:
    """乖離 = 收盤 ÷ n 日線 − 1。"""
    with np.errstate(invalid="ignore", divide="ignore"):
        return close / ma(close, n) - 1


def breakout(close: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """N 日新高突破：收盤 > 前 N 日最高收盤（不含當日），且前一日不是突破（第一次突破）。回傳 (事件, 突破價)。"""
    level = shift(rolling(close, n, "max"), 1)
    with np.errstate(invalid="ignore"):
        b = close > level
    prev = np.vstack([np.zeros((1, b.shape[1]), dtype=bool), b[:-1]])
    prev_ok = np.vstack([np.zeros((1, b.shape[1]), dtype=bool), np.isfinite(level)[:-1]])
    return b & ~prev & prev_ok, level


def volume_ratio(volume: np.ndarray, n: int = 20) -> np.ndarray:
    """當日量 ÷ 前 n 日均量（不含當日）。"""
    with np.errstate(invalid="ignore", divide="ignore"):
        return volume / avg_volume_prev(volume, n)


def close_position(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """收盤在當日高低區間的位置（0＝最低、1＝最高）；高＝低（一價到底）視為 1。"""
    rng = high - low
    with np.errstate(invalid="ignore", divide="ignore"):
        pos = (close - low) / rng
    return np.where(rng == 0, 1.0, pos)


def false_breakout(close: np.ndarray, level: np.ndarray, t: np.ndarray, c: np.ndarray, days: int = 5) -> np.ndarray:
    """假突破：突破後 days 日內任一天收盤跌回突破價（前 N 日最高收盤）之下。資料不足 days 日為 NaN。"""
    T = close.shape[0]
    out = np.full(t.size, np.nan)
    for k in range(t.size):
        a, b = t[k] + 1, t[k] + 1 + days
        if b > T:
            continue
        seg = close[a:b, c[k]]
        seg = seg[np.isfinite(seg)]
        out[k] = float((seg < level[t[k], c[k]]).any()) if seg.size else np.nan
    return out


def kd(
    high: np.ndarray, low: np.ndarray, close: np.ndarray, n: int = 9, k_s: int = 3, d_s: int = 3
) -> tuple[np.ndarray, np.ndarray]:
    """KD(9, 3, 3)：RSV = (收盤 − 9 日最低) ÷ (9 日最高 − 9 日最低) × 100；K = (2/3) K₋₁ + (1/3) RSV；D 同理。

    起始 K = D = 50；沒有 RSV 的日子（停牌、資料不足）K、D 為 NaN，但保留前值繼續遞迴。
    """
    lo = rolling(low, n, "min")
    hi = rolling(high, n, "max")
    with np.errstate(invalid="ignore", divide="ignore"):
        rsv = np.where(hi - lo > 0, (close - lo) / (hi - lo) * 100, 50.0)
    rsv = np.where(np.isfinite(lo) & np.isfinite(hi) & np.isfinite(close), rsv, np.nan)
    T, C = close.shape
    K = np.full((T, C), np.nan)
    D = np.full((T, C), np.nan)
    k_prev = np.full(C, 50.0)
    d_prev = np.full(C, 50.0)
    for t in range(T):
        r = rsv[t]
        ok = np.isfinite(r)
        k_now = np.where(ok, (1 - 1 / k_s) * k_prev + r / k_s, k_prev)
        d_now = np.where(ok, (1 - 1 / d_s) * d_prev + k_now / d_s, d_prev)
        K[t] = np.where(ok, k_now, np.nan)
        D[t] = np.where(ok, d_now, np.nan)
        k_prev, d_prev = k_now, d_now
    return K, D


def kd_events(k_line: np.ndarray, high: float = 80, run: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """事件 A：K ≥ 80 連續達第 run 日（當日為第 run 日）；事件 B：K 從 ≥ 80 跌破 80，且之前連續 ≥ 80 至少 run 日。"""
    with np.errstate(invalid="ignore"):
        above = k_line >= high
    rl = run_length(above)
    ev_a = rl == run
    prev_run = np.vstack([np.zeros((1, k_line.shape[1]), dtype=np.int32), rl[:-1]])
    with np.errstate(invalid="ignore"):
        ev_b = (k_line < high) & (prev_run >= run)
    return ev_a, ev_b


def macd(
    close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9, warmup: int = 60
) -> tuple[np.ndarray, np.ndarray]:
    """MACD：DIF = EMA12 − EMA26；訊號線 = DIF 的 EMA9；柱狀 = DIF − 訊號線。回傳 (DIF, 柱狀)。

    EMA 以 α = 2 ÷ (n + 1) 遞迴（pandas ewm adjust=False，略過缺值）；每檔前 warmup 個有效收盤視為暖機期（NaN）。
    """
    df = pd.DataFrame(close)
    ema_f = df.ewm(span=fast, adjust=False, ignore_na=True).mean()
    ema_s = df.ewm(span=slow, adjust=False, ignore_na=True).mean()
    dif = ema_f - ema_s
    sig = dif.ewm(span=signal, adjust=False, ignore_na=True).mean()
    hist = (dif - sig).to_numpy()
    dif_a = dif.to_numpy()
    count = np.cumsum(np.isfinite(close), axis=0)
    bad = (count <= warmup) | ~np.isfinite(close)
    return np.where(bad, np.nan, dif_a), np.where(bad, np.nan, hist)


def macd_cross(hist: np.ndarray) -> np.ndarray:
    """柱狀圖當日 > 0 且前一日 ≤ 0。"""
    prev = shift(hist, 1)
    with np.errstate(invalid="ignore"):
        return (hist > 0) & (prev <= 0)


# ------------------------------------------------------------------ 籌碼
def fill_chip(net: np.ndarray, close: np.ndarray) -> np.ndarray:
    """法人表只列有交易的股票：該日有法人資料（任一檔有值）且該股有收盤 → 缺值視為 0。"""
    has_day = np.isfinite(net).any(axis=1)[:, None]
    return np.where(np.isfinite(net), net, np.where(has_day & np.isfinite(close), 0.0, np.nan))


def chip_ratio(net: np.ndarray, avg_vol: np.ndarray, n: int) -> np.ndarray:
    """近 n 日累計淨買超 ÷ 前 20 日均量。"""
    s = rolling(net, n, "sum")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(avg_vol > 0, s / avg_vol, np.nan)


def consecutive_buy(net: np.ndarray, avg_vol: np.ndarray, n: int, threshold: float) -> np.ndarray:
    """連買：淨買超 > 0 連續 n 日，事件為第 n 日；且 n 日累計淨買超 ÷ 前 20 日均量 ≥ 門檻。"""
    with np.errstate(invalid="ignore"):
        rl = run_length(net > 0)
        return (rl == n) & (chip_ratio(net, avg_vol, n) >= threshold)


def sync_buy(foreign: np.ndarray, trust: np.ndarray, avg_vol: np.ndarray, days: int, threshold: float) -> np.ndarray:
    """外資投信同步：近 days 日外資與投信累計淨買超皆 > 0，且兩者合計 ÷ 前 20 日均量 ≥ 門檻；事件為首次同時成立日。"""
    f = rolling(foreign, days, "sum")
    tr = rolling(trust, days, "sum")
    with np.errstate(invalid="ignore", divide="ignore"):
        cond = (f > 0) & (tr > 0) & ((f + tr) / avg_vol >= threshold)
    evaluable = np.isfinite(f) & np.isfinite(tr) & np.isfinite(avg_vol)
    return first_true(cond & evaluable, evaluable)


def own_quantile_prev(x: np.ndarray, lookback: int, q: float, min_obs: int) -> np.ndarray:
    """該股自身近 lookback 日（不含當日）的第 q 百分位。"""
    return shift(pd.DataFrame(x).rolling(lookback, min_periods=min_obs).quantile(q / 100).to_numpy(), 1)


def extreme(x: np.ndarray, lookback: int, q: float, min_obs: int) -> np.ndarray:
    """當日值 > 0 且達自身近 lookback 日第 q 百分位以上。"""
    thr = own_quantile_prev(x, lookback, q, min_obs)
    with np.errstate(invalid="ignore"):
        return (x > 0) & (x >= thr)


def margin_quadrant(
    close: np.ndarray, margin: np.ndarray, days: int, price_pct: float, margin_pct: float
) -> tuple[np.ndarray, np.ndarray]:
    """融資四象限：價漲資減（股價 5 日 ≥ +3% 且融資 5 日 ≤ −3%）、價漲資增（股價 ≥ +3% 且融資 ≥ +3%）；事件為首次成立日。"""
    p = ret(close, days)
    with np.errstate(invalid="ignore", divide="ignore"):
        m = np.where(shift(margin, days) > 0, margin / shift(margin, days) - 1, np.nan)
        evaluable = np.isfinite(p) & np.isfinite(m)
        up_down = (p >= price_pct / 100) & (m <= -margin_pct / 100)
        up_up = (p >= price_pct / 100) & (m >= margin_pct / 100)
    return first_true(up_down & evaluable, evaluable), first_true(up_up & evaluable, evaluable)


# ------------------------------------------------------------------ 月營收
def revenue_features(rev: pd.DataFrame) -> pd.DataFrame:
    """每檔每月：創 12 個月新高（當月 > 前 12 個月最高，需 12 個月都有資料）、年增率、前 1／2 月年增率、營收加速。"""
    if rev.empty:
        return rev.assign(
            high12=pd.Series(dtype=bool), accel=pd.Series(dtype=bool), yoy1=np.nan, yoy2=np.nan, dyoy=np.nan
        )
    r = rev.sort_values(["code", "ym"]).copy()
    per = pd.PeriodIndex(r["ym"].astype(str), freq="M")
    r["_m"] = per.year * 12 + per.month
    g = r.groupby("code")
    prior_max = g["revenue"].transform(lambda s: s.shift(1).rolling(12, min_periods=12).max())
    span = r["_m"] - g["_m"].shift(12)
    r["high12"] = (r["revenue"] > prior_max) & (span == 12)
    r["yoy1"] = g["yoy"].shift(1).where(r["_m"] - g["_m"].shift(1) == 1)
    r["yoy2"] = g["yoy"].shift(2).where(r["_m"] - g["_m"].shift(2) == 2)
    r["accel"] = (r["yoy"] > r["yoy1"]) & (r["yoy1"] > r["yoy2"]) & (r["yoy"] > 0)
    r["dyoy"] = r["yoy"] - r["yoy1"]
    return r.drop(columns="_m")


def revenue_event(rf: pd.DataFrame, col: str, T: int, codes: list[str]) -> np.ndarray:
    """月營收事件放到訊號列（生效日之前最後一個交易日）。"""
    out = np.zeros((T, len(codes)), dtype=bool)
    pos = {c: i for i, c in enumerate(codes)}
    sel = rf[rf[col].fillna(False).astype(bool) & (rf["row"] >= 0) & (rf["row"] < T)]
    for code, row in zip(sel["code"], sel["row"], strict=True):
        if code in pos:
            out[int(row), pos[code]] = True
    return out


def revenue_asof(rf: pd.DataFrame, col: str, T: int, codes: list[str], max_age: int = 45) -> np.ndarray:
    """月營收欄位的逐日面板：訊號列起延用到下一次公布；超過 max_age 個交易日沒有更新視為缺值。"""
    out = np.full((T, len(codes)), np.nan)
    upd = np.full((T, len(codes)), np.nan)
    pos = {c: i for i, c in enumerate(codes)}
    sel = rf[(rf["row"] >= 0) & (rf["row"] < T)]
    for code, row, v in zip(sel["code"], sel["row"], sel[col].astype(float), strict=True):
        if code in pos:
            out[int(row), pos[code]] = v
            upd[int(row), pos[code]] = row
    filled = pd.DataFrame(out).ffill().to_numpy()
    last = pd.DataFrame(upd).ffill().to_numpy()
    age = np.arange(T)[:, None] - last
    return np.where(age > max_age, np.nan, filled)


def asof(x: np.ndarray, max_age: int) -> np.ndarray:
    """只在更新列有值的面板 → 延用 max_age 個交易日。"""
    T = x.shape[0]
    rows = np.where(np.isfinite(x), np.arange(T)[:, None], np.nan)
    filled = pd.DataFrame(x).ffill().to_numpy()
    last = pd.DataFrame(rows).ffill().to_numpy()
    return np.where(np.arange(T)[:, None] - last > max_age, np.nan, filled)


def build_features(ev: Any, universe: np.ndarray, p: dict[str, Any]) -> dict[str, Any]:
    """全部指標需要的中間面板（一次算好，各指標共用）。"""
    C, H, L, V = ev.close, ev.high, ev.low, ev.volume
    f: dict[str, Any] = {}
    f["avgv"] = avg_volume_prev(V, 20)
    f["rs_pct"] = cs_percentile(rs_raw(C), universe)
    f["h52"] = high52_ratio(C)
    f["bias20"] = bias(C, 20)
    f["vol_ratio"] = volume_ratio(V, 20)
    f["close_pos"] = close_position(H, L, C)
    k_n, k_k, k_d = (int(x) for x in p["kd"])
    f["K"], _ = kd(H, L, C, k_n, k_k, k_d)
    fast, slow, sig = (int(x) for x in p["macd"])
    f["dif"], f["hist"] = macd(C, fast, slow, sig, warmup=int(p["macd_warmup"]))
    f["foreign"] = fill_chip(ev.foreign, ev.raw_close)
    f["trust"] = fill_chip(ev.trust, ev.raw_close)
    f["hedge"] = fill_chip(ev.hedge, ev.raw_close)
    f["trust20"] = chip_ratio(f["trust"], f["avgv"], 20)
    f["foreign20"] = chip_ratio(f["foreign"], f["avgv"], 20)
    f["ret20"] = ret(C, int(p["price_lead_days"]))
    f["whale_chg_asof"] = asof(ev.whale_chg, 7)
    rf = revenue_features(ev.revenue)
    f["rev"] = rf
    T, codes = len(ev.dates), ev.codes
    f["rev_yoy"] = revenue_asof(rf, "yoy", T, codes)
    f["rev_dyoy"] = revenue_asof(rf, "dyoy", T, codes)
    f["rev_accel_asof"] = revenue_asof(rf.assign(a=rf["accel"].astype(float)), "a", T, codes)
    return f
