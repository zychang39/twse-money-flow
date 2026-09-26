"""資料驗證：回應日期、筆數合理、無重複、關鍵欄位可解析。驗證失敗時不覆蓋上一份好資料。"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date

import pandas as pd


@dataclass
class ValidationResult:
    ok: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def fail(self, msg: str) -> None:
        self.ok = False
        self.errors.append(msg)

    def summary(self) -> str:
        return "; ".join(self.errors + self.warnings) or "ok"


def validate_frame(
    df: pd.DataFrame,
    *,
    request_date: date | None = None,
    response_date: date | None = None,
    key_cols: Sequence[str] = ("code",),
    numeric_cols: Sequence[str] = (),
    prev_rows: int | None = None,
    tolerance: float = 0.25,
    min_parse_ratio: float = 0.9,
    min_rows: int = 1,
) -> ValidationResult:
    res = ValidationResult()
    if request_date is not None and response_date is not None and request_date != response_date:
        res.fail(f"回應日期 {response_date} ≠ 請求日期 {request_date}")
    n = len(df)
    if n < min_rows:
        res.fail(f"筆數 {n} 少於下限 {min_rows}")
    if prev_rows and n and abs(n - prev_rows) / prev_rows > tolerance:
        res.fail(f"筆數 {n} 與前一份 {prev_rows} 差距超過 {tolerance:.0%}")
    keys = [c for c in key_cols if c in df.columns]
    if keys and n:
        dup = int(df.duplicated(subset=keys).sum())
        if dup:
            res.fail(f"重複 {dup} 筆（鍵：{','.join(keys)}）")
    for col in numeric_cols:
        if col not in df.columns:
            res.fail(f"缺少欄位 {col}")
            continue
        if n == 0:
            continue
        ratio = float(pd.to_numeric(df[col], errors="coerce").notna().mean())
        if ratio < min_parse_ratio:
            res.fail(f"欄位 {col} 可解析比例 {ratio:.0%} 低於 {min_parse_ratio:.0%}")
    return res
