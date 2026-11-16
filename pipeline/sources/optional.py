"""選配資料解析：央行貨幣總計數（M1B／M2）、公開資訊觀測站法人說明會、董監事持股餘額與設質。"""

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
    frame_from_records,
    last_position,
    load_json,
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


# ------------------------------------------------------------------ 董監事持股餘額與設質（每月；生意體質「賺的錢去哪」）
# 上市 openapi.twse.com.tw t187ap11_L、上櫃 tpex mopsfin_t187ap11_O（2026-11-16 Actions 實測；欄位相同，
# 上市的「選任時持股 」欄名尾端多一個空白——那一欄用不到）。一列＝一位內部人（董事、監察人、經理人、大股東…）。
DIRECTOR_COLS = ["ym", "code", "name", "directors", "shares", "pledged", "pledge_pct"]
_DIRECTOR_FIELDS: dict[str, FieldSpec] = {
    "ym": col("資料年月"),
    "code": "公司代號",
    "name": opt("公司名稱"),
    "role": col("職稱"),
    "holder": col("姓名"),
    "shares": col("目前持股"),
    "pledged": col("設質股數"),
}
_DIRECTOR_ROLES = ("董事", "監察人")


def parse_directors(payload: bytes | str | list[dict[str, object]]) -> ParseResult:
    """每家公司一列：董事與監察人（含獨立董事、法人代表人）的持股合計、設質股數合計、設質比例（%）。

    經理人與大股東不計入；同一個人掛兩個職稱（例：董事兼總經理）只算一次（取持股較多的那一列）。
    資料年月為民國年月（11510＝2026-10）。
    """
    rows = load_json(payload)
    if not isinstance(rows, list):
        raise ParseError("董監持股：回應不是 JSON 陣列")
    if not rows:
        return ParseResult(pd.DataFrame(columns=DIRECTOR_COLS), no_data=True)
    raw = frame_from_records(rows, _DIRECTOR_FIELDS, source="董監持股餘額", infer_types=False)
    raw = raw[raw["role"].astype(str).str.contains("|".join(_DIRECTOR_ROLES), na=False)].copy()
    raw["code"] = raw["code"].map(clean_code)
    raw = raw[raw["code"].astype(bool)]
    for c in ("shares", "pledged"):
        raw[c] = raw[c].map(to_num).fillna(0.0)
    raw = raw.sort_values("shares", ascending=False).drop_duplicates(["code", "holder"], keep="first")
    out = []
    for code, part in raw.groupby("code", sort=True):
        ym = str(part["ym"].iloc[0]).strip()
        if not ym.isdigit() or len(ym) < 5:
            raise ParseError(f"董監持股：資料年月格式不符（{ym!r}）")
        shares, pledged = float(part["shares"].sum()), float(part["pledged"].sum())
        out.append(
            {
                "ym": f"{int(ym[:-2]) + 1911}-{ym[-2:]}",
                "code": code,
                "name": strip_tags(str(part["name"].iloc[0] or "")),
                "directors": len(part),
                "shares": shares,
                "pledged": pledged,
                "pledge_pct": round(pledged / shares * 100, 2) if shares > 0 else None,
            }
        )
    return ParseResult(pd.DataFrame(out, columns=DIRECTOR_COLS))
