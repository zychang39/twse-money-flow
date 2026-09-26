"""組裝全市場面板並輸出 summary.json 與個股檔。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive import adjust
from pipeline.derive import indicators as ind
from pipeline.derive.dataset import Dataset, industry_map, pivot, shares_outstanding
from pipeline.derive.export import arr, clean, is_listed_security, write_json

log = logging.getLogger(__name__)


@dataclass
class Panels:
    dates: list[str]
    codes: list[str]
    names: dict[str, str]
    markets: dict[str, str]
    industries: dict[str, str]
    shares: dict[str, float]
    open: pd.DataFrame
    high: pd.DataFrame
    low: pd.DataFrame
    close: pd.DataFrame
    volume: pd.DataFrame
    value: pd.DataFrame
    change: pd.DataFrame
    af: pd.DataFrame
    foreign_net: pd.DataFrame
    trust_net: pd.DataFrame
    dealer_net: pd.DataFrame
    total_net: pd.DataFrame
    margin_balance: pd.DataFrame
    margin_limit: pd.DataFrame
    short_balance: pd.DataFrame
    pe: pd.DataFrame
    pb: pd.DataFrame
    dy: pd.DataFrame
    extra: dict[str, pd.DataFrame] = field(default_factory=dict)
    events: pd.DataFrame = field(default_factory=pd.DataFrame)

    @property
    def adj_close(self) -> pd.DataFrame:
        return self.close * self.af

    @property
    def adj_open(self) -> pd.DataFrame:
        return self.open * self.af

    @property
    def avg_price(self) -> pd.DataFrame:
        return (self.value / self.volume).where(self.volume > 0)


def build_panels(ds: Dataset) -> Panels:
    dates = ds.dates
    q = ds.quotes[ds.quotes["code"].map(is_listed_security)]
    codes = sorted(q["code"].unique().tolist())
    last = q.sort_values("date").drop_duplicates("code", keep="last")
    names = dict(zip(last["code"], last["name"], strict=True))
    markets = dict(zip(last["code"], last["market"], strict=True))

    def p(df: pd.DataFrame, col: str) -> pd.DataFrame:
        wide = pivot(df, col, dates)
        return wide.reindex(columns=codes) if not wide.empty else pd.DataFrame(np.nan, index=dates, columns=codes)

    close = p(q, "close")
    open_ = p(q, "open")
    change = p(q, "change")
    events = adjust.all_events(close, open_, change, ds.exright, ds.capreduce, *ds.extra.get("splits", []))
    panels = Panels(
        dates=dates,
        codes=codes,
        names=names,
        markets=markets,
        industries=industry_map(ds),
        shares=shares_outstanding(ds),
        open=open_,
        high=p(q, "high"),
        low=p(q, "low"),
        close=close,
        volume=p(q, "volume"),
        value=p(q, "value"),
        change=change,
        af=ind.adjustment_table(dates, codes, events),
        foreign_net=p(ds.insti, "foreign_net"),
        trust_net=p(ds.insti, "trust_net"),
        dealer_net=p(ds.insti, "dealer_net"),
        total_net=p(ds.insti, "total_net"),
        margin_balance=p(ds.margin, "margin_balance"),
        margin_limit=p(ds.margin, "margin_limit"),
        short_balance=p(ds.margin, "short_balance"),
        pe=p(ds.valuation, "pe"),
        pb=p(ds.valuation, "pb"),
        dy=p(ds.valuation, "dividend_yield"),
    )
    panels.events = events
    return panels


def _last_valid(s: pd.Series) -> float | None:
    s = s.dropna()
    return float(s.iloc[-1]) if len(s) else None


def _sum_last(s: pd.Series, n: int) -> float | None:
    tail = s.iloc[-n:]
    return float(tail.sum()) if tail.notna().any() else None


def _f(v: Any) -> float | None:
    """轉成 float；None／NaN → None。"""
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _div(a: float | None, b: float | None, scale: float = 1.0) -> float | None:
    return a / b * scale if a is not None and b else None


def stock_metrics(p: Panels, code: str) -> dict[str, Any]:
    """單檔最新一日的基本指標（行情、法人、信用、估值）。"""
    c = p.close[code]
    last_i = c.last_valid_index()
    if last_i is None:
        return {}
    close = float(c[last_i])
    chg = _f(p.change[code].get(last_i))
    prev_close = close - chg if chg is not None else None
    vol = _f(p.volume[code].get(last_i))
    val = _f(p.value[code].get(last_i))
    mb = p.margin_balance[code]
    fn5 = _sum_last(p.foreign_net[code], 5)
    tn5 = _sum_last(p.trust_net[code], 5)
    avg20 = _f(p.value[code].iloc[-21:-1].mean())
    return {
        "date": last_i,
        "close": close,
        "change": clean(chg),
        "change_pct": clean(_div(chg, prev_close, 100), 2),
        "volume_lots": clean(_div(vol, 1000), 0),
        "value_million": clean(_div(val, 1e6), 1),
        "foreign_net_lots": clean((_last_valid(p.foreign_net[code].loc[:last_i]) or 0) / 1000, 0),
        "trust_net_lots": clean((_last_valid(p.trust_net[code].loc[:last_i]) or 0) / 1000, 0),
        "dealer_net_lots": clean((_last_valid(p.dealer_net[code].loc[:last_i]) or 0) / 1000, 0),
        "foreign_streak": ind.streak_last(p.foreign_net[code].to_numpy(dtype=float)),
        "trust_streak": ind.streak_last(p.trust_net[code].to_numpy(dtype=float)),
        "foreign_net_5d": clean(_div(fn5, 1000), 0),
        "trust_net_5d": clean(_div(tn5, 1000), 0),
        "margin_balance": clean(_last_valid(mb)),
        "margin_change": clean(mb.diff().iloc[-1] if len(mb.dropna()) >= 2 else None, 0),
        "short_balance": clean(_last_valid(p.short_balance[code])),
        "pe": clean(p.pe[code].get(last_i), 2),
        "pb": clean(p.pb[code].get(last_i), 2),
        "dividend_yield": clean(p.dy[code].get(last_i), 2),
        "volume_ratio_20": clean(_div(val, avg20), 2),
    }


def stock_file(p: Panels, code: str, metrics: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    c = p.close[code]
    mask = c.notna()
    idx = [d for d, ok in zip(p.dates, mask, strict=True) if ok]

    def col(frame: pd.DataFrame, scale: float = 1.0, digits: int = 2) -> list[Any]:
        return arr((frame[code].reindex(idx) / scale).to_numpy(), digits)

    return {
        "code": code,
        "name": p.names.get(code, code),
        "market": p.markets.get(code),
        "industry": p.industries.get(code),
        "shares": clean(p.shares.get(code)),
        "d": idx,
        "o": col(p.open),
        "h": col(p.high),
        "l": col(p.low),
        "c": col(p.close),
        "v": col(p.volume, 1000, 0),
        "val": col(p.value, 1e6, 1),
        "af": arr(p.af[code].reindex(idx).to_numpy(), 6),
        "fn": col(p.foreign_net, 1000, 0),
        "tn": col(p.trust_net, 1000, 0),
        "dn": col(p.dealer_net, 1000, 0),
        "mb": col(p.margin_balance, 1, 0),
        "sb": col(p.short_balance, 1, 0),
        "pe": col(p.pe),
        "pb": col(p.pb),
        "dy": col(p.dy),
        "metrics": metrics,
        **extra,
    }


SUMMARY_COLUMNS = [
    "code",
    "name",
    "market",
    "industry",
    "close",
    "change",
    "change_pct",
    "volume_lots",
    "value_million",
    "foreign_net_lots",
    "trust_net_lots",
    "dealer_net_lots",
    "foreign_streak",
    "trust_streak",
    "foreign_net_5d",
    "trust_net_5d",
    "margin_balance",
    "margin_change",
    "short_balance",
    "pe",
    "pb",
    "dividend_yield",
    "flags",
]


def build_all(ds: Dataset, out: Path, meta: dict[str, Any]) -> dict[str, Any]:
    p = build_panels(ds)
    last_date = p.dates[-1]
    rows: list[list[Any]] = []
    written = 0
    active = [c for c in p.codes if pd.notna(p.close[c].iloc[-20:]).any()]  # 近 20 日有交易
    for code in active:
        m = stock_metrics(p, code)
        if not m:
            continue
        m["flags"] = []
        m.update(
            {"code": code, "name": p.names.get(code), "market": p.markets.get(code), "industry": p.industries.get(code)}
        )
        rows.append([clean(m.get(col)) for col in SUMMARY_COLUMNS])
        write_json(out / "stocks" / f"{code}.json", stock_file(p, code, m, {}))
        written += 1
    summary = {"date": last_date, "columns": SUMMARY_COLUMNS, "rows": rows}
    inferred = p.events[p.events["source"] == "inferred"] if not p.events.empty else p.events
    meta_extra = {
        "adjust_events": len(p.events),
        "adjust_inferred": [
            {"date": d, "code": c, "name": p.names.get(c, c), "factor": round(float(f), 4)}
            for d, c, f in zip(
                inferred.get("date", []), inferred.get("code", []), inferred.get("factor", []), strict=True
            )
        ],
    }
    write_json(out / "summary.json", summary)
    _ = config
    return {"stocks": written, "dates": len(p.dates), "meta": {"stocks": written, **meta_extra}}
