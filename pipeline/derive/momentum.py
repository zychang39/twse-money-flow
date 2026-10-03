"""個股頁「動能」需要橫斷面（全市場）比較的數字：只能在 pipeline 算，輸出到個股檔的 `mom` 鍵。

- 報酬：1M／3M／6M／12M＝最近 21／63／126／252 個交易日的還原收盤報酬（%）。端點沒有成交時沿用最近 5 個交易日內
  最後一筆還原收盤（停牌超過 5 日為空值）。
- 全市場百分位：同一天全市場普通股（上市＋上櫃，與 RS 百分位同一個 universe）的報酬百分位
  ＝（平均名次 − 0.5）÷ 有效檔數 × 100；ETF 與其他非普通股不在 universe 內，百分位為空值（報酬照常輸出）。
- RS 百分位：沿用 metrics 的 rs_percentile（0.4 R63 + 0.2 R126 + 0.2 R189 + 0.2 R252 的全市場普通股百分位）；
  另輸出 20 個交易日前（市場交易日）的值。
- 產業相對強弱：所屬產業（公司基本資料的產業別）普通股近 3 個月報酬的中位數，在全部產業中由高到低的名次 n／N；
  成員少於 MIN_INDUSTRY_MEMBERS 檔的產業不參與排名（中位數照列、名次為空值）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from pipeline.core.normalize import is_common_stock
from pipeline.derive.export import clean

if TYPE_CHECKING:
    from pipeline.derive.build import Panels
    from pipeline.derive.metrics import MetricPanels

RETURN_WINDOWS: dict[str, int] = {"1M": 21, "3M": 63, "6M": 126, "12M": 252}
FILL_LIMIT = 5
RS_LAG = 20
INDUSTRY_WINDOW = "3M"
MIN_INDUSTRY_MEMBERS = 3


@dataclass
class MomentumContext:
    date: str | None
    ret: pd.DataFrame
    pct: pd.DataFrame
    universe: dict[str, int]
    rs_now: pd.Series
    rs_prev: pd.Series
    rs_prev_date: str | None
    industry_of: dict[str, str]
    industries: dict[str, dict[str, Any]] = field(default_factory=dict)
    ranked: int = 0


def cross_pct(values: pd.Series) -> pd.Series:
    """橫斷面百分位（0–100）：(平均名次 − 0.5) ÷ 有效數 × 100（與 indicators.cross_percentile 同一公式）。"""
    v = values.dropna()
    if v.empty:
        return pd.Series(np.nan, index=values.index)
    return ((v.rank(method="average") - 0.5) / len(v) * 100).reindex(values.index)


def window_returns(adj: pd.DataFrame, windows: dict[str, int] = RETURN_WINDOWS, fill: int = FILL_LIMIT) -> pd.DataFrame:
    """最新一天的 N 日報酬（%）：codes × windows。"""
    filled = adj.ffill(limit=fill)
    last = filled.iloc[-1]
    out = {}
    for key, n in windows.items():
        if len(filled) <= n:
            out[key] = pd.Series(np.nan, index=adj.columns)
            continue
        base = filled.iloc[-1 - n]
        out[key] = ((last / base - 1) * 100).where(base > 0)
    return pd.DataFrame(out)


def industry_ranks(
    ret: pd.Series, industry_of: dict[str, str], stocks: list[str]
) -> tuple[dict[str, dict[str, Any]], int]:
    """產業 → {median, members, rank}；只用普通股；名次由高到低（1＝中位數最高）。"""
    s = ret.reindex(stocks).dropna()
    groups: dict[str, list[float]] = {}
    for code, v in s.items():
        ind = industry_of.get(str(code))
        if ind:
            groups.setdefault(ind, []).append(float(v))
    medians = {k: float(np.median(v)) for k, v in groups.items()}
    table: dict[str, dict[str, Any]] = {
        k: {"median": medians[k], "members": len(v), "rank": None} for k, v in groups.items()
    }
    eligible = sorted((k for k, v in groups.items() if len(v) >= MIN_INDUSTRY_MEMBERS), key=lambda k: -medians[k])
    for i, k in enumerate(eligible):
        table[k]["rank"] = i + 1
    return table, len(eligible)


def build_context(p: Panels, mp: MetricPanels) -> MomentumContext:
    adj = p.adj_close
    stocks = [c for c in p.codes if is_common_stock(c)]
    ret = window_returns(adj)
    pct = pd.DataFrame({k: cross_pct(ret[k].reindex(stocks)).reindex(p.codes) for k in ret.columns})
    universe = {k: int(ret[k].reindex(stocks).notna().sum()) for k in ret.columns}
    rs = mp.get("rs_percentile")
    rs_now = rs.iloc[-1] if len(rs) else pd.Series(dtype=float)
    lag_i = len(p.dates) - 1 - RS_LAG
    rs_prev = rs.iloc[lag_i] if lag_i >= 0 else pd.Series(np.nan, index=p.codes)
    ind_of = {c: i for c, i in p.industries.items() if is_common_stock(c)}
    table, ranked = industry_ranks(ret[INDUSTRY_WINDOW], ind_of, stocks)
    return MomentumContext(
        date=p.dates[-1] if p.dates else None,
        ret=ret,
        pct=pct,
        universe=universe,
        rs_now=rs_now,
        rs_prev=rs_prev,
        rs_prev_date=p.dates[lag_i] if lag_i >= 0 else None,
        industry_of=ind_of,
        industries=table,
        ranked=ranked,
    )


def mom_block(ctx: MomentumContext, code: str) -> dict[str, Any] | None:
    """個股檔 `mom`：報酬（%）、全市場百分位（0–100）、RS 現值與 20 日前、產業 3 個月報酬中位數名次。"""
    if code not in ctx.ret.index:
        return None
    ret = {k: clean(ctx.ret.at[code, k], 2) for k in ctx.ret.columns}
    if all(v is None for v in ret.values()):
        return None
    ind_name = ctx.industry_of.get(code)
    ind = ctx.industries.get(ind_name) if ind_name else None
    return {
        "date": ctx.date,
        "ret": ret,
        "pct": {k: clean(ctx.pct.at[code, k], 1) for k in ctx.pct.columns},
        "n": ctx.universe,
        "rs": clean(ctx.rs_now.get(code), 1),
        "rs_prev": clean(ctx.rs_prev.get(code), 1),
        "rs_prev_date": ctx.rs_prev_date,
        "industry": (
            {
                "name": ind_name,
                "median": clean(ind["median"], 2),
                "members": ind["members"],
                "rank": ind["rank"],
                "of": ctx.ranked,
                "window": INDUSTRY_WINDOW,
            }
            if ind and ind_name
            else None
        ),
    }
