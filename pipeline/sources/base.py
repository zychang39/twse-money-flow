"""資料源解析的共用結構。"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Collection, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, clean_name, rows_to_frame, to_num

log = logging.getLogger(__name__)


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


_FULLWIDTH_PUNCT = str.maketrans({"（": "(", "）": ")", "％": "%", "／": "/", "：": ":"})


def norm_field(name: str) -> str:
    """欄名正規化：去空白與 <br>、全形括號／百分號／斜線轉半形（「殖利率（％）」＝「殖利率(%)」）。"""
    return re.sub(r"\s+|<br>|　", "", str(name)).translate(_FULLWIDTH_PUNCT)


# ------------------------------------------------------------------ 格式變動警告
# 解析時遇到「欄名改用別名」「選用欄位缺少」「欄位多出或順序改變但仍可解析」時記錄警告，
# 由 tasks 寫入 manifest（sources.{id}.format_warnings），資料健康頁以「相容模式」呈現。
_WARNINGS: ContextVar[list[str] | None] = ContextVar("format_warnings", default=None)
_PENDING: list[str] = []  # 沒有 collect_format_warnings 時的暫存，由 RunContext.note 取走


def warn_format(message: str) -> None:
    """記錄一則格式變動警告（去重）。"""
    log.warning("格式變動：%s", message)
    bucket = _WARNINGS.get()
    if bucket is None:
        bucket = _PENDING
    if message not in bucket:
        bucket.append(message)


def drain_format_warnings() -> list[str]:
    """取走目前累積的格式變動警告（任務每記錄一次來源狀態就取走一次）。"""
    out = list(_PENDING)
    _PENDING.clear()
    return out


@contextmanager
def collect_format_warnings() -> Iterator[list[str]]:
    """收集 with 區塊內所有解析器發出的格式變動警告。"""
    bucket: list[str] = []
    token = _WARNINGS.set(bucket)
    try:
        yield bucket
    finally:
        _WARNINGS.reset(token)


@dataclass(frozen=True)
class Col:
    """欄位規格：names 為主名稱＋別名（依序比對）；required=False 表示缺少時以空值補上並記錄警告。"""

    names: tuple[str, ...]
    required: bool = True


def col(*names: str, required: bool = True) -> Col:
    return Col(tuple(names), required)


def opt(*names: str) -> Col:
    """選用欄位：來源拿掉這個欄位時仍繼續解析。"""
    return Col(tuple(names), required=False)


# 沒有特別標示時，一律必要的標準欄位（其餘欄位缺少時以空值補上＋警告；
# 關鍵數值欄位另由 registry 的 Spec.numeric 在驗證階段把關）
ALWAYS_REQUIRED = frozenset({"code"})

FieldSpec = str | int | tuple[str, ...] | Col


def resolve_fields(
    fields: Sequence[str],
    mapping: Mapping[str, FieldSpec],
    *,
    required: Collection[str] | None = None,
    source: str = "",
) -> dict[str, int | None]:
    """把 {標準欄位: 規格} 對應到實際欄位位置；找不到的選用欄位為 None。

    - 字串／tuple：主名稱與別名；是否必要依 required（未指定時只有 ALWAYS_REQUIRED 必要）。
    - Col：自帶 required 設定（優先於 required 參數）。
    - int：固定位置（呼叫端應先以 expect_fields 確認版面）。
    必要欄位找不到時丟 ParseError；用到別名或缺少選用欄位時記錄格式變動警告。
    """
    normalized = [norm_field(f) for f in fields]
    must = ALWAYS_REQUIRED | set(required or ())
    tag = f"{source}：" if source else ""
    positions: dict[str, int | None] = {}
    for target, spec in mapping.items():
        if isinstance(spec, int):
            positions[target] = spec
            continue
        if isinstance(spec, Col):
            names, is_required = spec.names, spec.required
        else:
            names = (spec,) if isinstance(spec, str) else tuple(spec)
            is_required = target in must
        hit = next((i for i, n in enumerate(names) if norm_field(n) in normalized), None)
        if hit is None:
            if is_required:
                raise ParseError(f"{tag}找不到必要欄位「{names[0]}」；實際欄位：{list(fields)}")
            warn_format(f"{tag}缺少欄位「{names[0]}」，已略過（以空值處理）")
            positions[target] = None
            continue
        if hit > 0:
            warn_format(f"{tag}欄位「{names[0]}」改名為「{names[hit]}」，已自動對應")
        positions[target] = normalized.index(norm_field(names[hit]))
    return positions


def frame_from_fields(
    fields: Sequence[str],
    rows: Sequence[Sequence[Any]],
    mapping: Mapping[str, FieldSpec],
    *,
    required: Collection[str] | None = None,
    source: str = "",
) -> pd.DataFrame:
    """依欄位名稱（或位置）把原始表轉成標準欄位。

    策略（所有解析器共用）：欄名可有別名；必要欄位找不到才整批失敗（ParseError），
    其他欄位找不到時以空值補上並記錄「格式變動警告」，能解析的就繼續解析。
    """
    positions = resolve_fields(fields, mapping, required=required, source=source)
    found = [i for i in positions.values() if i is not None]
    width = max(found) + 1 if found else 0
    base = rows_to_frame(rows, [f"c{i}" for i in range(max(width, 1))])
    return pd.DataFrame(
        {
            t: (base[f"c{i}"] if i is not None else pd.Series([None] * len(base), index=base.index, dtype=object))
            for t, i in positions.items()
        }
    )


def cell(row: Sequence[Any], pos: int | None) -> Any:
    """依 resolve_fields 的位置取值；選用欄位缺少（None）或該列欄數不足時回傳 None。"""
    return row[pos] if pos is not None and pos < len(row) else None


def last_position(positions: Mapping[str, int | None]) -> int:
    """resolve_fields 結果中最右邊的欄位位置（用來略過欄數不足的列）；全部缺少時為 -1。"""
    return max((p for p in positions.values() if p is not None), default=-1)


def frame_from_records(
    records: Any,
    mapping: Mapping[str, FieldSpec],
    *,
    required: Collection[str] | None = None,
    source: str = "",
    infer_types: bool = True,
) -> pd.DataFrame:
    """list-of-dict（OpenAPI 風格）→ 標準欄位；欄名取所有紀錄 key 的聯集（依首次出現順序），交給 frame_from_fields。

    - records 不是 list、或元素不是 dict：丟 ParseError。
    - 空 list：回傳只有標準欄位的空表（無法檢查欄位）。
    - infer_types=True：依欄重新推斷型別（與 pd.DataFrame(list-of-dict) 相同，字串欄為 str、None 轉 NaN）；
      False：保留原始值（object 型別，None 不變），適合之後逐列處理的解析器。
    """
    tag = f"{source}：" if source else ""
    if not isinstance(records, list):
        raise ParseError(f"{tag}回應應為 list，實際為 {type(records).__name__}")
    if not records:
        return pd.DataFrame(columns=list(mapping))
    fields: dict[str, None] = {}
    for r in records:
        if not isinstance(r, dict):
            raise ParseError(f"{tag}清單元素應為 dict，實際為 {type(r).__name__}")
        fields.update(dict.fromkeys(r))
    names = list(fields)
    rows = [[r.get(k) for k in names] for r in records]
    df = frame_from_fields(names, rows, mapping, required=required, source=source)
    if not infer_types:
        return df
    return pd.DataFrame({t: df[t].tolist() for t in df.columns}, columns=list(df.columns))


def expect_fields(
    fields: Sequence[str], expected: Sequence[str], *, prefix_only: bool = True, source: str = ""
) -> None:
    """以位置解析的表格（欄名重複，例如多組「買進／賣出」）先確認版面。

    - 完全相同：通過。
    - 只在最後多出欄位：通過並記錄警告（既有位置不受影響）。
    - 欄數相同、只有欄名的全形／半形或空白差異：norm_field 已處理，視為相同。
    - 其他（欄位插入、刪除、順序改變）：位置已不可靠，丟 ParseError。
    """
    got = [norm_field(f) for f in fields]
    exp = [norm_field(f) for f in expected]
    tag = f"{source}：" if source else ""
    if got[: len(exp)] == exp:
        if not prefix_only and len(got) > len(exp):
            warn_format(f"{tag}表格最後多出欄位 {list(fields)[len(exp) :]}，已略過")
        return
    raise ParseError(f"{tag}欄位與預期不符（以位置解析，無法相容）：{list(fields)}")


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
