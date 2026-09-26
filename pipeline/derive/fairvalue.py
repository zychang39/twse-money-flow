"""合理價區間：本益比河流、殖利率法、淨值比法（逐日面板＋最新一日明細）。

- 近四季 EPS 以「收盤價 ÷ 交易所本益比」推得（交易所本益比 = 收盤價 ÷ 近四季 EPS），虧損時無本益比 → 不計算。
- 每股淨值以「收盤價 ÷ 股價淨值比」推得。
- 本益比／淨值比分位取自身近 756 個交易日（約 3 年），觀察值少於 120 日不計算。
- 近 5 年平均現金股利：除權息結果中的現金股利，依除息日加總近 1,260 個交易日，除以實際涵蓋年數（最多 5 年）。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config


def dividend_panel(events: pd.DataFrame, dates: list[str], codes: list[str]) -> pd.DataFrame:
    """除息日當天的每股現金股利（其他日為 0）。「權息」且無現金金額時以權值＋息值近似。"""
    out = pd.DataFrame(0.0, index=dates, columns=codes)
    if events.empty:
        return out
    ev = events.copy()
    cash = ev["cash_dividend"] if "cash_dividend" in ev.columns else pd.Series(np.nan, index=ev.index)
    approx = ev.get("rights_dividend", pd.Series(np.nan, index=ev.index)).where(ev.get("kind", "") == "權息")
    ev["cash"] = cash.fillna(approx).fillna(0.0)
    ev = ev[ev["code"].isin(codes) & ev["date"].isin(dates) & (ev["cash"] > 0)]
    for (d, c), v in ev.groupby(["date", "code"])["cash"].sum().items():
        out.at[d, c] += float(v)
    return out


def fair_value_panels(
    close: pd.DataFrame, pe: pd.DataFrame, pb: pd.DataFrame, divs: pd.DataFrame, data_start_index: int = 0
) -> dict[str, pd.DataFrame]:
    fv = config.thresholds()["fair_value"]
    lookback = int(config.thresholds()["indicators"]["valuation_percentile"]["lookback_days"])
    min_obs = int(config.thresholds()["indicators"]["valuation_percentile"]["min_observations"])
    q_pe = [q / 100 for q in fv["pe_quantiles"]]
    q_pb = [q / 100 for q in fv["pb_quantiles"]]
    mult = [float(m) for m in fv["yield_multiples"]]
    years = int(fv["dividend_years"])
    out: dict[str, pd.DataFrame] = {}
    pe_pos = pe.where(pe > 0)
    eps = close / pe_pos
    pb_pos = pb.where(pb > 0)
    bvps = close / pb_pos
    roll_pe = pe_pos.rolling(lookback, min_periods=min_obs)
    roll_pb = pb_pos.rolling(lookback, min_periods=min_obs)
    methods: dict[str, list[pd.DataFrame]] = {}
    methods["pe"] = [eps * roll_pe.quantile(q) for q in q_pe]
    methods["pb"] = [bvps * roll_pb.quantile(q) for q in q_pb]
    window = years * 252
    total = divs.rolling(window, min_periods=1).sum()
    n = np.arange(1, len(divs) + 1) - data_start_index
    covered_years = np.clip(n / 252, 1, years)
    avg_div = total.div(covered_years, axis=0).where(total > 0)
    methods["yield"] = [avg_div * m for m in mult]
    for name, (cheap, fair, exp) in methods.items():
        out[f"{name}_cheap"], out[f"{name}_fair"], out[f"{name}_expensive"] = cheap, fair, exp
    for k, label in enumerate(["cheap", "fair", "expensive"]):
        stack = [methods[m][k] for m in methods]
        num = sum(s.fillna(0) for s in stack)
        cnt = sum(s.notna().astype(int) for s in stack)
        out[f"combined_{label}"] = (num / cnt).where(cnt > 0)
    width = out["combined_expensive"] - out["combined_cheap"]
    out["position"] = ((close - out["combined_cheap"]) / width * 100).where(width > 0)
    out["eps_ttm"] = eps
    out["bvps"] = bvps
    out["avg_dividend"] = avg_div
    return out


METHOD_LABELS = {
    "pe": ("本益比河流", "近四季 EPS × 自身 3 年本益比第 20／50／80 百分位"),
    "yield": ("殖利率法", "近 5 年平均現金股利 × 15／20／30 倍"),
    "pb": ("淨值比法", "每股淨值 × 自身 3 年淨值比第 20／50／80 百分位"),
}


def fair_detail(panels: dict[str, pd.DataFrame], close: pd.DataFrame, code: str) -> dict[str, Any] | None:
    if code not in close.columns:
        return None
    price = close[code].dropna()
    if price.empty:
        return None

    def last(name: str) -> float | None:
        v = panels[name][code].iloc[-1]
        return round(float(v), 2) if v == v else None

    methods = []
    for m, (label, basis) in METHOD_LABELS.items():
        row = {
            "method": m,
            "label": label,
            "basis": basis,
            "cheap": last(f"{m}_cheap"),
            "fair": last(f"{m}_fair"),
            "expensive": last(f"{m}_expensive"),
        }
        if row["fair"] is not None:
            methods.append(row)
    if not methods:
        return None
    combined = None
    if last("combined_fair") is not None:
        combined = {
            "cheap": last("combined_cheap"),
            "fair": last("combined_fair"),
            "expensive": last("combined_expensive"),
        }
    pos = last("position")
    return {
        "methods": methods,
        "combined": combined,
        "position": None if pos is None else round(pos / 100, 3),
        "price": float(price.iloc[-1]),
        "eps_ttm": last("eps_ttm"),
        "bvps": last("bvps"),
        "avg_dividend": last("avg_dividend"),
    }
