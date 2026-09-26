"""選配資料解析：央行貨幣總計數（M1B／M2）、公開資訊觀測站法人說明會。"""

from __future__ import annotations

import csv
import io
import re

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, strip_tags, to_num
from pipeline.sources.base import ParseError, ParseResult

# ------------------------------------------------------------------ 央行貨幣總計數（日平均，月資料 EF15M01.csv）
MONEY_COLS = ["ym", "m1b", "m1b_yoy", "m2", "m2_yoy"]


def _col(header: list[str], key: str, kind: str) -> int:
    for i, h in enumerate(header):
        norm = h.replace(" ", "").replace("Ｍ", "M").replace("１", "1").replace("２", "2").replace("Ｂ", "B")
        if f"-{key}-" in norm and norm.endswith(kind):
            return i
    raise ParseError(f"央行貨幣總計數 CSV 缺少 {key} {kind} 欄位")


def parse_cbc_money(payload: bytes | str) -> ParseResult:
    """期間格式 2026M07；金額單位：新台幣百萬元；年增率 %。"""
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload.lstrip("﻿")
    rows = [r for r in csv.reader(io.StringIO(text)) if r]
    if not rows or rows[0][0].strip() != "期間":
        raise ParseError("央行貨幣總計數 CSV 格式不符（第一欄應為「期間」）")
    h = rows[0]
    i_m1b, i_m1b_y = _col(h, "M1B", "原始值"), _col(h, "M1B", "年增率")
    i_m2, i_m2_y = _col(h, "M2", "原始值"), _col(h, "M2", "年增率")
    out = []
    for r in rows[1:]:
        m = re.fullmatch(r"(\d{4})M(\d{2})", r[0].strip())
        if not m or len(r) <= max(i_m1b_y, i_m2_y):
            continue
        out.append(
            {
                "ym": f"{m.group(1)}-{m.group(2)}",
                "m1b": to_num(r[i_m1b]),
                "m1b_yoy": to_num(r[i_m1b_y]),
                "m2": to_num(r[i_m2]),
                "m2_yoy": to_num(r[i_m2_y]),
            }
        )
    df = pd.DataFrame(out, columns=MONEY_COLS)
    if df.empty:
        raise ParseError("央行貨幣總計數 CSV 沒有資料列")
    return ParseResult(df.sort_values("ym").reset_index(drop=True))


# ------------------------------------------------------------------ 法人說明會（ajax_t100sb02_1）
CONF_COLS = ["date", "code", "name", "time", "place", "text"]
_ROW = re.compile(r"<tr class='(?:even|odd)'[^>]*>(.*?)</tr>", re.S)
_CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)


def parse_conference(html: bytes | str) -> ParseResult:
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    if "召開法人說明會日期" not in text:
        if "查無" in text or "無資料" in text:
            return ParseResult(pd.DataFrame(columns=CONF_COLS), no_data=True, message="查無法說會資料")
        raise ParseError("法說會：找不到資料表")
    out = []
    for row in _ROW.findall(text):
        cells = [strip_tags(c).strip() for c in _CELL.findall(row)]
        if len(cells) < 6:
            continue
        d = parse_date(cells[2])
        code = clean_code(cells[0])
        if not d or not code:
            continue
        out.append(
            {
                "date": d.isoformat(),
                "code": code,
                "name": cells[1],
                "time": cells[3],
                "place": re.sub(r"\s+", " ", cells[4])[:60],
                "text": re.sub(r"\s+", " ", cells[5])[:200],
            }
        )
    df = pd.DataFrame(out, columns=CONF_COLS).drop_duplicates(["date", "code", "time"])
    return ParseResult(df.sort_values(["date", "code"]).reset_index(drop=True))
