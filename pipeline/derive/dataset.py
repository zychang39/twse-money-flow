"""把 data 分支的正規化檔案載入成分析用的面板（panel）。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_etf
from pipeline.core.store import DataStore

log = logging.getLogger(__name__)


def _concat(store: DataStore, sources: list[str], market_names: list[str] | None = None) -> pd.DataFrame:
    frames = []
    for i, sid in enumerate(sources):
        df = store.read_range(sid)
        if df.empty:
            continue
        if market_names:
            df["market"] = market_names[i]
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


@dataclass
class Dataset:
    store: DataStore
    quotes: pd.DataFrame = field(default_factory=pd.DataFrame)
    insti: pd.DataFrame = field(default_factory=pd.DataFrame)
    margin: pd.DataFrame = field(default_factory=pd.DataFrame)
    valuation: pd.DataFrame = field(default_factory=pd.DataFrame)
    index: pd.DataFrame = field(default_factory=pd.DataFrame)
    exright: pd.DataFrame = field(default_factory=pd.DataFrame)
    capreduce: pd.DataFrame = field(default_factory=pd.DataFrame)
    attention: pd.DataFrame = field(default_factory=pd.DataFrame)
    disposition: pd.DataFrame = field(default_factory=pd.DataFrame)
    attention_accum: pd.DataFrame = field(default_factory=pd.DataFrame)
    exright_notice: pd.DataFrame = field(default_factory=pd.DataFrame)
    revenue: pd.DataFrame = field(default_factory=pd.DataFrame)
    company: pd.DataFrame = field(default_factory=pd.DataFrame)
    margin_total: pd.DataFrame = field(default_factory=pd.DataFrame)
    extra: dict[str, list[pd.DataFrame]] = field(default_factory=dict)
    tables: dict[str, pd.DataFrame] = field(default_factory=dict)

    def table(self, name: str) -> pd.DataFrame:
        return self.tables.get(name, pd.DataFrame())

    manifest: dict[str, Any] = field(default_factory=dict)

    @property
    def dates(self) -> list[str]:
        if self.quotes.empty:
            return []
        return sorted(self.quotes["date"].unique().tolist())

    @property
    def last_date(self) -> str | None:
        d = self.dates
        return d[-1] if d else None


def load(store: DataStore) -> Dataset:
    ds = Dataset(store=store, manifest=store.load_manifest())
    ds.quotes = _concat(store, ["twse_quotes", "tpex_quotes"], ["twse", "tpex"])
    ds.insti = _concat(store, ["twse_insti", "tpex_insti"])
    ds.margin = _concat(store, ["twse_margin", "tpex_margin"])
    ds.valuation = _concat(store, ["twse_valuation", "tpex_valuation"])
    ds.index = _concat(store, ["twse_index", "tpex_index"], ["twse", "tpex"])
    ds.exright = _concat(store, ["twse_exright", "tpex_exright"], ["twse", "tpex"])
    ds.capreduce = _concat(store, ["twse_capreduce", "tpex_capreduce"], ["twse", "tpex"])
    ds.attention = _concat(store, ["twse_attention", "tpex_attention"], ["twse", "tpex"])
    ds.disposition = _concat(store, ["twse_disposition", "tpex_disposition"], ["twse", "tpex"])
    ds.margin_total = _concat(store, ["twse_margin_total", "tpex_margin_total"], ["twse", "tpex"])
    ds.revenue = store.read_range("revenue")
    for name, sources in {
        "sbl": ["twse_sbl", "tpex_sbl"],
        "qfii": ["twse_qfii", "tpex_qfii"],
        "daytrade": ["twse_daytrade", "tpex_daytrade"],
        "tdcc": ["tdcc_holders", "tdcc_history"],
        "taifex_insti": ["taifex_insti"],
        "taifex_oi": ["taifex_oi"],
        "taifex_pc": ["taifex_pc"],  # 臺指選擇權 Put/Call 比（M2 2026-10-03；只作資訊呈現）
        "fx": ["fx_usdtwd"],
        "ust": ["ust_10y"],
        "financials": ["financials"],
        "margin_total": [],
        "daytrade_total": ["twse_daytrade_total", "tpex_daytrade_total"],
        "etf_holdings": ["etf_holdings"],  # 主動式 ETF 持股（資料源待處理；有資料即生效）
        "conference": ["conference"],
    }.items():
        if sources:
            ds.tables[name] = _concat(store, sources)
    tdcc = ds.tables.get("tdcc")
    if tdcc is not None and not tdcc.empty:
        # 開放資料（整週全部股票）優先；個股歷史查詢只補開放資料沒有的週別
        tdcc = tdcc.drop_duplicates(["date", "code", "level"], keep="first")
        # 審查修正 2026-10-01：個股歷史查詢偶爾回傳錯誤的資料日期（例：2022-10-23 週日、2035-02-28 未來），
        # 集保資料日一定是營業日且不晚於最新行情日；不合的列視為壞資料（DATA_AUDIT.md）
        d = pd.to_datetime(tdcc["date"], errors="coerce")
        last = pd.Timestamp(ds.dates[-1]) if ds.dates else pd.Timestamp.max
        ok = d.notna() & (d.dt.weekday < 5) & (d <= last)
        ds.tables["tdcc"] = tdcc[ok.to_numpy()].reset_index(drop=True)
    for name, sources in {
        "short_halt": ["twse_short_halt", "tpex_short_halt"],
        "intraday_index": ["twse_intraday_index"],  # 只需要最新一天（首頁 1D）
        "insider": ["twse_insider", "tpex_insider"],
        "cbc_money": ["cbc_money"],
    }.items():
        frames = [latest[1] for latest in (store.latest(s) for s in sources) if latest is not None]
        ds.tables[name] = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    # v3 M1：上市櫃狀態。終止上市櫃取最新一份（名單本身就是全部歷史）；變更交易目前名單每一份快照都保留（asof＝快照日）
    frames = [
        latest[1] for latest in (store.latest(s) for s in ("twse_delisted", "tpex_delisted")) if latest is not None
    ]
    ds.tables["delisted"] = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    snaps = []
    for sid in ("twse_cmode", "tpex_cmode"):
        for d in store.dates(sid):
            snap = store.read(sid, d)
            if snap is not None:
                snaps.append(snap.assign(asof=d.isoformat(), source=sid))
    ds.tables["cmode"] = pd.concat(snaps, ignore_index=True) if snaps else pd.DataFrame()
    ds.tables["fulldelivery"] = store.read_range("twse_fulldelivery")
    splits = [store.read_range(s) for s in ("twse_parchange", "twse_etfsplit", "tpex_etfsplit", "tpex_etfrevsplit")]
    ds.extra["splits"] = [s for s in splits if not s.empty]
    # 快照：取最新一份
    for sid, attr in [("twse_attention_accum", None), ("tpex_attention_accum", None)]:
        latest = store.latest(sid)
        if latest is not None:
            df = latest[1].copy()
            df["market"] = "twse" if sid.startswith("twse") else "tpex"
            ds.attention_accum = pd.concat([ds.attention_accum, df], ignore_index=True)
        _ = attr
    for sid in ("twse_exright_notice", "tpex_exright_notice"):
        latest = store.latest(sid)
        if latest is not None:
            ds.exright_notice = pd.concat([ds.exright_notice, latest[1]], ignore_index=True)
    comp = []
    for sid in ("twse_company", "tpex_company"):
        latest = store.latest(sid)
        if latest is not None:
            comp.append(latest[1])
    if comp:
        ds.company = pd.concat(comp, ignore_index=True).drop_duplicates(subset=["code"], keep="last")
    for df in (ds.quotes, ds.insti, ds.margin, ds.valuation):
        if not df.empty:
            df.drop_duplicates(subset=["date", "code"], keep="last", inplace=True)
    log.info("載入：quotes %d 列、%d 個交易日", len(ds.quotes), len(ds.dates))
    return ds


def industry_map(ds: Dataset) -> dict[str, str]:
    """代號 → 產業名稱（公司基本資料的產業代碼；缺漏時以月營收的產業別補；ETF 另計）。"""
    names = config.industries()
    out: dict[str, str] = {}
    if not ds.revenue.empty and "industry" in ds.revenue.columns:
        latest = ds.revenue.sort_values("ym").drop_duplicates("code", keep="last")
        out.update({c: str(i) for c, i in zip(latest["code"], latest["industry"], strict=True) if isinstance(i, str)})
    if not ds.company.empty:
        for code, ic in zip(ds.company["code"], ds.company["industry_code"], strict=True):
            key = str(ic).zfill(2) if str(ic).isdigit() else str(ic)
            if key in names:
                out[code] = names[key]
    etf_label = str(config.load("industries").get("etf_label", "ETF"))
    return {**out, **{c: etf_label for c in ds.quotes.get("code", pd.Series(dtype=str)).unique() if is_etf(c)}}


def pivot(df: pd.DataFrame, value: str, dates: list[str] | None = None) -> pd.DataFrame:
    """長表 → 寬表（index=date, columns=code）。"""
    if df.empty or value not in df.columns:
        return pd.DataFrame()
    wide = df.pivot_table(index="date", columns="code", values=value, aggfunc="last")
    if dates is not None:
        wide = wide.reindex(dates)
    return wide.astype("float64")


def shares_outstanding(ds: Dataset) -> dict[str, float]:
    out: dict[str, float] = {}
    if not ds.company.empty:
        out.update({c: float(s) for c, s in zip(ds.company["code"], ds.company["shares"], strict=True) if s == s})
    if not ds.quotes.empty and "shares" in ds.quotes.columns:
        last = ds.quotes.dropna(subset=["shares"]).sort_values("date").drop_duplicates("code", keep="last")
        out.update({c: float(s) for c, s in zip(last["code"], last["shares"], strict=True) if s and s == s})
    return out


def as_date(s: str) -> date:
    return date.fromisoformat(s)


__all__ = ["Dataset", "as_date", "industry_map", "load", "np", "pivot", "shares_outstanding"]
