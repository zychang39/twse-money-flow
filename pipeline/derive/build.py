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
from pipeline.derive import etf as etfmod
from pipeline.derive import indicators as ind
from pipeline.derive.dataset import Dataset, industry_map, pivot, shares_outstanding
from pipeline.derive.export import arr, clean, is_listed_security, text_or_none, write_json

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
    events = adjust.all_events(close, open_, change, *adjust.tag_official(ds))
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
    market_last = p.dates[-1]
    # U-02：最新交易日沒有收盤價時，不把舊的漲跌當成「今日」。
    # 行情表有這檔但沒有成交 → no_trade；行情表完全沒有這檔（暫停交易、停牌）→ halted
    trade_status = None
    if last_i != market_last:
        listed_today = pd.notna(p.volume[code].get(market_last)) or pd.notna(p.open[code].get(market_last))
        trade_status = "no_trade" if listed_today else "halted"
    chg = _f(p.change[code].get(last_i)) if trade_status is None else None
    prev_close = close - chg if chg is not None else None
    vol = _f(p.volume[code].get(market_last if trade_status else last_i))
    val = _f(p.value[code].get(market_last if trade_status else last_i))
    mb = p.margin_balance[code]
    fn5 = _sum_last(p.foreign_net[code], 5)
    tn5 = _sum_last(p.trust_net[code], 5)
    avg20 = _f(p.value[code].iloc[-21:-1].mean())
    return {
        "date": last_i,
        "last_trade_date": last_i if trade_status else None,
        "trade_status": trade_status,
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


BASE_COLUMNS = [
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
    "last_trade_date",
    "trade_status",
    "adj_ev",
]
SCORE_COLUMNS = ["composite", "chip", "momentum", "fundamental", "valuation"]


def summary_columns() -> list[str]:
    fields = list(config.load("screener")["fields"].keys())
    extra = [f for f in fields if f not in BASE_COLUMNS and f not in SCORE_COLUMNS]
    return [
        *BASE_COLUMNS,
        *SCORE_COLUMNS,
        *extra,
        "margin_usage",
        "turnover",
        "price_change_5d",
        "fair_position",
        *[f"{c}_chg" for c in SCORE_COLUMNS],
        "short_change",
        "composite_chg_5d",
        "new_flags_5d",
        "new_flags",
        "flags",
    ]


SUMMARY_COLUMNS = summary_columns()


def short_halt_for(ds: Dataset, code: str) -> dict[str, Any] | None:
    sh = ds.table("short_halt")
    if sh.empty:
        return None
    hit = sh[sh["code"] == code]
    if hit.empty:
        return None
    r = hit.iloc[0]
    return {
        "last_cover_date": text_or_none(r.get("last_cover_date")),
        "end": text_or_none(r.get("end")),
        "reason": text_or_none(r.get("reason")),
    }


# summary 的 adj_ev 只放最近這麼多個交易日內的還原事件（快照比較、持股警示用；更早的由個股檔的 adj_events 提供）
ADJ_RECENT_DAYS = 120


def adjust_events_by_code(events: pd.DataFrame) -> dict[str, list[list[Any]]]:
    """還原事件依代號分組：[[日期, 因子, 類型], …]（日期由舊到新）。類型：dividend、capreduce、split、inferred。"""
    if events.empty:
        return {}
    out: dict[str, list[list[Any]]] = {}
    ev = events.sort_values("date")
    kinds = ev["kind"] if "kind" in ev.columns else pd.Series("official", index=ev.index)
    for d, c, f, k in zip(ev["date"], ev["code"], ev["factor"], kinds, strict=True):
        out.setdefault(str(c), []).append([str(d), round(float(f), 6), str(k)])
    return out


def summary_adj_events(code_ev: list[list[Any]], since: str) -> list[list[Any]] | None:
    """summary 的精簡版還原事件（只給「自上次查看」的快照比較用；持股換算一律讀個股檔的完整 adj_events）。

    分割、減資等結構性事件全部保留；除權息只保留跌幅 ≥ 顯著門檻一半（預設 1.5%）的——較小的股利
    不會讓「自上次漲跌 ≥ 3%」誤判。除權息寫成 [日期, 因子]、其他寫成 [日期, 因子, 類型]，減少 summary 大小。
    """
    half = float(config.ui()["significance"]["price_pct"]) / 200
    out: list[list[Any]] = []
    for d, f, k in code_ev:
        if d <= since:
            continue
        if k != "dividend":
            out.append([d, round(float(f), 4), k])
        elif f < 1 - half:
            out.append([d, round(float(f), 4)])
    return out or None


def inactive_list(ds: Dataset, p: Panels, active: set[str], last_date: str) -> dict[str, Any]:
    """U-01：近 20 個交易日沒有成交、因此沒有個股檔的證券（下市、長期停牌）。

    輸出最小資料（名稱、市場、最後交易日、是否仍在上市櫃公司清單），讓持股／自選與個股頁
    能說明原因，而不是無聲消失或露出 HTTP 404。
    """
    listed: set[str] | None = None
    if not ds.company.empty and "code" in ds.company.columns:
        listed = set(ds.company["code"].astype(str))
    rows = []
    for code in p.codes:
        if code in active:
            continue
        last = p.close[code].last_valid_index()
        rows.append(
            {
                "code": code,
                "name": p.names.get(code, code),
                "market": p.markets.get(code),
                "last_trade_date": last,
                "status": "halted" if listed is not None and code in listed else "inactive",
            }
        )
    return {"date": last_date, "rows": rows}


def build_all(ds: Dataset, out: Path, meta: dict[str, Any]) -> dict[str, Any]:
    from pipeline.derive import fairvalue, fundamentals, metrics, scores, stockdetail
    from pipeline.derive import flags as flagmod

    p = build_panels(ds)
    last_date = p.dates[-1]
    # 合理價（逐日），供估值因子使用
    divs = fairvalue.dividend_panel(ds.exright, p.dates, p.codes)
    fv = fairvalue.fair_value_panels(p.close, p.pe, p.pb, divs)
    from pipeline.derive.advanced_panels import advanced_panels

    adv = advanced_panels(ds, p)
    extra = {"fair_value_position": fv["position"], **adv}
    mp = metrics.build_metrics(p, ds.revenue, extra)
    sc = scores.compute_scores(mp)
    flags = flagmod.build_flags(ds, p, mp)
    flags_prev = flagmod.build_flags(ds, p, mp, at=-2) if len(p.dates) >= 2 else {}
    flags_week = flagmod.build_flags(ds, p, mp, at=-6) if len(p.dates) >= 6 else {}
    cols = SUMMARY_COLUMNS
    rows: list[list[Any]] = []
    written = 0
    active = [c for c in p.codes if pd.notna(p.close[c].iloc[-20:]).any()]  # 近 20 日有交易
    since = p.dates[max(0, len(p.dates) - 260)]
    etf_changes = etfmod.holdings_changes(ds.table("etf_holdings"))
    etf_holders = etfmod.holders_by_stock(etf_changes, p.names)
    chip_src = stockdetail.chip_sources(ds)
    holder_src = stockdetail.holder_sources(ds)
    conf_src = stockdetail.conference_sources(ds)
    ev_by_code = adjust_events_by_code(p.events)
    recent_from = p.dates[max(0, len(p.dates) - ADJ_RECENT_DAYS)]
    for code in active:
        m = stock_metrics(p, code)
        if not m:
            continue
        for name in cols:
            if name in m or name in ("code", "name", "market", "industry", "flags"):
                continue
            if name in SCORE_COLUMNS:
                m[name] = clean(sc[name][code].iloc[-1], 0)
            elif name == "fair_position":
                m[name] = clean(fv["position"][code].iloc[-1], 1)
            else:
                m[name] = clean(mp.last(name, code), 2)
        m["flags"] = flags.get(code, [])
        prev_ids = {f["id"] for f in flags_prev.get(code, [])}
        m["new_flags"] = [f["id"] for f in m["flags"] if f["id"] not in prev_ids]
        week_ids = {f["id"] for f in flags_week.get(code, [])}
        m["new_flags_5d"] = [f["id"] for f in m["flags"] if f["id"] not in week_ids]
        for cat in SCORE_COLUMNS:
            series = sc[cat][code]
            m[f"{cat}_chg"] = clean(series.iloc[-1] - series.iloc[-2], 0) if len(series) >= 2 else None
        comp = sc["composite"][code]
        m["composite_chg_5d"] = clean(comp.iloc[-1] - comp.iloc[-6], 0) if len(comp) >= 6 else None
        sbal = p.short_balance[code]
        m["short_change"] = clean(sbal.diff().iloc[-1] if len(sbal.dropna()) >= 2 else None, 0)
        m.update(
            {"code": code, "name": p.names.get(code), "market": p.markets.get(code), "industry": p.industries.get(code)}
        )
        code_ev = ev_by_code.get(code, [])
        m["adj_ev"] = summary_adj_events(code_ev, recent_from)
        rows.append([clean(m.get(col)) for col in cols])
        fair = fairvalue.fair_detail(fv, p.close, code)
        idx = [d for d, ok in zip(p.dates, p.close[code].notna(), strict=True) if ok]
        rev_now = {k: mp.last(k, code) for k in ("revenue_high_ratio", "revenue_yoy_3m", "revenue_growth_months")}
        extra_file = {
            "scores": scores.factor_detail(mp, sc, code),
            "fair": fair,
            "revenue": stockdetail.revenue_table(ds.revenue, code),
            "events": stockdetail.events_for(ds, code, since),
            "cost": stockdetail.cost_lines(p, code, idx) or None,
            "summary_text": stockdetail.health_summary(code, m, m["flags"], fair, rev_now),
            "flags": m["flags"],
            "dividends": stockdetail.dividends_for(ds, code),
            "series": {
                k: arr(mp.get(k)[code].reindex(idx).to_numpy(), 2)
                for k in ("rs_percentile", "pe_percentile", "pb_percentile")
                if k in mp.panels
            },
            **{
                key: arr((mp.get(name)[code].reindex(idx) / scale).to_numpy(), 2)
                for key, name, scale in (
                    ("sbl", "sbl_balance", 1000),
                    ("whale", "whale_pct", 1),
                    ("qfii", "foreign_hold_pct", 1),
                    ("dt", "daytrade_pct", 1),
                )
                if name in mp.panels and mp.get(name)[code].notna().any()
            },
            "quarters": fundamentals.latest_table(ds.table("financials"), code),
            "short_halt": short_halt_for(ds, code),
            "etf_holders": etf_holders.get(code),
            "chip": stockdetail.chip_block(p, mp, chip_src, code, idx),
            "holders": stockdetail.holders_block(holder_src, code),
            "conferences": stockdetail.conferences_for(conf_src, code, since),
            # D-01：還原事件（日期、因子、類型），前端換算持倉的進場價、停損價、股數
            "adj_events": [e for e in code_ev if idx and e[0] > idx[0]],
        }
        write_json(out / "stocks" / f"{code}.json", stock_file(p, code, m, extra_file))
        written += 1
    summary = {"date": last_date, "columns": cols, "rows": rows}
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
    write_json(out / "inactive.json", inactive_list(ds, p, set(active), last_date))
    from pipeline.derive.lists import build_lists

    write_json(out / "lists.json", build_lists(cols, rows, last_date))
    write_json(out / "disposition.json", flagmod.disposition_watchlist(ds, p))
    from pipeline.derive import extras as extras_mod

    report_extra = extras_mod.build_extras(ds, p, mp, sc, fv, out)
    from pipeline.derive import signals as signals_mod

    report_extra.update(signals_mod.screen_days(ds, p, mp, sc, out))
    report_extra.update(signals_mod.tracking_signals(ds, p, mp, sc, out))
    # S2：週資料（集保大戶）的資料基準日與公布日，選股頁在條件含這些欄位時顯示
    meta_extra["weekly"] = signals_mod.weekly_asof(ds)
    return {"stocks": written, "dates": len(p.dates), **report_extra, "meta": {"stocks": written, **meta_extra}}
