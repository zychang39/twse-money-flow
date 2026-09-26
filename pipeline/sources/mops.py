"""公開資訊觀測站（MOPS）月營收彙總表解析（Big5 HTML）。"""

from __future__ import annotations

import re
from itertools import pairwise

import pandas as pd

from pipeline.core.normalize import clean_code, clean_name, strip_tags, to_num
from pipeline.sources.base import ParseError, ParseResult
from pipeline.sources.twse import REVENUE_COLS

_TITLE = re.compile(r"(上市|上櫃)公司\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月份")
_SECTION = re.compile(r"產業別：([^<（(]+)")
_ROW = re.compile(r"<tr\s+align=right>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)


def decode(payload: bytes | str) -> str:
    if isinstance(payload, str):
        return payload
    return payload.decode("cp950", errors="replace")


def parse_revenue_html(payload: bytes | str) -> ParseResult:
    text = decode(payload)
    m = _TITLE.search(text)
    if not m:
        raise ParseError("MOPS 月營收：找不到標題（上市/上櫃公司 X 年 X 月份）")
    market = "twse" if m.group(1) == "上市" else "tpex"
    ym = f"{int(m.group(2)) + 1911:04d}-{int(m.group(3)):02d}"
    rows = []
    # 以「產業別：」切段，逐段解析資料列
    positions = [(s.start(), s.group(1).strip()) for s in _SECTION.finditer(text)]
    positions.append((len(text), ""))
    for (start, industry), (end, _) in pairwise(positions):
        chunk = text[start:end]
        for row in _ROW.finditer(chunk):
            cells = [strip_tags(c) for c in _CELL.findall(row.group(1))]
            if len(cells) < 10 or not cells[0] or "合計" in cells[0]:
                continue
            code = clean_code(cells[0])
            if not code or not code[0].isalnum():
                continue
            rows.append(
                {
                    "ym": ym,
                    "code": code,
                    "name": clean_name(cells[1]),
                    "market": market,
                    "industry": industry,
                    "revenue": to_num(cells[2]),
                    "revenue_prev_month": to_num(cells[3]),
                    "revenue_last_year": to_num(cells[4]),
                    "mom": to_num(cells[5]),
                    "yoy": to_num(cells[6]),
                    "cum_revenue": to_num(cells[7]),
                    "cum_last_year": to_num(cells[8]),
                    "cum_yoy": to_num(cells[9]),
                    "note": cells[10] if len(cells) > 10 else "",
                    "report_date": None,
                }
            )
    df = pd.DataFrame(rows, columns=REVENUE_COLS)
    return ParseResult(df.drop_duplicates(subset=["code"]).reset_index(drop=True))
