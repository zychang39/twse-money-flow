"""公開資訊觀測站（MOPS）月營收彙總表解析（Big5 HTML）。"""

from __future__ import annotations

import re
from itertools import pairwise
from typing import Any

import pandas as pd

from pipeline.core.normalize import clean_code, clean_name, strip_tags, to_num
from pipeline.sources.base import ParseError, ParseResult, cell, col, norm_field, opt, resolve_fields
from pipeline.sources.twse import REVENUE_COLS

_TITLE = re.compile(r"(上市|上櫃)公司\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月份")
_SECTION = re.compile(r"產業別：([^<（(]+)")
_ROW = re.compile(r"<tr\s+align=right>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TH_ROW = re.compile(r"<tr[^>]*>\s*(<th.*?)</tr>", re.S | re.I)
_TH = re.compile(r"<th[^>]*>(.*?)</th>", re.S | re.I)

# 表頭兩列：第一列為群組（營業收入／累計營業收入）與跨兩列的「備註」，第二列為各欄名稱。
# 資料列依第二列的欄位順序排列，「備註」接在最後。
_REVENUE_MAP: dict[str, Any] = {
    "code": "公司代號",
    "name": opt("公司名稱"),
    "revenue": col("當月營收"),
    "revenue_prev_month": opt("上月營收"),
    "revenue_last_year": opt("去年當月營收"),
    "mom": opt("上月比較增減(%)"),
    "yoy": col("去年同月增減(%)"),
    "cum_revenue": opt("當月累計營收"),
    "cum_last_year": opt("去年累計營收"),
    "cum_yoy": opt("前期比較增減(%)"),
    "note": opt("備註"),
}
_NUMERIC = [k for k in _REVENUE_MAP if k not in ("code", "name", "note")]


def decode(payload: bytes | str) -> str:
    if isinstance(payload, str):
        return payload
    return payload.decode("cp950", errors="replace")


def _header(chunk: str) -> list[str] | None:
    """段落內的欄名列（含「公司代號」的那一列）；跨兩列的「備註」若在上一列，補在最後。"""
    above: list[str] = []
    for row in _TH_ROW.finditer(chunk):
        names = [strip_tags(c) for c in _TH.findall(row.group(1))]
        if any("代號" in norm_field(n) for n in names):
            extra = [n for n in above if norm_field(n) == "備註" and n not in names]
            return names + extra
        above = names
    return None


def parse_revenue_html(payload: bytes | str) -> ParseResult:
    """查無資料（當月尚未公布：標題仍在但沒有表格）→ no_data；表頭欄位缺少 → ParseError。"""
    text = decode(payload)
    m = _TITLE.search(text)
    if not m:
        raise ParseError("MOPS 月營收：找不到標題（上市/上櫃公司 X 年 X 月份）")
    market = "twse" if m.group(1) == "上市" else "tpex"
    ym = f"{int(m.group(2)) + 1911:04d}-{int(m.group(3)):02d}"
    rows = []
    resolved: dict[tuple[str, ...], tuple[dict[str, int | None], int]] = {}
    # 以「產業別：」切段，逐段解析資料列
    positions = [(s.start(), s.group(1).strip()) for s in _SECTION.finditer(text)]
    positions.append((len(text), ""))
    for (start, industry), (end, _) in pairwise(positions):
        chunk = text[start:end]
        data_rows = list(_ROW.finditer(chunk))
        if not data_rows:
            continue
        header = _header(chunk)
        if header is None:
            raise ParseError(f"MOPS 月營收：「{industry}」段落找不到表頭（公司代號…）")
        key = tuple(header)
        if key not in resolved:
            pos = resolve_fields(header, _REVENUE_MAP, source="MOPS 月營收")
            # 欄數下限：第二列表頭的欄數（備註可有可無），與舊版「至少 10 格」相同
            resolved[key] = (pos, len([h for h in header if norm_field(h) != "備註"]))
        pos, min_cells = resolved[key]
        for row in data_rows:
            cells = [strip_tags(c) for c in _CELL.findall(row.group(1))]
            first = cell(cells, pos["code"])
            if len(cells) < min_cells or not first or "合計" in first:
                continue
            code = clean_code(first)
            if not code or not code[0].isalnum():
                continue
            note = cell(cells, pos["note"])
            rows.append(
                {
                    "ym": ym,
                    "code": code,
                    "name": clean_name(cell(cells, pos["name"])),
                    "market": market,
                    "industry": industry,
                    **{k: to_num(cell(cells, pos[k])) for k in _NUMERIC},
                    "note": note if note is not None else "",
                    "report_date": None,
                }
            )
    df = pd.DataFrame(rows, columns=REVENUE_COLS)
    if df.empty and "查無資料" in text:
        return ParseResult(pd.DataFrame(columns=REVENUE_COLS), no_data=True, message="查無資料")
    return ParseResult(df.drop_duplicates(subset=["code"]).reset_index(drop=True))
