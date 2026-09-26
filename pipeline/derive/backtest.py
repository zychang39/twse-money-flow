"""回測引擎（正確性優先；前端 web/src/lib/backtest.ts 為同一套規則的 TS 版本）。

規則：
1. 訊號：T 日收盤後，以 T 日（含）以前已公布的資料計算條件（面板本身已保證無前視）。
2. 進場：T+1 日開盤（還原價）。出場：進場後第 N 個交易日開盤（持有 N 日）。
3. 排除：進場日開盤漲幅 ≥ 9.5%（視為開盤即漲停）、進場日停牌（無開盤價或無量）、進場日處於處置期間。
4. 出場日無開盤價（停牌、下市）：往後找第一個有開盤價的日子；找不到則以進場後最後一個收盤價出場並標示。
5. 成本：買進手續費、賣出手續費、證交稅（百分比模式，不計最低 20 元）。
6. 超額報酬：相對加權報酬指數（T 日收盤至出場前一日收盤，近似同一持有期間）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config


@dataclass
class Prices:
    dates: list[str]
    codes: list[str]
    open: np.ndarray  # (T, C) 還原開盤
    low: np.ndarray  # (T, C) 還原最低
    close: np.ndarray  # (T, C) 還原收盤
    tradable: np.ndarray  # (T, C) bool
    blocked: np.ndarray  # (T, C) bool：處置期間
    bench: np.ndarray  # (T,) 加權報酬指數
    regime_up: np.ndarray  # (T,) bool：加權指數在年線之上
    is_etf: np.ndarray  # (C,) bool


def cost_rates(discount: float | None = None) -> tuple[float, float, float, float]:
    c = config.costs()
    fee = float(c["commission"]["rate"]) * float(discount if discount is not None else c["commission"]["discount"])
    return fee, fee, float(c["tax"]["stock"]), float(c["tax"]["etf"])


def net_return(gross: float, is_etf: bool, discount: float | None = None) -> float:
    buy, sell, tax_stock, tax_etf = cost_rates(discount)
    tax = tax_etf if is_etf else tax_stock
    return (1 + gross) * (1 - sell - tax) / (1 + buy) - 1


@dataclass
class Trade:
    code: str
    signal_date: str
    entry_date: str
    exit_date: str
    entry: float
    exit: float
    gross: float
    net: float
    mae: float
    bench: float
    excess: float
    regime_up: bool
    delisted: bool
    horizon: int


def run(
    signals: np.ndarray,
    px: Prices,
    horizons: list[int] | None = None,
    decay_days: int | None = None,
    limit_up_pct: float | None = None,
) -> dict[str, Any]:
    """signals：(T, C) bool。回傳交易明細、排除統計、衰減曲線。"""
    bt = config.thresholds()["backtest"]
    horizons = horizons or [int(h) for h in bt["horizons"]]
    decay_days = decay_days or int(bt["decay_days"])
    limit_up = (limit_up_pct if limit_up_pct is not None else float(bt["limit_up_pct"])) / 100
    T = len(px.dates)
    trades: dict[int, list[Trade]] = {h: [] for h in horizons}
    excluded = {"limit_up": 0, "suspended": 0, "disposition": 0, "no_future": 0}
    decay_sum = np.zeros(decay_days)
    decay_n = np.zeros(decay_days)
    ts, cs = np.nonzero(signals)
    for t, c in sorted(zip(ts.tolist(), cs.tolist(), strict=True)):
        e = t + 1
        if e >= T:
            excluded["no_future"] += 1
            continue
        if not px.tradable[e, c] or not np.isfinite(px.open[e, c]):
            excluded["suspended"] += 1
            continue
        prev_close = px.close[t, c]
        if np.isfinite(prev_close) and prev_close > 0 and px.open[e, c] / prev_close - 1 >= limit_up:
            excluded["limit_up"] += 1
            continue
        if px.blocked[e, c]:
            excluded["disposition"] += 1
            continue
        entry = px.open[e, c]
        etf = bool(px.is_etf[c])
        # 衰減曲線：第 k 個持有日收盤相對進場價（扣除成本）
        for k in range(1, decay_days + 1):
            i = e + k - 1
            if i < T and np.isfinite(px.close[i, c]):
                decay_sum[k - 1] += net_return(px.close[i, c] / entry - 1, etf)
                decay_n[k - 1] += 1
        for h in horizons:
            x = e + h
            if x >= T:
                continue
            delisted = False
            k = x
            while k < T and not (px.tradable[k, c] and np.isfinite(px.open[k, c])):
                k += 1
            if k < T:
                exit_px = px.open[k, c]
                exit_i = k
            else:
                closes = px.close[e:, c]
                valid = np.nonzero(np.isfinite(closes))[0]
                exit_i = e + int(valid[-1])
                exit_px = px.close[exit_i, c]
                delisted = True
            lows = px.low[e:exit_i, c]
            lows = lows[np.isfinite(lows)]
            worst = min(float(lows.min()) if lows.size else entry, exit_px)
            gross = float(exit_px / entry - 1)
            net = net_return(gross, etf)
            b0, b1 = px.bench[t], px.bench[max(exit_i - 1, t)]
            bench = float(b1 / b0 - 1) if np.isfinite(b0) and np.isfinite(b1) and b0 > 0 else float("nan")
            trades[h].append(
                Trade(
                    px.codes[c],
                    px.dates[t],
                    px.dates[e],
                    px.dates[exit_i],
                    float(entry),
                    float(exit_px),
                    gross,
                    net,
                    worst / entry - 1,
                    bench,
                    net - bench if bench == bench else float("nan"),
                    bool(px.regime_up[t]),
                    delisted,
                    h,
                )
            )
    decay = [float(s / n) if n else None for s, n in zip(decay_sum, decay_n, strict=True)]
    return {"trades": trades, "excluded": excluded, "decay": decay, "decay_n": decay_n.astype(int).tolist()}


def non_overlapping(trades: list[Trade]) -> list[Trade]:
    """同一檔在前一筆持有期間（進場至出場日）內的新訊號略過。"""
    out: list[Trade] = []
    last_exit: dict[str, str] = {}
    for tr in sorted(trades, key=lambda x: (x.code, x.entry_date)):
        if tr.code in last_exit and tr.entry_date < last_exit[tr.code]:
            continue
        out.append(tr)
        last_exit[tr.code] = tr.exit_date
    return sorted(out, key=lambda x: x.signal_date)


def stats(trades: list[Trade]) -> dict[str, Any]:
    min_samples = int(config.thresholds()["backtest"]["min_samples"])
    n = len(trades)
    if n == 0:
        return {"n": 0, "low_reference": True}
    net = np.array([t.net for t in trades])
    mae = np.array([t.mae for t in trades])
    exc = np.array([t.excess for t in trades if t.excess == t.excess])
    return {
        "n": n,
        "win_rate": float((net > 0).mean() * 100),
        "avg": float(net.mean() * 100),
        "median": float(np.median(net) * 100),
        "avg_mae": float(mae.mean() * 100),
        "worst_mae": float(mae.min() * 100),
        "avg_excess": float(exc.mean() * 100) if exc.size else None,
        "low_reference": n < min_samples,
    }


def summarize(
    result: dict[str, Any], dates: list[str], detail_horizon: int = 10, max_detail: int = 400
) -> dict[str, Any]:
    split = float(config.thresholds()["backtest"]["oos_split"])
    out: dict[str, Any] = {
        "horizons": {},
        "excluded": result["excluded"],
        "decay": result["decay"],
        "decay_n": result["decay_n"],
    }
    for h, trades in result["trades"].items():
        if not trades:
            out["horizons"][str(h)] = {"all": stats([]), "non_overlap": stats([])}
            continue
        sig_dates = sorted({t.signal_date for t in trades})
        first, last = sig_dates[0], sig_dates[-1]
        span = pd.date_range(first, last)
        cut = span[int((len(span) - 1) * split)].date().isoformat() if len(span) > 1 else last
        no = non_overlapping(trades)
        out["horizons"][str(h)] = {
            "all": stats(trades),
            "non_overlap": stats(no),
            "in_sample": stats([t for t in trades if t.signal_date <= cut]),
            "out_of_sample": stats([t for t in trades if t.signal_date > cut]),
            "regime_up": stats([t for t in trades if t.regime_up]),
            "regime_down": stats([t for t in trades if not t.regime_up]),
            "oos_cut": cut,
        }
    detail: list[Trade] = result["trades"].get(detail_horizon) or next(iter(result["trades"].values()), [])
    out["detail_horizon"] = detail_horizon
    out["trades"] = [
        {
            "code": t.code,
            "signal": t.signal_date,
            "entry_date": t.entry_date,
            "exit_date": t.exit_date,
            "entry": round(t.entry, 3),
            "exit": round(t.exit, 3),
            "net": round(t.net * 100, 2),
            "mae": round(t.mae * 100, 2),
            "excess": None if t.excess != t.excess else round(t.excess * 100, 2),
            "delisted": t.delisted,
        }
        for t in sorted(detail, key=lambda x: x.signal_date, reverse=True)[:max_detail]
    ]
    out["period"] = {"start": dates[0] if dates else None, "end": dates[-1] if dates else None}
    return out


def conditions_mask(conditions: list[dict[str, Any]], lookup: Any) -> np.ndarray | None:
    """依條件逐日計算訊號（全部成立）。lookup(field) → (T, C) ndarray。"""
    mask = None
    for c in conditions:
        arr = lookup(c["field"])
        if arr is None:
            return None
        op, v = c["op"], c["value"]
        with np.errstate(invalid="ignore"):
            if op == ">":
                m = arr > v
            elif op == ">=":
                m = arr >= v
            elif op == "<":
                m = arr < v
            elif op == "<=":
                m = arr <= v
            elif op == "==":
                m = arr == v
            elif op == "between":
                m = (arr >= v[0]) & (arr <= v[1])
            else:
                raise ValueError(op)
        m = m & np.isfinite(arr)
        mask = m if mask is None else mask & m
    return mask
