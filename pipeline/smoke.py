"""資料源冒煙測試：對每個已登錄的資料源抓一次、解析一次，檢查必要欄位是否存在。

用途：提早發現來源格式變動（欄位改名、刪除）。只讀、不寫 data 分支。
- 必要欄位＝該來源的鍵（Spec.keys）＋關鍵數值欄位（Spec.numeric）；解析結果缺少或全為空值即判定失敗。
- 解析器以「別名＋選用欄位」相容時，列為「相容模式」並列出格式變動警告（不算失敗）。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from pipeline.core.dates import month_start
from pipeline.core.http import FetchError, PoliteClient
from pipeline.registry import SPECS, Spec, build_url
from pipeline.sources.base import ParseError, collect_format_warnings


@dataclass
class SmokeResult:
    source: str
    status: str  # ok / compat / no_data / format_error / fetch_error
    rows: int = 0
    missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    message: str = ""

    @property
    def is_format_problem(self) -> bool:
        return self.status == "format_error"


def required_columns(spec: Spec) -> list[str]:
    cols = [*spec.keys, *spec.numeric]
    return list(dict.fromkeys(cols))


def check_frame(spec: Spec, df: pd.DataFrame) -> list[str]:
    """回傳缺少（或整欄都無法解析）的必要欄位。空表（無資料）不檢查內容，只檢查欄位存在。"""
    return [c for c in required_columns(spec) if c not in df.columns or (len(df) > 0 and df[c].isna().all())]


def url_for(spec: Spec, d: date) -> str:
    if spec.kind == "daily":
        return build_url(spec.id, d)
    if spec.kind == "range":
        return build_url(spec.id, start=d - timedelta(days=30), end=d)
    if spec.kind == "month_query":
        return build_url(spec.id, month_start(d))
    if spec.kind == "yearly":
        return build_url(spec.id, date(d.year, 1, 1))
    return build_url(spec.id)


def smoke_one(client: PoliteClient, spec: Spec, d: date) -> SmokeResult:
    try:
        raw = client.get_bytes(url_for(spec, d))
    except FetchError as exc:
        return SmokeResult(spec.id, "fetch_error", message=str(exc)[:200])
    with collect_format_warnings() as warnings:
        try:
            res = spec.parse(raw)
        except ParseError as exc:
            return SmokeResult(spec.id, "format_error", message=str(exc)[:300], warnings=list(warnings))
    missing = check_frame(spec, res.df)
    if missing:
        return SmokeResult(spec.id, "format_error", len(res.df), missing, list(warnings), "必要欄位缺少或無法解析")
    if res.no_data or res.df.empty:
        return SmokeResult(spec.id, "no_data", 0, [], list(warnings), res.message)
    status = "compat" if warnings else "ok"
    return SmokeResult(spec.id, status, len(res.df), [], list(warnings))


def run_smoke(client: PoliteClient, d: date, sources: Iterable[str] | None = None) -> list[SmokeResult]:
    ids = list(sources) if sources else sorted(SPECS)
    return [smoke_one(client, SPECS[sid], d) for sid in ids if sid in SPECS]


LABEL = {
    "ok": "✅ 正常",
    "compat": "⚠️ 相容模式",
    "no_data": "➖ 無資料",
    "format_error": "❌ 格式變動",
    "fetch_error": "❌ 連線失敗",
}


def to_markdown(results: list[SmokeResult], d: date) -> str:
    lines = [
        f"## 資料源必要欄位檢查（{d.isoformat()}）",
        "",
        "| 來源 | 狀態 | 筆數 | 缺少的必要欄位 | 說明 |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        note = "；".join([*r.warnings, r.message] if r.message else r.warnings).replace("|", "／")
        lines.append(f"| {r.source} | {LABEL[r.status]} | {r.rows} | {'、'.join(r.missing) or '—'} | {note[:200]} |")
    bad = [r.source for r in results if r.is_format_problem]
    lines += ["", f"格式變動（需要處理）：{'、'.join(bad) if bad else '無'}"]
    return "\n".join(lines) + "\n"


#: 主動式 ETF 各投信的冒煙測試代表檔（2026-10-09）：每家取一檔、查最新一份，檢查能取得持股
ETF_SMOKE = {
    "nomura": "00980A",
    "capital": "00982A",
    "yuanta": "00990A",
    "fubon": "00405A",
    "uni": "00981A",
    "ctbc": "00406A",
    "allianz": "00993A",
    "sinopac": "00410A",
    "taishin": "00986A",
    "jpmorgan": "00401A",
    "kgi": "00407A",
    "ab": "00404A",
    "fsitc": "00408A",
    "fhtrust": "00991A",
}


class _WeekdayCalendar:
    """冒煙測試沒有交易日曆：以週一到週五近似（只用在摩根的單位數公告日）。"""

    def trading_days(self, a: date, b: date) -> list[date]:
        return [a + timedelta(days=i) for i in range((b - a).days + 1) if (a + timedelta(days=i)).weekday() < 5]


def smoke_active_etf(client: PoliteClient, d: date) -> list[SmokeResult]:
    """每家已實作的投信抓一檔最新持股（流程與每日任務相同：基金清單、權杖、工作階段 cookie）。"""
    from types import SimpleNamespace

    from pipeline.core import config
    from pipeline.tasks_advanced import _EtfFetcher

    issuers = config.source("active_etf")["issuers"]
    ctx = SimpleNamespace(client=client, today=d, calendar=_WeekdayCalendar())
    fetcher = _EtfFetcher(ctx, issuers)  # type: ignore[arg-type]
    out = []
    for issuer, etf in ETF_SMOKE.items():
        if issuers.get(issuer, {}).get("status") != "verified":
            continue
        sid = f"active_etf.{issuer}"
        try:
            res = fetcher.fetch(issuer, etf, None)
        except FetchError as exc:
            out.append(SmokeResult(sid, "fetch_error", message=str(exc)[:200]))
            continue
        except ParseError as exc:
            out.append(SmokeResult(sid, "format_error", message=str(exc)[:300]))
            continue
        if res.df.empty:
            out.append(SmokeResult(sid, "no_data", message=res.message))
            continue
        units = res.df["units"].iloc[0] if "units" in res.df else None
        note = f"{etf} 持股日 {res.response_date}、單位數 {'有' if units == units and units else '無'}"
        out.append(SmokeResult(sid, "ok", len(res.df), message=note))
    return out
