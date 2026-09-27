"""資料源註冊表：每個來源的抓取方式、解析函式、儲存粒度與驗證規則。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from pipeline.core import config
from pipeline.core.dates import roc_year, slash, ymd
from pipeline.sources import advanced, mops, tpex, twse
from pipeline.sources.base import ParseResult

Granularity = Literal["daily", "monthly", "yearly", "snapshot"]
Kind = Literal["daily", "range", "month_query", "snapshot", "yearly"]


@dataclass(frozen=True)
class Spec:
    id: str
    kind: Kind
    parse: Callable[[bytes], ParseResult]
    granularity: Granularity
    keys: tuple[str, ...] = ("code",)
    date_col: str = "date"
    numeric: tuple[str, ...] = ()
    min_rows: int = 1
    tier: str = "core"
    extras: tuple[str, ...] = ()
    extras_keys: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def cfg(self) -> dict[str, Any]:
        return config.source(self.id)


def build_url(
    source_id: str, d: date | None = None, start: date | None = None, end: date | None = None, **extra: str
) -> str:
    template = str(config.source(source_id)["url"])
    values: dict[str, str] = dict(extra)
    if d is not None:
        values.update(date=ymd(d), date_slash=slash(d), roc_year=str(roc_year(d)), month=str(d.month), year=str(d.year))
    if start is not None:
        values.update(start=ymd(start), start_slash=slash(start))
    if end is not None:
        values.update(end=ymd(end), end_slash=slash(end))
    return template.format(**values)


def _rev_twse(p: bytes) -> ParseResult:
    return twse.parse_revenue_openapi(p, "twse")


def _rev_tpex(p: bytes) -> ParseResult:
    return twse.parse_revenue_openapi(p, "tpex")


SPECS: dict[str, Spec] = {
    s.id: s
    for s in [
        # ---- 每日（一個交易日一個請求，依日期存檔）
        Spec(
            "twse_quotes",
            "daily",
            twse.parse_quotes,
            "daily",
            numeric=("close", "volume"),
            min_rows=800,
            extras=("twse_index",),
            extras_keys={"twse_index": ("name",)},
        ),
        Spec("twse_insti", "daily", twse.parse_insti, "daily", numeric=("foreign_net", "total_net"), min_rows=500),
        Spec(
            "twse_margin",
            "daily",
            twse.parse_margin,
            "daily",
            numeric=("margin_balance", "short_balance"),
            min_rows=500,
            extras=("twse_margin_total",),
            extras_keys={"twse_margin_total": ("item",)},
        ),
        Spec("twse_valuation", "daily", twse.parse_valuation, "daily", numeric=("pb",), min_rows=500),
        Spec("tpex_quotes", "daily", tpex.parse_quotes, "daily", numeric=("close", "volume"), min_rows=500),
        Spec("tpex_insti", "daily", tpex.parse_insti, "daily", numeric=("foreign_net", "total_net"), min_rows=300),
        Spec(
            "tpex_margin",
            "daily",
            tpex.parse_margin,
            "daily",
            numeric=("margin_balance", "short_balance"),
            min_rows=300,
            extras=("tpex_margin_total",),
            extras_keys={"tpex_margin_total": ("item",)},
        ),
        Spec("tpex_valuation", "daily", tpex.parse_valuation, "daily", numeric=("pb",), min_rows=300),
        # ---- 進階：每日
        Spec(
            "twse_sbl",
            "daily",
            advanced.parse_twse_sbl,
            "daily",
            numeric=("sbl_balance",),
            min_rows=500,
            tier="advanced",
        ),
        Spec(
            "tpex_sbl",
            "daily",
            advanced.parse_tpex_sbl,
            "daily",
            numeric=("sbl_balance",),
            min_rows=300,
            tier="advanced",
        ),
        Spec(
            "twse_qfii",
            "daily",
            advanced.parse_twse_qfii,
            "daily",
            numeric=("foreign_pct",),
            min_rows=500,
            tier="advanced",
        ),
        Spec(
            "tpex_qfii",
            "daily",
            advanced.parse_tpex_qfii,
            "daily",
            numeric=("foreign_pct",),
            min_rows=300,
            tier="advanced",
        ),
        Spec(
            "twse_daytrade",
            "daily",
            advanced.parse_twse_daytrade,
            "daily",
            numeric=("dt_volume",),
            min_rows=300,
            tier="advanced",
            extras=("twse_daytrade_total",),
        ),
        Spec(
            "tpex_daytrade",
            "daily",
            advanced.parse_tpex_daytrade,
            "daily",
            numeric=("dt_volume",),
            min_rows=200,
            tier="advanced",
            extras=("tpex_daytrade_total",),
        ),
        # ---- 區間查詢（事件型，依月份存檔）
        Spec("twse_exright", "range", twse.parse_exright, "monthly", keys=("date", "code"), min_rows=0),
        Spec("tpex_exright", "range", tpex.parse_exright, "monthly", keys=("date", "code"), min_rows=0),
        Spec("twse_capreduce", "range", twse.parse_capreduce, "monthly", keys=("date", "code"), min_rows=0),
        Spec("tpex_capreduce", "range", tpex.parse_capreduce, "monthly", keys=("date", "code"), min_rows=0),
        Spec("twse_attention", "range", twse.parse_attention, "monthly", keys=("date", "code"), min_rows=0),
        Spec("tpex_attention", "range", tpex.parse_attention, "monthly", keys=("date", "code"), min_rows=0),
        Spec(
            "twse_disposition",
            "range",
            twse.parse_disposition,
            "monthly",
            keys=("announce_date", "code", "start"),
            date_col="announce_date",
            min_rows=0,
        ),
        Spec(
            "tpex_disposition",
            "range",
            tpex.parse_disposition,
            "monthly",
            keys=("announce_date", "code", "start"),
            date_col="announce_date",
            min_rows=0,
        ),
        Spec("twse_parchange", "range", twse.parse_parchange, "monthly", keys=("date", "code"), min_rows=0),
        Spec("twse_etfsplit", "range", twse.parse_etf_split, "monthly", keys=("date", "code"), min_rows=0),
        Spec("tpex_etfsplit", "range", tpex.parse_etf_split, "monthly", keys=("date", "code"), min_rows=0),
        Spec("tpex_etfrevsplit", "range", tpex.parse_etf_split, "monthly", keys=("date", "code"), min_rows=0),
        # ---- 月查詢
        Spec("tpex_index", "month_query", tpex.parse_index, "monthly", keys=("date", "name"), min_rows=0),
        # ---- 快照（只提供最新，內容變動才存）
        Spec("twse_attention_accum", "snapshot", twse.parse_attention_accum, "snapshot", min_rows=0),
        Spec("tpex_attention_accum", "snapshot", tpex.parse_attention_accum, "snapshot", min_rows=0),
        Spec(
            "twse_exright_notice", "snapshot", twse.parse_exright_notice, "snapshot", keys=("date", "code"), min_rows=0
        ),
        Spec(
            "tpex_exright_notice", "snapshot", tpex.parse_exright_notice, "snapshot", keys=("date", "code"), min_rows=0
        ),
        Spec("twse_company", "snapshot", twse.parse_company, "snapshot", min_rows=500),
        Spec("tpex_company", "snapshot", tpex.parse_company, "snapshot", min_rows=300),
        Spec("twse_revenue", "snapshot", _rev_twse, "snapshot", keys=("code", "ym"), min_rows=0),
        Spec("tpex_revenue", "snapshot", _rev_tpex, "snapshot", keys=("code", "ym"), min_rows=0),
        Spec(
            "twse_short_halt",
            "snapshot",
            advanced.parse_twse_short_halt,
            "snapshot",
            keys=("code", "last_cover_date"),
            min_rows=0,
            tier="advanced",
        ),
        Spec(
            "tpex_short_halt",
            "snapshot",
            advanced.parse_tpex_short_halt,
            "snapshot",
            keys=("code", "last_cover_date"),
            min_rows=0,
            tier="advanced",
        ),
        Spec(
            "twse_insider",
            "snapshot",
            advanced.parse_insider,
            "snapshot",
            keys=("code", "holder", "start"),
            min_rows=0,
            tier="optional",
        ),
        Spec(
            "tpex_insider",
            "snapshot",
            advanced.parse_insider,
            "snapshot",
            keys=("code", "holder", "start"),
            min_rows=0,
            tier="optional",
        ),
        # ---- 年度
        Spec("twse_holidays", "yearly", twse.parse_holidays, "yearly", keys=("date",), min_rows=5),
    ]
}

CORE_DAILY = [
    "twse_quotes",
    "twse_insti",
    "twse_margin",
    "twse_valuation",
    "tpex_quotes",
    "tpex_insti",
    "tpex_margin",
    "tpex_valuation",
]
CORE_RANGE = [
    "twse_parchange",
    "twse_etfsplit",
    "tpex_etfsplit",
    "tpex_etfrevsplit",
    "twse_exright",
    "tpex_exright",
    "twse_capreduce",
    "tpex_capreduce",
    "twse_attention",
    "tpex_attention",
    "twse_disposition",
    "tpex_disposition",
]
CORE_SNAPSHOT = [
    "twse_attention_accum",
    "tpex_attention_accum",
    "twse_exright_notice",
    "tpex_exright_notice",
    "twse_company",
    "tpex_company",
    "twse_revenue",
    "tpex_revenue",
]
ADVANCED_DAILY = ["twse_sbl", "tpex_sbl", "twse_qfii", "tpex_qfii", "twse_daytrade", "tpex_daytrade"]
ADVANCED_SNAPSHOT = ["twse_short_halt", "tpex_short_halt", "twse_insider", "tpex_insider"]
BACKFILL_DEFAULT = [
    "twse_quotes",
    "tpex_quotes",
    "twse_insti",
    "tpex_insti",
    "twse_margin",
    "tpex_margin",
    "twse_valuation",
    "tpex_valuation",
]


# 回補未指定來源時的完整清單：區間／月查詢 → 期交所、美債、財報、央行 → 每日（核心 3 年、進階近一年）
CUSTOM_BACKFILL = ["taifex", "ust_10y", "financials", "cbc_money", "investor_conference", "active_etf"]
BACKFILL_FULL = [
    *CORE_RANGE,
    "tpex_index",
    "mops_revenue",
    "taifex",
    "ust_10y",
    "financials",
    "cbc_money",
    *BACKFILL_DEFAULT,
    *ADVANCED_DAILY,
]
ADVANCED_BACKFILL_DAYS = 400


def mops_revenue_url(market: str, ym: date) -> str:
    return build_url("mops_revenue", ym, mops_market="sii" if market == "twse" else "otc")


def parse_mops(payload: bytes) -> ParseResult:
    return mops.parse_revenue_html(payload)
