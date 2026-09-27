"""主動式 ETF 每日持股：各投信官網公開的持股揭露／申購買回清單（PCF）。

只涵蓋沒有反爬、導向循環或驗證機制的投信（清單與狀態見 config/sources.yml 的 active_etf.issuers）。
每家一個 parser，輸出統一欄位：date（持股日期＝淨值日，ISO）、etf、code、name、shares（股）、weight（%）。
只保留台灣掛牌的證券代號（4–6 碼數字，可帶 1 碼英文）；海外持股（如 "NVDA US"）、期貨、現金不列入。
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, clean_name, strip_tags, to_num
from pipeline.sources.base import ParseError, ParseResult, load_json

HOLDING_COLS = ["date", "etf", "code", "name", "shares", "weight"]
TW_CODE = re.compile(r"^\d{4,6}[A-Z]?$")


def issuer_of(name: str, issuers: dict[str, dict[str, Any]]) -> str | None:
    """由行情名稱（如「主動野村臺灣優選」）判定發行投信；關鍵字設定在 config。"""
    for issuer_id, cfg in issuers.items():
        if str(cfg.get("keyword", "")) and str(cfg["keyword"]) in name:
            return issuer_id
    return None


def _frame(rows: list[tuple[Any, Any, Any, Any]], etf: str, d: date) -> pd.DataFrame:
    out = []
    for code, name, shares, weight in rows:
        c = clean_code(code)
        n = to_num(shares)
        if not TW_CODE.match(c) or n is None:
            continue
        out.append(
            {
                "date": d.isoformat(),
                "etf": etf,
                "code": c,
                "name": clean_name(name),
                "shares": n,
                "weight": to_num(weight),
            }
        )
    df = pd.DataFrame(out, columns=HOLDING_COLS)
    return df.drop_duplicates(subset=["code"], keep="first").reset_index(drop=True)


def _empty(message: str) -> ParseResult:
    return ParseResult(pd.DataFrame(columns=HOLDING_COLS), no_data=True, message=message)


# ------------------------------------------------------------------ 野村投信（POST JSON Fund/GetFundAssets）
def parse_nomura(payload: bytes | str, etf: str) -> ParseResult:
    obj = load_json(payload)
    if not isinstance(obj, dict) or "StatusCode" not in obj:
        raise ParseError("野村：回應格式不符（缺 StatusCode）")
    data = (obj.get("Entries") or {}).get("Data") or {}
    tables = data.get("Table") or []
    if obj["StatusCode"] != 0 or not tables:
        return _empty(str(obj.get("Message") or "野村：查無持股資料"))
    d = parse_date((data.get("FundAsset") or {}).get("NavDate"))
    if d is None:
        raise ParseError("野村：找不到淨值日期（FundAsset.NavDate）")
    stock = next((t for t in tables if str(t.get("TableTitle", "")).strip() == "股票"), None)
    if stock is None:
        return ParseResult(
            pd.DataFrame(columns=HOLDING_COLS), response_date=d, no_data=True, message="野村：無股票持股表"
        )
    cols = [str(c.get("Name", "")).strip() for c in stock.get("Columns", [])]
    try:
        i_code, i_name, i_sh, i_w = (cols.index(k) for k in ("股票代號", "股票名稱", "股數", "權重(%)"))
    except ValueError as exc:
        raise ParseError(f"野村：股票表欄位與預期不符：{cols}") from exc
    rows = [(r[i_code], r[i_name], r[i_sh], r[i_w]) for r in stock.get("Rows", [])]
    return ParseResult(_frame(rows, etf, d), response_date=d)


# ------------------------------------------------------------------ 群益投信（POST JSON etf/items、etf/buyback）
def parse_capital_items(payload: bytes | str) -> dict[str, str]:
    """ETF 代號 → 群益內部基金代碼（fundNo），PCF 查詢需要。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or obj.get("code") != 200 or not isinstance(obj.get("data"), list):
        raise ParseError("群益：基金清單格式不符")
    return {clean_code(x["stockNo"]): str(x["fundNo"]) for x in obj["data"] if x.get("stockNo") and x.get("fundNo")}


