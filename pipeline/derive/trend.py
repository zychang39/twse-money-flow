"""個股衍生指標（M1.3）→ 個股檔 `trend`。全部以還原價計算（回測與指標一律還原價；最新一日的還原價＝實際價）。

- 均線 20／60／240 日：現值、乖離（收盤 ÷ 均線 − 1）、近 10 日斜率（今日均線 ÷ 10 個交易日前 − 1）與 10 日前的斜率。
- 20–60 日線間距（20 日線 ÷ 60 日線 − 1）：現值與 10 日前；近 120 日序列。
- 排列：收盤 > 20 > 60 > 240＝多頭、全部相反＝空頭、其餘整理；持續日數＝連續同一排列的交易日數。
- ATR14：真實波動（max(高−低, |高−前收|, |低−前收|)）的 14 日簡單平均；ATR%＝ATR ÷ 收盤；ATR% 在自身近 250 日的百分位。
- 20 日乖離 ATR 倍數＝（收盤 − 20 日線）÷ ATR14。
- 52 週（250 日）收盤最高／最低與日期、距離；60 日區間；近 20 日收盤創 60 日新高的天數。
- 各期間報酬對 0050（含息：還原價）與對主要細產業中位數的差（百分點）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from pipeline.derive.export import arr, clean

if TYPE_CHECKING:
    from pipeline.derive.build import Panels
    from pipeline.derive.sectors import SectorResult

MAS = (20, 60, 240)
SLOPE_N = 10
SERIES_DAYS = 120
YEAR = 250
TAIL = 520  # 只用最近一段（240 日線＋250 日百分位）
BENCH = "0050"


@dataclass
class TrendContext:
    dates: list[str]
    close: pd.DataFrame
    ma: dict[int, pd.DataFrame]
    atr: pd.DataFrame
    atr_pct: pd.DataFrame


def wilder(tr: np.ndarray, n: int = 14) -> np.ndarray:
    """(T, C) ATR（docs/METHODOLOGY.md ATR14）：前 n 筆有效 TR 的簡單平均起算，之後 (ATR₋₁ × (n − 1) + TR) ÷ n；
    缺值日跳過（沿用前值、不計入）；不足 n 筆為 NaN。與前端 lib/technical.ts atrLast 同一定義。"""
    out = np.full(tr.shape, np.nan)
    prev = np.full(tr.shape[1], np.nan)
    csum = np.zeros(tr.shape[1])
    cnt = np.zeros(tr.shape[1])
    for t in range(tr.shape[0]):
        v = tr[t]
        ok = ~np.isnan(v)
        cnt += ok
        csum += np.where(ok, v, 0.0)
        prev = np.where(ok & (cnt == n), csum / n, prev)
        prev = np.where(ok & (cnt > n), (prev * (n - 1) + np.where(ok, v, 0.0)) / n, prev)
        out[t] = np.where(cnt >= n, prev, np.nan)
    return out


def build_context(p: Panels) -> TrendContext:
    af = p.af.iloc[-TAIL:]
    c = (p.close.iloc[-TAIL:] * af).ffill(limit=5)
    h = (p.high.iloc[-TAIL:] * af).where(lambda x: x.notna(), c)
    lo = (p.low.iloc[-TAIL:] * af).where(lambda x: x.notna(), c)
    pc = c.shift(1)
    tr = pd.DataFrame(
        np.fmax(np.fmax((h - lo).to_numpy(), (h - pc).abs().to_numpy()), (lo - pc).abs().to_numpy()),
        index=c.index,
        columns=c.columns,
    )
    atr = pd.DataFrame(wilder(tr.to_numpy(), 14), index=c.index, columns=c.columns)
    ma = {n: c.rolling(n, min_periods=n).mean() for n in MAS}
    return TrendContext(dates=list(c.index), close=c, ma=ma, atr=atr, atr_pct=atr / c * 100)


def _slope(s: pd.Series, at: int, n: int = SLOPE_N) -> float | None:
    if at - n < 0 or at >= len(s):
        return None
    a, b = s.iloc[at], s.iloc[at - n]
    if pd.isna(a) or pd.isna(b) or b == 0:
        return None
    return float((a / b - 1) * 100)


def alignment(close: pd.Series, m20: pd.Series, m60: pd.Series, m240: pd.Series) -> tuple[str | None, int]:
    bull = (close > m20) & (m20 > m60) & (m60 > m240)
    bear = (close < m20) & (m20 < m60) & (m60 < m240)
    ok = close.notna() & m20.notna() & m60.notna() & m240.notna()
    state = np.where(~ok, "", np.where(bull, "bull", np.where(bear, "bear", "mixed")))
    if not len(state) or state[-1] == "":
        return None, 0
    last = state[-1]
    days = 0
    for s in state[::-1]:
        if s != last:
            break
        days += 1
    return str(last), days


def pct_rank(series: pd.Series, window: int = YEAR) -> float | None:
    """最新值在自身最近 window 日（含）的百分位（0–100）。"""
    s = series.iloc[-window:].dropna()
    if len(s) < 60 or pd.isna(series.iloc[-1]):
        return None
    v = series.iloc[-1]
    return float((s < v).sum() + 0.5 * (s == v).sum()) / len(s) * 100


def trend_block(
    ctx: TrendContext, code: str, sec: SectorResult | None = None, fine_id: str | None = None
) -> dict[str, Any] | None:
    if code not in ctx.close.columns:
        return None
    c = ctx.close[code]
    last = c.last_valid_index()
    if last is None:
        return None
    at = ctx.dates.index(last)
    close = float(c.iloc[at])
    out: dict[str, Any] = {"date": last, "close": clean(close, 2)}
    mas: dict[str, Any] = {}
    for n in MAS:
        m = ctx.ma[n][code]
        v = m.iloc[at]
        mas[str(n)] = {
            "v": clean(v, 2),
            "bias": clean((close / v - 1) * 100, 2) if pd.notna(v) and v else None,
            "slope": clean(_slope(m, at), 2),
            "slope_prev": clean(_slope(m, at - SLOPE_N), 2),
        }
    out["ma"] = mas
    m20, m60, m240 = (ctx.ma[n][code] for n in MAS)
    gap = (m20 / m60 - 1) * 100
    out["gap"] = {"now": clean(gap.iloc[at], 2), "prev": clean(gap.iloc[at - SLOPE_N] if at >= SLOPE_N else None, 2)}
    state, days = alignment(c.iloc[: at + 1], m20.iloc[: at + 1], m60.iloc[: at + 1], m240.iloc[: at + 1])
    out["align"] = {"state": state, "days": days}
    atr = ctx.atr[code].iloc[at]
    out["atr"] = {
        "v": clean(atr, 2),
        "pct": clean(ctx.atr_pct[code].iloc[at], 2),
        "rank": clean(pct_rank(ctx.atr_pct[code].iloc[: at + 1]), 1),
    }
    m20v = m20.iloc[at]
    out["bias_atr"] = clean((close - m20v) / atr, 2) if pd.notna(atr) and atr and pd.notna(m20v) else None
    yr = c.iloc[max(0, at - YEAR + 1) : at + 1].dropna()
    if len(yr):
        hi_d, lo_d = yr.idxmax(), yr.idxmin()
        out["y52"] = {
            "hi": clean(yr.max(), 2),
            "hi_date": hi_d,
            "lo": clean(yr.min(), 2),
            "lo_date": lo_d,
            "from_hi": clean((close / yr.max() - 1) * 100, 2),
            "from_lo": clean((close / yr.min() - 1) * 100, 2),
            "at_high": bool(hi_d == last),
            "days": len(yr),
        }
    r60 = c.iloc[max(0, at - 59) : at + 1].dropna()
    if len(r60):
        out["d60"] = {"hi": clean(r60.max(), 2), "lo": clean(r60.min(), 2)}
    # 近 20 日收盤創 60 日新高的天數（含當日；以前 59 日＋當日的最高收盤判斷）
    roll = c.rolling(60, min_periods=40).max()
    win = slice(max(0, at - 19), at + 1)
    out["new_high60_20d"] = int(((c.iloc[win] >= roll.iloc[win]) & c.iloc[win].notna()).sum())
    # 對 0050 與主要細產業中位數
    if sec is not None:
        vs: dict[str, Any] = {}
        med = (sec.stats.get(fine_id) or {}).get("med") if fine_id else None
        for k in ("1M", "3M", "6M", "12M"):
            mine = sec.ret.at[code, k] if code in sec.ret.index else np.nan
            b = sec.ret.at[BENCH, k] if BENCH in sec.ret.index else np.nan
            f = (med or {}).get(k)
            vs[k] = {
                "ret": clean(mine, 2),
                "bench": clean(b, 2),
                "fine": f,
                "vs_bench": clean(mine - b, 2) if pd.notna(mine) and pd.notna(b) else None,
                "vs_fine": clean(mine - f, 2) if pd.notna(mine) and f is not None else None,
            }
        out["vs"] = vs
    lo = max(0, at - SERIES_DAYS + 1)
    out["series"] = {
        "dates": ctx.dates[lo : at + 1],
        "close": arr(c.iloc[lo : at + 1].to_numpy(), 2),
        **{f"ma{n}": arr(ctx.ma[n][code].iloc[lo : at + 1].to_numpy(), 2) for n in MAS},
        "gap": arr(gap.iloc[lo : at + 1].to_numpy(), 2),
    }
    return out
