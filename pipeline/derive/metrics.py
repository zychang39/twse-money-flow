"""全市場逐日指標面板（dates × codes）。分數、選股、回測共用同一套面板，確保一致。

所有面板在 T 日的值只使用 T 日（含）以前已公布的資料：
- 行情、法人、信用、估值：T 日盤後公布。
- 月營收：自實際公布日（first_seen）起生效；取不到則保守假設次月 10 日（遇非交易日順延）。
- 季財報：自法定期限起生效（Q1 5/15、Q2 8/14、Q3 11/14、年報 3/31）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock
from pipeline.derive import indicators as ind

if TYPE_CHECKING:
    from pipeline.derive.build import Panels

log = logging.getLogger(__name__)


def rolling_own_percentile(frame: pd.DataFrame, lookback: int, min_obs: int) -> pd.DataFrame:
    """向量化版本：每一天的值在自身過去 lookback 日中的百分位 = (小於 + 0.5×等於) ÷ 有效數 × 100。"""
    roll = frame.rolling(lookback, min_periods=min_obs)
    rank = roll.rank(pct=True)
    count = roll.count()
    return ((rank - 0.5 / count) * 100).where(frame.notna())


def effective_date_for_month(ym: str, first_seen: str | None, fallback_day: int) -> str:
    """月營收生效日：有 first_seen 用之；否則為次月 fallback_day 日。"""
    if isinstance(first_seen, str) and first_seen:
        return first_seen
    y, m = int(ym[:4]), int(ym[5:7])
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return date(ny, nm, fallback_day).isoformat()


def as_of_panel(records: pd.DataFrame, value_col: str, dates: list[str], codes: list[str]) -> pd.DataFrame:
    """把 (code, effective_date, value) 事件表轉成逐日面板：生效日（含）起沿用到下一次更新。"""
    out = pd.DataFrame(np.nan, index=dates, columns=codes)
    if records.empty:
        return out
    idx = pd.Index(dates)
    for code, part in records.sort_values("effective").groupby("code"):
        if code not in out.columns:
            continue
        pos = idx.searchsorted(part["effective"].to_numpy(), side="left")
        series = pd.Series(np.nan, index=range(len(dates)))
        for p, v in zip(pos, part[value_col].to_numpy(dtype=float), strict=True):
            if p < len(dates):
                series.iloc[p] = v
        out[code] = series.ffill().to_numpy()
    return out


@dataclass
class MetricPanels:
    dates: list[str]
    codes: list[str]
    panels: dict[str, pd.DataFrame] = field(default_factory=dict)
    notes: dict[str, str] = field(default_factory=dict)

    def get(self, name: str) -> pd.DataFrame:
        if name in self.panels:
            return self.panels[name]
        return pd.DataFrame(np.nan, index=self.dates, columns=self.codes)

    def last(self, name: str, code: str) -> float | None:
        df = self.panels.get(name)
        if df is None or code not in df.columns:
            return None
        v = df[code].iloc[-1]
        return float(v) if v == v else None


def revenue_panels(revenue: pd.DataFrame, dates: list[str], codes: list[str]) -> dict[str, pd.DataFrame]:
    """逐月計算月營收指標（每個月只用到該月以前的營收），再依生效日展開成逐日面板。"""
    if revenue.empty:
        return {}
    fallback = int(config.thresholds()["backtest"]["revenue_fallback_day"])
    rev = revenue.dropna(subset=["revenue"]).copy()
    rev = rev[rev["code"].isin(codes)]
    rows = []
    for code, part in rev.groupby("code"):
        part = part.sort_values("ym").drop_duplicates("ym", keep="last")
        s = pd.Series(part["revenue"].to_numpy(dtype=float), index=part["ym"].tolist())
        # 若 MOPS 資料缺「去年同月」但有「去年當月營收」欄，補進序列以計算年增率
        if "revenue_last_year" in part.columns:
            for ym, ly in zip(part["ym"], part["revenue_last_year"], strict=True):
                prev = f"{int(ym[:4]) - 1:04d}-{ym[5:7]}"
                if prev not in s.index and ly == ly and ly:
                    s[prev] = float(ly)
            s = s.sort_index()
        seen = dict(zip(part["ym"], part.get("first_seen", pd.Series([None] * len(part))), strict=True))
        for i in range(len(s)):
            ym = s.index[i]
            if ym not in seen:  # 補進的去年值不產生訊號
                continue
            m: dict[str, object] = dict(ind.revenue_metrics(s.iloc[: i + 1]))
            m["code"] = code
            m["effective"] = effective_date_for_month(ym, seen.get(ym), fallback)
            rows.append(m)
    table = pd.DataFrame(rows)
    if table.empty:
        return {}
    out = {}
    for col, name in [
        ("yoy", "revenue_yoy"),
        ("yoy_3m", "revenue_yoy_3m"),
        ("yoy_trend", "revenue_yoy_trend"),
        ("high_ratio", "revenue_high_ratio"),
        ("growth_months", "revenue_growth_months"),
        ("mom", "revenue_mom"),
    ]:
        out[name] = as_of_panel(table.rename(columns={col: "v"})[["code", "effective", "v"]], "v", dates, codes)
    return out


def build_metrics(p: Panels, revenue: pd.DataFrame, extra: dict[str, pd.DataFrame] | None = None) -> MetricPanels:
    """p：build.Panels。extra：進階資料面板（大戶、外資持股、借券、財報），缺少時為 NaN。"""
    th = config.thresholds()["indicators"]
    mp = MetricPanels(dates=p.dates, codes=p.codes)
    adj = p.adj_close
    P = mp.panels
    # ---- 行情
    prev_close = p.close - p.change
    P["change_pct"] = (p.change / prev_close * 100).where(prev_close > 0)
    P["value_million"] = p.value / 1e6
    avg20 = p.value.shift(1).rolling(20, min_periods=10).mean()
    P["volume_ratio_20"] = p.value / avg20
    # ---- 籌碼
    P["foreign_streak"] = ind.streak_table(p.foreign_net)
    P["trust_streak"] = ind.streak_table(p.trust_net)
    P["foreign_net_5d"] = p.foreign_net.rolling(5, min_periods=1).sum() / 1000
    P["trust_net_5d"] = p.trust_net.rolling(5, min_periods=1).sum() / 1000
    mb = p.margin_balance
    P["margin_change_5d"] = (mb / mb.shift(5) - 1) * 100
    P["price_change_5d"] = (adj / adj.shift(5) - 1) * 100
    P["margin_usage"] = (mb / p.margin_limit * 100).where(p.margin_limit > 0)
    shares = pd.Series({c: p.shares.get(c, np.nan) for c in p.codes})
    P["turnover"] = p.volume.div(shares, axis=1) * 100
    for name in (
        "whale_pct",
        "whale_change",
        "whale400_pct",
        "foreign_hold_pct",
        "foreign_hold_change",
        "sbl_change",
        "sbl_balance",
        "daytrade_pct",
        "gross_margin_change",
        "roe",
        "eps_ttm",
        "bvps",
        "fair_value_position",
    ):
        if extra and name in extra:
            P[name] = extra[name].reindex(index=p.dates, columns=p.codes)
    # ---- 動能
    stocks = [c for c in p.codes if is_common_stock(c)]
    rs = ind.rs_raw(adj[stocks], th["rs"]["windows"], th["rs"]["weights"])
    P["rs_raw"] = rs.reindex(columns=p.codes)
    P["rs_percentile"] = ind.cross_percentile(rs).reindex(columns=p.codes)
    P["dist_52w_high"] = ind.dist_from_high(adj, int(th["high_52w_days"])) * 100
    for n in th["moving_averages"]:
        P[f"ma{n}_gap"] = (adj / ind.moving_average(adj, int(n)) - 1) * 100
    # ---- 估值
    vp = th["valuation_percentile"]
    P["pe"] = p.pe.where(p.pe > 0)
    P["pb"] = p.pb.where(p.pb > 0)
    P["dividend_yield"] = p.dy
    P["pe_percentile"] = rolling_own_percentile(P["pe"], int(vp["lookback_days"]), int(vp["min_observations"]))
    P["pb_percentile"] = rolling_own_percentile(P["pb"], int(vp["lookback_days"]), int(vp["min_observations"]))
    # ---- 基本面：月營收
    P.update(revenue_panels(revenue, p.dates, p.codes))
    log.info("指標面板：%d 項", len(P))
    return mp
