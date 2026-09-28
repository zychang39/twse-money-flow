"""選配資料解析：央行貨幣總計數（M1B／M2）、公開資訊觀測站法人說明會。"""

from __future__ import annotations

import csv
import io
import re

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, strip_tags, to_num
from pipeline.sources.base import (
    FieldSpec,
    ParseError,
    ParseResult,
    cell,
    col,
    last_position,
    opt,
    resolve_fields,
)

# ------------------------------------------------------------------ 央行貨幣總計數（日平均，月資料 EF15M01.csv）
MONEY_COLS = ["ym", "m1b", "m1b_yoy", "m2", "m2_yoy"]


_HALF = str.maketrans("ＭＢ１２", "MB12")


def _col(header: list[str], key: str, kind: str) -> str:
    """欄名寫法不固定（「貨幣總計數 -Ｍ１Ｂ-原始值」全形、空白）：找出實際欄名；找不到時回傳標準名稱，由 resolve_fields 報錯。"""
    for h in header:
        norm = h.replace(" ", "").translate(_HALF)
        if f"-{key}-" in norm and norm.endswith(kind):
            return h
    return f"貨幣總計數-{key}-{kind}"


def parse_cbc_money(payload: bytes | str) -> ParseResult:
    """期間格式 2026M07；金額單位：新台幣百萬元；年增率 %。M1B、M2 的原始值與年增率皆為必要欄位。"""
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload.lstrip("\ufeff")
    rows = [r for r in csv.reader(io.StringIO(text)) if r]
    if not rows or rows[0][0].strip() != "期間":
        raise ParseError("央行貨幣總計數 CSV 格式不符（第一欄應為「期間」）")
    h = rows[0]
    mapping = {
        "ym": col("期間"),
        "m1b": col(_col(h, "M1B", "原始值")),
        "m1b_yoy": col(_col(h, "M1B", "年增率")),
        "m2": col(_col(h, "M2", "原始值")),
        "m2_yoy": col(_col(h, "M2", "年增率")),
    }
    pos = resolve_fields(h, mapping, source="央行貨幣總計數")
    width = last_position({k: v for k, v in pos.items() if k != "ym"})
    out = []
    for r in rows[1:]:
        m = re.fullmatch(r"(\d{4})M(\d{2})", str(cell(r, pos["ym"])).strip())
        if not m or len(r) <= width:
            continue
        out.append(
            {
                "ym": f"{m.group(1)}-{m.group(2)}",
                **{k: to_num(cell(r, pos[k])) for k in ("m1b", "m1b_yoy", "m2", "m2_yoy")},
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


_HEAD_ROW = re.compile(r"<tr[^>]*>\s*(<th.*?)</tr>", re.S)
_TH = re.compile(r"<th([^>]*)>(.*?)</th>", re.S)
_COLSPAN = re.compile(r"colspan=['\"]?(\d+)")
_CONF_MAP: dict[str, FieldSpec] = {
    "code": "公司代號",
    "name": opt("公司名稱"),
    "date": col("召開法人說明會日期"),
    "time": opt("召開法人說明會時間"),
    "place": opt("召開法人說明會地點"),
    "text": opt("法人說明會擇要訊息"),
}


def _conf_header(text: str) -> list[str] | None:
    """第一列欄名（含「公司代號」）；colspan 展開成多格，讓位置與資料列對齊。"""
    for row in _HEAD_ROW.findall(text):
        names: list[str] = []
        for attrs, body in _TH.findall(row):
            span = _COLSPAN.search(attrs)
            names.extend([strip_tags(body).strip()] * (int(span.group(1)) if span else 1))
        if any("代號" in n for n in names):
            return names
    return None


def _squash(value: str | None, limit: int) -> str | None:
    return None if value is None else re.sub(r"\s+", " ", value)[:limit]


def parse_conference(html: bytes | str) -> ParseResult:
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    header = _conf_header(text)
    if header is None:
        if "查無" in text or "無資料" in text:
            return ParseResult(pd.DataFrame(columns=CONF_COLS), no_data=True, message="查無法說會資料")
        raise ParseError("法說會：找不到資料表")
    pos = resolve_fields(header, _CONF_MAP, source="法人說明會")
    width = last_position(pos)
    out = []
    for row in _ROW.findall(text):
        cells = [strip_tags(c).strip() for c in _CELL.findall(row)]
        if len(cells) <= width:
            continue
        d = parse_date(cell(cells, pos["date"]))
        code = clean_code(cell(cells, pos["code"]))
        if not d or not code:
            continue
        out.append(
            {
                "date": d.isoformat(),
                "code": code,
                "name": cell(cells, pos["name"]),
                "time": cell(cells, pos["time"]),
                "place": _squash(cell(cells, pos["place"]), 60),
                "text": _squash(cell(cells, pos["text"]), 200),
            }
        )
    df = pd.DataFrame(out, columns=CONF_COLS).drop_duplicates(["date", "code", "time"])
    return ParseResult(df.sort_values(["date", "code"]).reset_index(drop=True))
