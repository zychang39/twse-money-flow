"""資料源解析的共用結構。"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, clean_name, rows_to_frame, to_num


class ParseError(ValueError):
    """回應格式與預期不符（欄位變更、非 JSON 等）。"""


@dataclass
class ParseResult:
    df: pd.DataFrame
    response_date: date | None = None
    no_data: bool = False
    message: str = ""
    extras: dict[str, pd.DataFrame] = field(default_factory=dict)


NO_DATA_MARKERS = ("沒有符合條件", "查無資料", "無資料", "No data")


def load_json(payload: bytes | str | Any) -> Any:
    if isinstance(payload, bytes | str):
        text = payload.decode("utf-8-sig") if isinstance(payload, bytes) else payload
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ParseError(f"不是 JSON：{text[:80]!r}") from exc
    return payload


def is_no_data(obj: Any) -> bool:
    if isinstance(obj, dict):
        stat = str(obj.get("stat", ""))
        if stat and stat.upper() != "OK":
            return True
        if any(m in stat for m in NO_DATA_MARKERS):
            return True
    return False


def norm_field(name: str) -> str:
    return re.sub(r"\s+|<br>|　", "", str(name))


def frame_from_fields(
    fields: Sequence[str],
    rows: Sequence[Sequence[Any]],
    mapping: Mapping[str, str | int],
) -> pd.DataFrame:
    """依欄位名稱（或位置）把原始表轉成標準欄位。

    mapping：{標準欄位: 原始欄名或位置}；欄名找不到時丟 ParseError（代表格式變更）。
    """
    normalized = [norm_field(f) for f in fields]
    positions: dict[str, int] = {}
    for target, src in mapping.items():
        if isinstance(src, int):
            positions[target] = src
            continue
        key = norm_field(src)
        if key not in normalized:
            raise ParseError(f"找不到欄位「{src}」；實際欄位：{fields}")
        positions[target] = normalized.index(key)
    width = max(positions.values()) + 1 if positions else 0
    base = rows_to_frame(rows, [f"c{i}" for i in range(max(width, 1))])
    return pd.DataFrame({t: base[f"c{i}"] for t, i in positions.items()})


def expect_fields(fields: Sequence[str], expected: Sequence[str], *, prefix_only: bool = True) -> None:
    got = [norm_field(f) for f in fields]
    exp = [norm_field(f) for f in expected]
    if (got[: len(exp)] if prefix_only else got) != exp:
        raise ParseError(f"欄位與預期不符：{fields}")


def finalize(
    df: pd.DataFrame,
    *,
    numeric: Sequence[str] = (),
    dates: Sequence[str] = (),
    code_col: str = "code",
    name_col: str | None = "name",
) -> pd.DataFrame:
    """統一清理：代號、名稱、數值、日期（西元 ISO）。"""
    df = df.copy()
    if code_col in df.columns:
        df[code_col] = [clean_code(v) for v in df[code_col]]
    if name_col and name_col in df.columns:
        df[name_col] = [clean_name(v) for v in df[name_col]]
    for col in numeric:
        if col in df.columns:
            df[col] = pd.Series([to_num(v) for v in df[col]], dtype="float64", index=df.index)
    for col in dates:
        if col in df.columns:
            parsed = [parse_date(v) for v in df[col]]
            df[col] = [d.isoformat() if d else None for d in parsed]
    return df


CN_DIGITS = {"零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_number(text: str) -> int | None:
    """中文數字（最多到九十九）：二→2、五→5、十→10、二十→20、二十五→25；阿拉伯數字直接轉。"""
    text = text.strip()
    if text.isdigit():
        return int(text)
    if not text:
        return None
    if "十" in text:
        left, _, right = text.partition("十")
        tens = CN_DIGITS.get(left, 1) if left else 1
        ones = CN_DIGITS.get(right, 0) if right else 0
        return tens * 10 + ones
    return CN_DIGITS.get(text)


_INTERVAL = re.compile(r"每\s*([0-9一二兩三四五六七八九十]+)\s*分鐘")
_FULLWIDTH = str.maketrans("０１２３４５６７８９", "0123456789")


def match_interval_minutes(text: str) -> int | None:
    """從處置內容解析分盤撮合間隔：「約每五分鐘撮合一次」→ 5。"""
    m = _INTERVAL.search(str(text).translate(_FULLWIDTH))
    return cn_number(m.group(1)) if m else None


def split_period(text: str) -> tuple[str | None, str | None]:
    """'115/08/24～115/08/28' 或 '115/09/24~115/10/06' → (ISO, ISO)。"""
    parts = re.split(r"[～~至]", str(text))
    if len(parts) < 2:
        return None, None
    a, b = parse_date(parts[0]), parse_date(parts[1])
    return (a.isoformat() if a else None, b.isoformat() if b else None)
