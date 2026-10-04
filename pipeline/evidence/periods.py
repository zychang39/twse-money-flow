"""策略期間檢視（M1.5）→ strategy/{id}.json（前端即時切換期間與基準，不重新計算）。

期間預先計算三類（訊號日落在期間內的事件；組合從期間第一個交易日空手開始重新模擬）：
- all：全期間（＝判定卡；分級永遠以全期間計算）。
- from:YYYY：自某年起（訊號起始年～今年）。
- last:N：近 1／3／5 年（最後一個交易日往前 N 年）。
- year:YYYY：單一年份（每個日曆年獨立；組合從年初空手開始，年底以收盤計值）。

每個期間：
- 判定（四個基準 ew／0050／tr／00631L）：40 日扣成本超額平均、校正後 t（audit.corrected_t，與判定卡同一個方法）、
  超額勝率、中位數、樣本數。
- 多期間表：持有 5／10／20／40／60／120 日（同一組 40 日去重事件）× 四個基準。
- 5 檔組合（預先指定排序）與四個基準：年化報酬、Sharpe、最大回撤、總報酬；每週淨值（期間起點＝1）。
- 隨機選股（200 次，同一組事件、隨機排序）：全期間路徑在期間起點重設為 1 後的年化／Sharpe／最大回撤分位（5／50／95）
  與每週淨值分位帶。
- 累積超額曲線（1–120 日，四個基準，95% 帶）。
另外：逐筆訊號（進場日、代號、各持有天數扣成本報酬、四個基準的 40 日超額）、日曆時間法月度超額、逐年表、
滾動 3 年穩定度、各出場規則逐筆結果、目前篩出與今日新觸發（含觸發日、第 k 日、觸發以來報酬）。
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import audit, curve, engine, stats
from pipeline.evidence.engine import Market
from pipeline.evidence.strategies import perf

log = logging.getLogger(__name__)

HORIZONS = (5, 10, 20, 40, 60, 120)
BENCHES = {"ew": "exc_mkt", "0050": "exc_0050", "tr": "exc_idx", "00631L": "exc_00631L"}
CURVE_REPS = 200


def period_keys(signal_start: str, end: str) -> list[tuple[str, str, str]]:
    """[(key, 起日, 迄日)]：all、from:YYYY、last:N、year:YYYY。"""
    y0, y1 = int(signal_start[:4]), int(end[:4])
    end_ts = pd.Timestamp(end)
    out = [("all", signal_start, end)]
    for y in range(y0, y1 + 1):
        out.append((f"from:{y}", max(signal_start, f"{y}-01-01"), end))
    for n in (1, 3, 5):
        lo = (end_ts - pd.DateOffset(years=n)).date().isoformat()
        out.append((f"last:{n}", max(signal_start, lo), end))
    for y in range(y0, y1 + 1):
        out.append((f"year:{y}", max(signal_start, f"{y}-01-01"), min(end, f"{y}-12-31")))
    return out


def card_stats(d: pd.DataFrame, h: int, period_days: int) -> dict[str, Any]:
    """四個基準的超額平均、校正後 t、超額勝率、中位數、樣本數。"""
    out: dict[str, Any] = {"n": len(d)}
    for b, col in BENCHES.items():
        if col not in d.columns or d.empty:
            out[b] = {"excess": None, "t": None, "win": None, "median": None, "n": 0}
            continue
        x = d[col].to_numpy(dtype=float)
        fin = np.isfinite(x)
        ct = audit.corrected_t(d[fin], h, col, period_days=period_days) if fin.sum() >= 2 else {}
        out[b] = {
            "excess": ct.get("mean_excess") if ct else (stats.pct(float(x[fin].mean())) if fin.any() else None),
            "t": ct.get("t_corr"),
            "win": stats.pct(float((x[fin] > 0).mean())) if fin.any() else None,
            "median": stats.pct(float(np.median(x[fin]))) if fin.any() else None,
            "n": int(fin.sum()),
        }
    return out


class HoldingBook:
    """judge.Book 的同一套規則，另外記錄每天收盤時的持股（讀值面板的當週持股五檔）。"""

    def __init__(self, book: Any):
        self.b = book

    def run(self, k: int, keys: np.ndarray, start: int, stop: int) -> tuple[np.ndarray, list[list[int]]]:
        b = self.b
        cash, prev_eq = 1.0, 1.0
        pos: dict[int, list[float]] = {}
        n = stop - start
        eq = np.ones(n)
        held: list[list[int]] = []
        sell = (1 - b.slip) * (1 - b.fee - b.tax)
        buy = (1 + b.slip) * (1 + b.fee)
        for d in range(start, stop):
            if pos:
                for c in [c for c, p in pos.items() if int(p[1]) == d]:
                    shares, _, px, _ = pos.pop(c)
                    cash += shares * px * sell
            idx = b.by_day.get(d)
            if idx is not None:
                free = k - len(pos)
                for j in idx[np.argsort(keys[idx], kind="stable")]:
                    if free <= 0:
                        break
                    c, x = int(b.c[j]), int(b.x[j])
                    if c in pos or x <= d:
                        continue
                    alloc = min(prev_eq / k, cash)
                    if alloc <= 0:
                        break
                    cash -= alloc
                    pos[c] = [alloc / (b.entry[j] * buy), x, float(b.px[j]), float(b.entry[j])]
                    free -= 1
            value_now = cash
            for c, p in pos.items():
                cl = b.close[d, c]
                if cl == cl:
                    p[3] = float(cl)
                value_now += p[0] * p[3]
            eq[d - start] = value_now
            prev_eq = value_now
            held.append(sorted(pos))
        return eq, held


def weekly(values: np.ndarray, dates: list[str]) -> tuple[list[str], np.ndarray, list[int]]:
    """日序列 → 每週最後一個交易日（W-FRI）：(週日期, 值, 該週最後一日在日序列的索引)。"""
    s = pd.Series(np.arange(len(dates)), index=pd.to_datetime(dates))
    last = s.resample("W-FRI").last().dropna().astype(int)
    idx = last.to_list()
    return [dates[i] for i in idx], np.asarray(values)[idx], idx


def bench_series(mk: Market, ev: Any) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {"tr": np.asarray(mk.bench, dtype=float)}
    for code in ("0050", "00631L"):
        s = (getattr(ev, "etf", {}) or {}).get(code)
        if s is not None:
            out[code] = np.asarray(s["close"], dtype=float)
    return out


def _p3(p: dict[str, Any]) -> dict[str, Any]:
    return {"cagr": p.get("ann_return"), "sharpe": p.get("sharpe"), "mdd": p.get("mdd"), "total": p.get("total")}


def _q(xs: list[float]) -> dict[str, float | None]:
    if not xs:
        return {"p5": None, "p50": None, "p95": None}
    p5, p50, p95 = np.percentile(np.asarray(xs), [5, 50, 95])
    return {"p5": round(float(p5), 2), "p50": round(float(p50), 2), "p95": round(float(p95), 2)}


def random_stats(paths: np.ndarray, lo: int, hi: int, dates: list[str]) -> dict[str, Any]:
    """全期間隨機路徑（runs × 天）在 [lo, hi) 重設為 1：年化／Sharpe／最大回撤分位與每週淨值分位帶。"""
    if paths.size == 0 or hi - lo < 20:
        return {}
    sub = paths[:, lo:hi]
    base = sub[:, :1]
    sub = sub / np.where(base > 0, base, np.nan)
    cg, sh, md = [], [], []
    for row in sub:
        p = perf(row, dates[lo:hi])
        if p.get("ann_return") is not None:
            cg.append(float(p["ann_return"]))
            md.append(float(p["mdd"]))
            if p.get("sharpe") is not None:
                sh.append(float(p["sharpe"]))
    wd, _, widx = weekly(np.zeros(hi - lo), dates[lo:hi])
    band = np.nanpercentile(sub[:, widx], [5, 50, 95], axis=0)
    return {
        "cagr": _q(cg),
        "sharpe": _q(sh),
        "mdd": _q(md),
        "runs": int(sub.shape[0]),
        "band": {
            "p5": [round(float(v), 4) for v in band[0]],
            "p50": [round(float(v), 4) for v in band[1]],
            "p95": [round(float(v), 4) for v in band[2]],
        },
        "dates": wd,
    }


def horizon_frames(mk: Market, d: pd.DataFrame) -> dict[int, pd.DataFrame]:
    """同一組 40 日去重事件（訊號列 t、股票 c）在不同持有天數的報酬與超額。"""
    t = d["t"].to_numpy(dtype=np.int64)
    c = d["c"].to_numpy(dtype=np.int64)
    out: dict[int, pd.DataFrame] = {}
    for h in HORIZONS:
        if h not in mk.fmin:
            continue
        f = engine.annotate(engine.evaluate(mk, t, c, h), mk)
        out[h] = f
    return out


def period_pack(
    ctx: dict[str, Any],
    mask: np.ndarray,
    start: str,
    d: pd.DataFrame,
    trades: pd.DataFrame,
    book: Any,
    spec: np.ndarray,
    paths: np.ndarray,
    H: int,
    k5: int,
    exits_frames: dict[str, pd.DataFrame] | None = None,
) -> dict[str, Any]:
    ev, mk = ctx["ev"], ctx["mk"]
    dates = list(ev.dates)
    dates_np = np.asarray(dates)
    end = dates[-1]
    s0 = max(1, int(np.searchsorted(dates_np, start)))
    hb = HoldingBook(book)
    bseries = bench_series(mk, ev)
    hf = horizon_frames(mk, d) if len(d) else {}
    periods: dict[str, Any] = {}
    year_rows: dict[str, dict[str, Any]] = {}
    for key, lo_d, hi_d in period_keys(start, end):
        lo = max(s0, int(np.searchsorted(dates_np, lo_d)))
        hi = int(np.searchsorted(dates_np, hi_d, side="right"))
        if hi - lo < 2:
            continue
        dp = d[(d["date"] >= lo_d) & (d["date"] <= hi_d)] if len(d) else d
        pdays = hi - lo
        card = card_stats(dp, H, pdays)
        multi: dict[str, Any] = {}
        for h, f in hf.items():
            fp = f[(f["date"] >= lo_d) & (f["date"] <= hi_d) & (f["status"] == "ok")]
            multi[str(h)] = card_stats(fp, h, pdays)
        eq, held = hb.run(k5, spec, lo, hi)
        pd_dates = dates[lo:hi]
        port = perf(eq, pd_dates)
        bench = {
            b: _p3(perf(v[lo:hi] / v[lo] if np.isfinite(v[lo]) and v[lo] > 0 else v[lo:hi], pd_dates))
            for b, v in bseries.items()
        }
        wd, wv, widx = weekly(eq, pd_dates)
        entry: dict[str, Any] = {
            "from": dates[lo],
            "to": dates[hi - 1],
            "days": pdays,
            "card": card,
            "multi": multi,
            "port": _p3(port),
            "bench": bench,
            "random": random_stats(paths, lo - s0, hi - s0, dates[s0:]) if paths.size else {},
        }
        if key in ("all",) or key.startswith("year:") or key.startswith("from:") or key.startswith("last:"):
            lines: dict[str, list[float | None]] = {"port": [round(float(v), 4) for v in wv]}
            for b, v in bseries.items():
                base = v[lo]
                lines[b] = [
                    round(float(v[lo + i] / base), 4) if np.isfinite(v[lo + i]) and base > 0 else None for i in widx
                ]
            entry["weekly"] = {"dates": wd, **lines}
        if key == "all":
            entry["weekly"]["held"] = [[str(ev.codes[c]) for c in held[i]] for i in widx]
            with np.errstate(invalid="ignore"):
                dd = eq / np.maximum.accumulate(eq) - 1
            entry["weekly"]["drawdown"] = [round(float(dd[i]) * 100, 2) for i in widx]
        if key.startswith("year:"):
            y = key.split(":")[1]
            year_rows[y] = {
                "year": y,
                "n": card["n"],
                "excess": {b: card[b]["excess"] for b in BENCHES},
                "port": stats.pct(float(eq[-1] / eq[0] - 1)) if eq.size else None,
                "bench": {
                    b: stats.pct(float(v[hi - 1] / v[lo] - 1))
                    if np.isfinite(v[lo]) and np.isfinite(v[hi - 1]) and v[lo] > 0
                    else None
                    for b, v in bseries.items()
                },
            }
        # 累積超額曲線（四個基準，95% 帶）
        if len(dp):
            cv = curve.curve(mk, dp, 120, CURVE_REPS if key == "all" else 0, 20261003)
            entry["curve"] = {
                b: {
                    "mean": (cv.get(b) or {}).get("mean"),
                    "lo": (cv.get(b) or {}).get("lo"),
                    "hi": (cv.get(b) or {}).get("hi"),
                }
                for b in BENCHES
                if cv.get(b)
            }
        periods[key] = entry
    # 逐筆訊號（40 日去重事件）＋各出場規則對同一組事件的逐筆結果（另存 strategy/{id}-signals.json）
    sig = signals_table(d, hf, ev)
    if exits_frames and len(d):
        ekeys = list(zip(d["e"].to_numpy(dtype=np.int64), d["c"].to_numpy(dtype=np.int64), strict=True))
        names = list(exits_frames)
        sig["exit_rules"] = names
        for i, name in enumerate(names):
            f = exits_frames[name]
            m = {
                (int(e), int(c)): (float(n), float(x))
                for e, c, n, x in zip(
                    f["e"], f["c"], f["net"], f.get("exc_0050", pd.Series(np.nan, index=f.index)), strict=True
                )
            }
            ks = [(int(e), int(c)) for e, c in ekeys]
            sig[f"exit{i}_net"] = [stats.pct(m[k][0]) if k in m and np.isfinite(m[k][0]) else None for k in ks]
            sig[f"exit{i}_ex0050"] = [stats.pct(m[k][1]) if k in m and np.isfinite(m[k][1]) else None for k in ks]
    out = {
        "start": start,
        "end": end,
        "horizon": H,
        "slots": k5,
        "periods": periods,
        "years": [year_rows[y] for y in sorted(year_rows)],
        "monthly": monthly_series(d),
        "rolling3y": rolling3y(d),
        "screen": screen_now(ctx, mask, H),
        "_signals": sig,
    }
    return out


def signals_table(d: pd.DataFrame, hf: dict[int, pd.DataFrame], ev: Any) -> dict[str, Any]:
    if d.empty:
        return {"n": 0}
    dates = list(ev.dates)
    key = list(zip(d["t"].to_numpy(dtype=np.int64), d["c"].to_numpy(dtype=np.int64), strict=True))
    out: dict[str, Any] = {
        "n": len(d),
        "signal": [dates[int(t)] for t, _ in key],
        "entry": [dates[int(e)] if int(e) < len(dates) else None for e in d["e"].to_numpy(dtype=np.int64)],
        "code": [str(ev.codes[int(c)]) for _, c in key],
    }
    for b, col in BENCHES.items():
        out[f"ex_{b}"] = (
            [stats.pct(float(v)) if np.isfinite(v) else None for v in d[col].to_numpy(dtype=float)] if col in d else []
        )
    for h, f in hf.items():
        m = {
            (int(t), int(c)): float(v)
            for t, c, v, s in zip(f["t"], f["c"], f["net"], f["status"], strict=True)
            if s == "ok"
        }
        out[f"net_{h}"] = [stats.pct(m[k]) if k in m and np.isfinite(m[k]) else None for k in key]
    return out


def monthly_series(d: pd.DataFrame) -> dict[str, Any]:
    """日曆時間法的月度超額：每個進場月份的平均超額（四個基準）與筆數。"""
    if d.empty:
        return {}
    m = d.assign(month=[s[:7] for s in d["date"]])
    g = m.groupby("month")
    out: dict[str, Any] = {"month": list(g.size().index), "n": [int(v) for v in g.size().to_numpy()]}
    for b, col in BENCHES.items():
        if col in m:
            out[b] = [stats.pct(float(v)) if np.isfinite(v) else None for v in g[col].mean().to_numpy(dtype=float)]
    return out


def rolling3y(d: pd.DataFrame, months: int = 36) -> dict[str, Any]:
    """滾動 3 年：每個月底往回 36 個月的訊號，月度超額（日曆時間法）的平均與 95% 區間（四個基準）。"""
    if d.empty:
        return {}
    m = d.assign(month=pd.PeriodIndex([s[:7] for s in d["date"]], freq="M"))
    allm = pd.period_range(m["month"].min(), m["month"].max(), freq="M")
    out: dict[str, Any] = {"month": []}
    for b in BENCHES:
        out[b] = {"mean": [], "lo": [], "hi": []}
    for end in allm[months - 1 :]:
        sub = m[(m["month"] > end - months) & (m["month"] <= end)]
        out["month"].append(str(end))
        for b, col in BENCHES.items():
            if col not in sub:
                continue
            mon = sub.groupby("month")[col].mean().to_numpy(dtype=float)
            mon = mon[np.isfinite(mon)]
            if mon.size < 6:
                out[b]["mean"].append(None)
                out[b]["lo"].append(None)
                out[b]["hi"].append(None)
                continue
            mu, se = float(mon.mean()), float(mon.std(ddof=1) / np.sqrt(mon.size))
            out[b]["mean"].append(stats.pct(mu))
            out[b]["lo"].append(stats.pct(mu - 1.96 * se))
            out[b]["hi"].append(stats.pct(mu + 1.96 * se))
    return out


def spark_rel(pack: dict[str, Any], key: str = "last:3", step: int = 4) -> dict[str, Any] | None:
    """策略庫列表的迷你折線：近 3 年 5 檔組合相對 0050 的累積超額（%）＝組合權益 ÷ 0050 權益 − 1，每 4 週取一點（含最後一點）。"""
    w = ((pack.get("periods") or {}).get(key) or {}).get("weekly") or {}
    dates, port, ref = w.get("dates") or [], w.get("port") or [], w.get("0050") or []
    pts = [(d, p / r) for d, p, r in zip(dates, port, ref, strict=False) if p is not None and r]
    if len(pts) < 2:
        return None
    idx = list(range(0, len(pts), step))
    if idx[-1] != len(pts) - 1:
        idx.append(len(pts) - 1)
    return {"from": pts[0][0], "to": pts[-1][0], "v": [round((pts[i][1] - 1) * 100, 2) for i in idx]}


def screen_now(ctx: dict[str, Any], mask: np.ndarray, h: int) -> dict[str, Any]:
    """目前篩出＋觸發日（最近一次首次觸發）、第 k 日、觸發以來報酬（觸發次一交易日開盤起算）；今日新觸發＝觸發日為最後一天者。
    篩出＝最後一天仍符合條件，或最近一次首次觸發還在 h 日持有期內（事件型條件——例：月營收創新高——只在公布日成立，
    以「觸發後仍在持有期」視為仍符合）。"""
    ev, mk, uni = ctx["ev"], ctx["mk"], ctx["uni"]
    dates = list(ev.dates)
    T = len(dates)
    first = engine.first_triggers(mask, uni, h)
    recent = first[max(0, T - h) :].any(axis=0)
    now = np.nonzero((mask & uni)[T - 1] | recent)[0]
    rows = []
    for c in now:
        ts = np.nonzero(first[:, c])[0]
        if not ts.size:
            continue
        t = int(ts[-1])
        e = t + 1
        ret = None
        if e < T:
            op = mk.open[e, c]
            cl = mk.close[T - 1, c]
            if np.isfinite(op) and np.isfinite(cl) and op > 0:
                ret = stats.pct(float(cl / op - 1))
        rows.append([str(ev.codes[int(c)]), dates[t], T - 1 - t, ret])
    rows.sort(key=lambda r: (r[1], r[0]), reverse=True)
    return {
        "date": dates[-1],
        "rows": rows,
        "cols": ["code", "trigger", "day", "ret"],
        "new": [r[0] for r in rows if r[1] == dates[-1]],
    }
