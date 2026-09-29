"""1.6 分組檢定：每月最後一個交易日依指標值分五組（Q1 最弱、Q5 最強），等權重持有到下個月最後一個交易日。

進出場沿用 1.3：月底 t 收盤後排序，t+1 開盤進場；下個月底 t' 收盤後換組，t'+1 開盤出場（跌停鎖死、停牌順延）。
每組每月扣一次來回成本（視為全部換手，保守）。
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence.engine import Market, net_return
from pipeline.evidence.stats import bootstrap_ci, mean_t, oos_cut, pct


def month_ends(dates: list[str]) -> list[int]:
    """每個月最後一個交易日的列索引。"""
    s = pd.Series(range(len(dates)), index=pd.to_datetime(dates))
    return [int(v) for v in s.groupby(s.index.to_period("M")).max().to_numpy()]


def spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    if a.size < 10:
        return None
    ra = pd.Series(a).rank().to_numpy()
    rb = pd.Series(b).rank().to_numpy()
    if ra.std() == 0 or rb.std() == 0:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])


def quintile_month(values: np.ndarray, rets: np.ndarray) -> tuple[list[float], float | None]:
    """一個月：依值分五組（名次等分），回傳各組平均報酬與 Spearman 秩相關。"""
    order = pd.Series(values).rank(method="first").to_numpy()
    bucket = np.ceil(order / values.size * 5).astype(int).clip(1, 5)
    means = [float(rets[bucket == q].mean()) if (bucket == q).any() else float("nan") for q in range(1, 6)]
    return means, spearman(values, rets)


def run(values: np.ndarray, mk: Market, universe: np.ndarray, start: str, cfg: dict[str, Any]) -> dict[str, Any]:
    dates = mk.dates
    ends = [i for i in month_ends(dates) if dates[i] >= start]
    T = len(dates)
    rows: list[dict[str, Any]] = []
    for a, b in pairwise(ends):
        e = a + 1
        if b + 1 >= T:
            break
        m = universe[a] & np.isfinite(values[a]) & mk.tradable[e] & ~mk.limit_up_open[e]
        cols = np.nonzero(m)[0]
        if cols.size < 50:
            continue
        h = b + 1 - e
        ex = mk.exits(np.full(cols.size, e), cols, h)
        with np.errstate(invalid="ignore", divide="ignore"):
            g = ex["px"] / mk.open[e, cols] - 1
        ok = np.isfinite(g)
        if ok.sum() < 50:
            continue
        r = net_return(g[ok], mk.fee, mk.tax)
        means, rho = quintile_month(values[a, cols[ok]], r)
        rows.append({"month": dates[a][:7], "q": means, "spread": means[4] - means[0], "rho": rho, "n": int(ok.sum())})
    if not rows:
        return {"months": 0}
    df = pd.DataFrame(rows)
    spread = df["spread"].to_numpy()
    m, se, t = mean_t(spread)
    st = cfg["stats"]
    lo, hi = bootstrap_ci(spread, int(st["bootstrap"]), int(st["seed"]))
    rho = df["rho"].dropna().to_numpy()
    rm, _, rt = mean_t(rho)
    qmeans = np.nanmean(np.vstack(df["q"].to_list()), axis=0)
    df["year"] = df["month"].str[:4]
    years = {}
    for y, part in df.groupby("year"):
        ym, _, yt = mean_t(part["spread"].to_numpy())
        years[str(y)] = {"n": len(part), "mean_excess": pct(ym), "t": None if yt is None else round(yt, 2)}
    cut = oos_cut([f"{x}-01" for x in df["month"]], float(st["oos_fraction"]))
    oos_part = df[[f"{x}-01" >= (cut or "") for x in df["month"]]]
    om, _, ot = mean_t(oos_part["spread"].to_numpy())
    return {
        "months": len(df),
        "first_month": df["month"].iloc[0],
        "last_month": df["month"].iloc[-1],
        "avg_stocks": int(df["n"].mean()),
        "q_mean": [pct(v) for v in qmeans],
        "main": {
            "mean_excess": pct(m),
            "se": pct(se),
            "t": None if t is None else round(t, 2),
            "ci": [pct(lo), pct(hi)],
        },
        "rho_mean": None if rm is None else round(rm, 4),
        "rho_t": None if rt is None else round(rt, 2),
        "years": years,
        "oos": {"start": cut, "n": len(oos_part), "mean_excess": pct(om), "t": None if ot is None else round(ot, 2)},
        "series": [
            {"m": r["month"], "s": pct(r["spread"]), "rho": None if r["rho"] is None else round(r["rho"], 3)}
            for r in rows
        ],
    }
