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