def parse_capital(payload: bytes | str, etf: str) -> ParseResult:
    obj = load_json(payload)
    if not isinstance(obj, dict) or "code" not in obj:
        raise ParseError("群益：回應格式不符（缺 code）")
    data = obj.get("data")
    if obj["code"] != 200 or not data:
        return _empty(str(obj.get("message") or "群益：查無申購買回清單"))
    pcf = data.get("pcf") or {}
    # date1＝申購買回清單適用日、date2＝淨值（持股）日
    d = parse_date(pcf.get("date2"))
    if d is None:
        raise ParseError("群益：找不到淨值日期（pcf.date2）")
    stocks = data.get("stocks")
    if not isinstance(stocks, list):
        raise ParseError("群益：缺少 stocks 欄位")
    rows = [(s.get("stocNo"), s.get("stocName"), s.get("share"), s.get("weight")) for s in stocks]
    return ParseResult(_frame(rows, etf, d), response_date=d)


# ------------------------------------------------------------------ 元大投信（GET api/bridge PCF/Daily）
def parse_yuanta(payload: bytes | str, etf: str) -> ParseResult:
    obj = load_json(payload)
    if not isinstance(obj, dict) or "PCF" not in obj:
        raise ParseError("元大：回應格式不符（缺 PCF）")
    pcf = obj.get("PCF")
    weights = obj.get("FundWeights")
    if not pcf or not weights:
        return _empty("元大：查無申購買回清單（非公告日）")
    d = parse_date(pcf.get("trandate"))
    if d is None:
        raise ParseError("元大：找不到淨值日期（PCF.trandate）")
    stocks = weights.get("StockWeights")
    if not isinstance(stocks, list):
        raise ParseError("元大：缺少 FundWeights.StockWeights")
    rows = [(s.get("code"), s.get("name"), s.get("qty"), s.get("weights")) for s in stocks]
    return ParseResult(_frame(rows, etf, d), response_date=d)


# ------------------------------------------------------------------ 富邦投信（GET Trade/Assets.aspx，HTML 表格）
_FUBON_DATE = re.compile(r"資料日期：\s*([0-9/]+)")
_TABLE = re.compile(r"<table[^>]*>(.*?)</table>", re.S)
_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)


def parse_fubon(html: bytes | str, etf: str) -> ParseResult:
    """非交易日查詢時網站會回傳最近一個有資料的日期；以頁面上的「資料日期」為準。"""
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    m = _FUBON_DATE.search(text)
    if not m:
        if "查無" in text or "無資料" in text:
            return _empty("富邦：查無持股資料")
        raise ParseError("富邦：找不到「資料日期」")
    d = parse_date(m.group(1))
    if d is None:
        raise ParseError(f"富邦：無法解析資料日期 {m.group(1)!r}")
    for table in _TABLE.findall(text):
        rows = [[strip_tags(c).strip() for c in _TD.findall(tr)] for tr in _TR.findall(table)]
        if not rows or rows[0][:3] != ["股票代碼", "股票名稱", "股數"]:
            continue
        header = rows[0]
        if "權重(%)" not in header:
            raise ParseError(f"富邦：持股表欄位與預期不符：{header}")
        i_w = header.index("權重(%)")
        body = [(r[0], r[1], r[2], r[i_w]) for r in rows[1:] if len(r) > i_w]
        return ParseResult(_frame(body, etf, d), response_date=d)
    return ParseResult(pd.DataFrame(columns=HOLDING_COLS), response_date=d, no_data=True, message="富邦：無股票持股表")


# ------------------------------------------------------------------ 國泰投信（GET api/ETF/GetETFList、GetETFDetailStockList）
def parse_cathay_list(payload: bytes | str) -> dict[str, str]:
    """ETF 代號 → 國泰內部基金代碼（fundCode）。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or not isinstance(obj.get("result"), list):
        raise ParseError("國泰：基金清單格式不符")
    return {
        clean_code(x["stockCode"]): str(x["fundCode"])
        for x in obj["result"]
        if x.get("stockCode") and x.get("fundCode")
    }


def parse_cathay(payload: bytes | str, etf: str, d: date) -> ParseResult:
    """回應沒有日期欄位；查詢日（SearchDate）即持股日，非交易日回「查無資料」。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or "returnCode" not in obj:
        raise ParseError("國泰：回應格式不符（缺 returnCode）")
    result = obj.get("result")
    if not obj.get("success") or not result:
        return _empty(str(obj.get("returnMessage") or "國泰：查無持股資料"))
    if not isinstance(result, list):
        raise ParseError("國泰：result 不是清單")
    rows = [(s.get("stockCode"), s.get("stockName"), s.get("volumn"), s.get("weights")) for s in result]
    return ParseResult(_frame(rows, etf, d), response_date=d)
