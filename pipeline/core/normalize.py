"""正規化工具：數值轉型、千分位、空值符號、HTML 標籤、證券代號。"""

from __future__ import annotations

import html
import math
import re
from collections.abc import Iterable, Sequence
from typing import Any

import pandas as pd

NULL_TOKENS = {"", "-", "--", "---", "----", "-----", "N/A", "NA", "n/a", "X", "x", "null", "None", "nan", "除權息"}
_TAG = re.compile(r"<[^>]+>")
_NUM_CLEAN = re.compile(r"[,\s%＋]")
_CODE = re.compile(r"^(?:\d{4}|\d{4}[A-Z]|00[0-9A-Z]{2,4})$")


def strip_tags(text: object) -> str:
    if text is None:
        return ""
    return html.unescape(_TAG.sub("", str(text))).replace("　", " ").strip()


def to_num(value: Any) -> float | None:
    """'1,234.5' → 1234.5；'--'、'N/A'、'' → None；'-0.28' 保留負號；'12.3%' → 12.3。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, int | float):
        return None if isinstance(value, float) and math.isnan(value) else float(value)
    text = strip_tags(value)
    if text in NULL_TOKENS:
        return None
    text = _NUM_CLEAN.sub("", text).replace("−", "-")
    if text in NULL_TOKENS:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def num_series(values: Iterable[Any]) -> pd.Series:
    return pd.Series([to_num(v) for v in values], dtype="float64")


def clean_code(value: object) -> str:
    return strip_tags(value).replace(" ", "").upper()


def clean_name(value: object) -> str:
    return re.sub(r"\s+", "", strip_tags(value))


def is_security_code(code: str) -> bool:
    """股票（4 碼）、特別股（4 碼 + 英文）、ETF（00 開頭 4–6 碼）；排除權證、可轉債（5 碼數字）、ETN 等。"""
    return bool(_CODE.match(code))


def is_common_stock(code: str) -> bool:
    """普通股：4 碼純數字且不以 0 開頭（ETF 以 00 開頭）。"""
    return len(code) == 4 and code.isdigit() and not code.startswith("0")


def is_etf(code: str) -> bool:
    return code.startswith("00") and 4 <= len(code) <= 6


def sign_from_html(text: object) -> int:
    """MI_INDEX 的漲跌欄：<p style= color:red>+</p> → 1、- → -1、X 或空白 → 0。"""
    t = strip_tags(text)
    if t == "+":
        return 1
    if t == "-":
        return -1
    return 0


def rows_to_frame(rows: Sequence[Sequence[Any]], columns: Sequence[str]) -> pd.DataFrame:
    """把 list-of-list 依欄位位置對應成 DataFrame（多出的欄位忽略、不足的補 None）。"""
    width = len(columns)
    fixed = [list(r[:width]) + [None] * (width - len(r)) for r in rows]
    return pd.DataFrame(fixed, columns=list(columns), dtype=object)


def coerce_numeric(df: pd.DataFrame, cols: Iterable[str]) -> pd.DataFrame:
    for col in cols:
        if col in df.columns:
            df[col] = num_series(df[col].tolist()).values
    return df
