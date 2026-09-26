"""進階資料任務：期交所（POST）、匯率、美債、集保（週）。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.core.dates import month_start, next_month, slash
from pipeline.core.http import FetchError
from pipeline.registry import build_url
from pipeline.sources import advanced
from pipeline.sources.base import ParseError, ParseResult
from pipeline.tasks import RunContext, _fetch


def _upsert_by_month(ctx: RunContext, source: str, df: pd.DataFrame, keys: list[str]) -> None:
    if df.empty:
        return
    for key, part in df.groupby(pd.to_datetime(df["date"]).dt.to_period("M")):
        ctx.store.upsert(source, key.to_timestamp().date(), part.reset_index(drop=True), keys)


def _post(ctx: RunContext, source: str, start: date, end: date, commodity: str | None = None) -> bytes:
    cfg = config.source(source)
    values = {"start_slash": slash(start), "end_slash": slash(end), "commodity": commodity or ""}
    form = {k: str(v).format(**values) for k, v in cfg["form"].items()}
    return _fetch(ctx, str(cfg["url"]), method="POST", form=form)


def run_taifex(ctx: RunContext, start: date, end: date) -> None:
    """三大法人期貨（TXF/MXF/TMF）、全市場未平倉（TX/MTX/TMF）、美元兌台幣；以月為單位查詢。"""
    jobs: list[tuple[str, Any, list[str]]] = [
        ("taifex_insti", advanced.parse_taifex_insti, ["date", "contract", "party"]),
        ("taifex_oi", advanced.parse_taifex_oi, ["date", "contract"]),
    ]
    m = month_start(start)
    while m <= end:
        a, b = max(m, start), min(next_month(m) - timedelta(days=1), end)
        for source, parse, keys in jobs:
            frames = []
            try:
                for commodity in config.source(source)["commodities"]:
                    res: ParseResult = parse(_post(ctx, source, a, b, commodity))
                    frames.append(res.df)
                df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
                _upsert_by_month(ctx, source, df, keys)
                ctx.note(source, "ok", data_date=b, rows=len(df))
            except (FetchError, ParseError) as exc:
                ctx.note(source, "failed", data_date=b, message=str(exc)[:300])
        try:
            fx = advanced.parse_fx(_post(ctx, "fx_usdtwd", a, b)).df
            _upsert_by_month(ctx, "fx_usdtwd", fx, ["date"])
            ctx.note("fx_usdtwd", "ok", data_date=b, rows=len(fx))
        except (FetchError, ParseError) as exc:
            ctx.note("fx_usdtwd", "failed", data_date=b, message=str(exc)[:300])
        m = next_month(m)


def run_ust(ctx: RunContext, year: int) -> None:
    try:
        raw = _fetch(ctx, build_url("ust_10y", date(year, 1, 1)))
        df = advanced.parse_treasury(raw).df
        ctx.store.upsert("ust_10y", date(year, 1, 1), df, ["date"])
        ctx.note(
            "ust_10y", "ok", data_date=date.fromisoformat(df["date"].max()) if not df.empty else None, rows=len(df)
        )
    except (FetchError, ParseError) as exc:
        ctx.note("ust_10y", "failed", message=str(exc)[:300])


def run_tdcc(ctx: RunContext) -> None:
    try:
        res = advanced.parse_tdcc(_fetch(ctx, build_url("tdcc_holders")))
    except (FetchError, ParseError) as exc:
        ctx.note("tdcc_holders", "failed", message=str(exc)[:300])
        return
    if res.no_data or res.response_date is None:
        ctx.note("tdcc_holders", "failed", message="集保資料為空")
        return
    if ctx.store.exists("tdcc_holders", res.response_date):
        ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df), message="本週已存在")
        return
    ctx.store.write("tdcc_holders", res.response_date, res.df)
    ctx.note("tdcc_holders", "ok", data_date=res.response_date, rows=len(res.df))


# ------------------------------------------------------------------ 選配：央行貨幣總計數、法說會
def run_cbc_money(ctx: RunContext) -> None:
    """央行 M1B／M2（日平均，月資料）：整份 CSV 以最新月份存成一份快照。"""
    from pipeline.sources import optional

    try:
        df = optional.parse_cbc_money(_fetch(ctx, str(config.source("cbc_money")["url"]))).df
    except (FetchError, ParseError) as exc:
        ctx.note("cbc_money", "failed", message=str(exc)[:300])
        return
    latest = df.dropna(subset=["m1b_yoy", "m2_yoy"]).iloc[-1]
    key = date(int(latest["ym"][:4]), int(latest["ym"][5:7]), 1)
    if ctx.store.exists("cbc_money", key):
        ctx.note("cbc_money", "ok", data_date=key, rows=len(df), message="本月已存在")
        return
    ctx.store.write("cbc_money", key, df)
    ctx.note("cbc_money", "ok", data_date=key, rows=len(df))


def run_conference(ctx: RunContext, month: date) -> None:
    """公開資訊觀測站法人說明會（上市＋上櫃），依召開月份存檔。"""
    from pipeline.sources import optional

    tmpl = str(config.source("investor_conference")["url"])
    frames = []
    try:
        for typek in ("sii", "otc"):
            url = tmpl.format(typek=typek, roc=month.year - 1911, month=f"{month.month:02d}")
            frames.append(optional.parse_conference(_fetch(ctx, url)).df)
    except (FetchError, ParseError) as exc:
        ctx.note("investor_conference", "failed", data_date=month, message=str(exc)[:300])
        return
    df = pd.concat(frames, ignore_index=True).drop_duplicates(["date", "code", "time"])
    if df.empty:
        ctx.note("investor_conference", "no_data", data_date=month, message="該月尚無法說會")
        return
    ctx.store.upsert("conference", month_start(month), df, ["date", "code", "time"])
    ctx.note("investor_conference", "ok", data_date=month, rows=len(df))
