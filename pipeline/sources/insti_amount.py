"""三大法人買賣金額（全市場合計，元）：證交所 BFI82U「三大法人買賣金額統計表」、櫃買「三大法人買賣金額彙總表」。

2026-10 改版：首頁三大法人改用交易所公布的實際金額，取代「個股買賣超股數 × 收盤價」估算。
統一成 item 代號：
- foreign：外資及陸資（不含外資自營商）
- foreign_dealer：外資自營商
- trust：投信
- dealer_self：自營商（自行買賣）
- dealer_hedge：自營商（避險）
- total：三大法人合計（證交所「合計」；櫃買「三大法人合計*」，外資自營商已含在自營商內、不重複計）
櫃買另有「外資及陸資合計」「自營商合計」兩列小計 → 不存（可由明細相加）。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import to_num
from pipeline.sources.base import ParseError, ParseResult, frame_from_fields, is_no_data, load_json

COLS = ["date", "item", "buy", "sell", "net"]

ITEMS = {
    "自營商(自行買賣)": "dealer_self",
    "自營商(避險)": "dealer_hedge",
    "投信": "trust",
    "外資及陸資(不含外資自營商)": "foreign",
    "外資及陸資(不含自營商)": "foreign",
    "外資自營商": "foreign_dealer",
    "合計": "total",
    "三大法人合計": "total",
}
REQUIRED_ITEMS = ("foreign", "trust", "dealer_self", "dealer_hedge")


def _item(name: Any) -> str | None:
    key = str(name or "").replace("　", "").replace(" ", "").replace("（", "(").replace("）", ")").rstrip("*")
    return ITEMS.get(key)


TWSE_FIELDS = {
    "name": "單位名稱",
    "buy": ("買進金額", "買進金額(元)"),
    "sell": ("賣出金額", "賣出金額(元)"),
    "net": ("買賣差額", "買賣超(元)"),
}
TPEX_FIELDS = {
    "name": "單位名稱",
    "buy": ("買進金額(元)", "買進金額"),
    "sell": ("賣出金額(元)", "賣出金額"),
    "net": ("買賣超(元)", "買賣差額"),
}


def _frame(
    fields: list[str], rows: list[list[Any]], d: str | None, source: str, mapping: dict[str, Any]
) -> pd.DataFrame:
    df = frame_from_fields(fields, rows, mapping, source=source)
    df["item"] = [_item(n) for n in df["name"]]
    df = df.dropna(subset=["item"]).copy()
    for c in ("buy", "sell", "net"):
        df[c] = pd.to_numeric(df[c].map(to_num), errors="coerce")
    df.insert(0, "date", d)
    df = df.drop_duplicates("item", keep="first")
    missing = [i for i in REQUIRED_ITEMS if i not in set(df["item"])]
    if missing:
        raise ParseError(f"{source}：缺少 {','.join(missing)}")
    return df[COLS].reset_index(drop=True)


def parse_twse(payload: bytes | str | dict[str, Any]) -> ParseResult:
    """證交所 BFI82U（rwd JSON：stat/date/fields/data）。"""
    obj = load_json(payload)
    if is_no_data(obj) or not obj.get("data"):
        return ParseResult(pd.DataFrame(columns=COLS), no_data=True, message=str(obj.get("stat")))
    d = parse_date(obj.get("date"))
    df = _frame(
        obj.get("fields") or [], obj["data"], d.isoformat() if d else None, "三大法人買賣金額統計表", TWSE_FIELDS
    )
    return ParseResult(df, response_date=d)


def parse_tpex(payload: bytes | str | dict[str, Any]) -> ParseResult:
    """櫃買 insti/summary（tables[0]：date 民國、fields、data）；休市日 data 為空。"""
    obj = load_json(payload)
    tables = (obj.get("tables") or []) if isinstance(obj, dict) else []
    tab = tables[0] if tables else {}
    if not tab.get("data"):
        return ParseResult(pd.DataFrame(columns=COLS), no_data=True, message="查無資料")
    d = parse_date(tab.get("date"))
    df = _frame(
        tab.get("fields") or [], tab["data"], d.isoformat() if d else None, "三大法人買賣金額彙總表", TPEX_FIELDS
    )
    return ParseResult(df, response_date=d)
