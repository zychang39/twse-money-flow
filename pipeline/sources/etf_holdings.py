"""主動式 ETF 每日持股：各投信官網公開的持股揭露／申購買回清單（PCF）。

只涵蓋沒有反爬、導向循環或驗證機制的投信（清單與狀態見 config/sources.yml 的 active_etf.issuers）。
每家一個 parser，輸出統一欄位：date（持股日期＝淨值日，ISO）、etf、code、name、shares（股）、weight（%）、
units（該 ETF 當日已發行／在外流通受益權單位數，每列相同；投信沒有揭露時為空值，見 UNITS_FIELD）。
aum（基金淨資產，元；投信有揭露才有）、foreign（海外持股＝True）。
2026-10-09 起海外持股（如 "NVDA US"、"8411 JP"）也保留（foreign＝True，代號保留原樣），供 ETF 詳細頁呈現完整持股；
跨檔排行、個股頁等台股計算只用台股（foreign 為 False）。期貨、選擇權、現金不列入。
已實作：野村、群益、元大、富邦（2026-09-27）；台新、凱基、聯博、第一金、復華（2026-10-03）；
統一、中信、安聯、摩根、永豐（2026-10-09；DECISIONS #436）。國泰、兆豐的網站依 User-Agent 擋本工具，未涵蓋。
各家的請求方式（查詢日與持股日的關係）由 pipeline/tasks_advanced.py 的 _EtfFetcher 依 config 組合。
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from html import unescape
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import clean_code, clean_name, strip_tags, to_num
from pipeline.sources.base import (
    ParseError,
    ParseResult,
    cell,
    col,
    frame_from_fields,
    frame_from_records,
    last_position,
    load_json,
    opt,
    resolve_fields,
)

HOLDING_COLS = ["date", "etf", "code", "name", "shares", "weight", "units", "aum", "foreign"]
#: §3.4（2026-10-03）各投信受益權單位數的來源欄位；None＝該端點沒有揭露（以真實回應逐家確認，DATA_SOURCES.md）。
#: 每家都以「淨資產 ÷ 單位數 ＝ 每單位淨值」對照確認單位數與持股同一個淨值日。
UNITS_FIELD: dict[str, str | None] = {
    "nomura": "Entries.Data.FundAsset.Units",
    "capital": "data.pcf.totUnit（已發行受益權單位總數）",
    "yuanta": "PCF.osunit",
    "fubon": "頁面「基金在外流通單位數(單位)」",
    "taishin": "頁面「已發行受益權單位總數」",
    "kgi": "頁面「已發行受益權單位總數」",
    "fsitc": "WebAPI.aspx/Get_BuySellA「已發行受益權單位總數-台幣交易」（另一個請求）",
    "fhtrust": "工作表「基金在外流通單位數」",
    "ab": None,  # holdings 與基金資訊端點都沒有單位數（fundAssetTotal 只有各類資產市值與比例）
    "cathay": None,  # GetETFDetailStockList 只有持股列（且網站擋本工具，依規則跳過）
    "uni": "GetPCF 的 pcf 摘要 OUT_UNIT",
    "ctbc": "FundAssets「基金在外流通單位數」",
    "allianz": "Entries.CAnceTotalIssues",
    "jpmorgan": "m12_pcf 工作表「已發行受益權單位總數」（另一個請求；淨值日＝持股日才採用）",
    "sinopac": "頁面「基金在外流通單位數」",
}
TW_CODE = re.compile(r"^\d{4,6}[A-Z]?$")


def issuer_of(name: str, issuers: dict[str, dict[str, Any]]) -> str | None:
    """由行情名稱（如「主動野村臺灣優選」）判定發行投信；關鍵字設定在 config。"""
    for issuer_id, cfg in issuers.items():
        if str(cfg.get("keyword", "")) and str(cfg["keyword"]) in name:
            return issuer_id
    return None


def holding_code(raw: Any) -> tuple[str, bool]:
    """持股代號 →（代號, 是否海外）。台股：4–6 碼數字可帶 1 碼英文，彭博格式「2330 TT」去掉 TT；
    其他（「NVDA US」「8411 JP」「NVDA」）視為海外，代號只整理空白、保留原樣。"""
    text = " ".join(str(raw if raw is not None else "").split()).upper()
    if text.endswith(" TT"):
        text = text[:-3]
    c = clean_code(text)
    if TW_CODE.match(c):
        return c, False
    return text, True


def _frame(
    rows: list[tuple[Any, Any, Any, Any]], etf: str, d: date, units: float | None = None, aum: float | None = None
) -> pd.DataFrame:
    """units：該 ETF 當日受益權單位數；aum：基金淨資產（元）；兩者 > 0 才保留，其餘記為空值。"""
    u = units if units is not None and units > 0 else None
    a = aum if aum is not None and aum > 0 else None
    out = []
    for code, name, shares, weight in rows:
        c, foreign = holding_code(code)
        n = to_num(shares)
        if not c or n is None:
            continue
        out.append(
            {
                "date": d.isoformat(),
                "etf": etf,
                "code": c,
                "name": " ".join(str(name or "").split()) if foreign else clean_name(name),
                "shares": n,
                "weight": to_num(weight),
                "units": u,
                "aum": a,
                "foreign": foreign,
            }
        )
    df = pd.DataFrame(out, columns=HOLDING_COLS)
    return df.drop_duplicates(subset=["code"], keep="first").reset_index(drop=True)


def _empty(message: str) -> ParseResult:
    return ParseResult(pd.DataFrame(columns=HOLDING_COLS), no_data=True, message=message)


def _holding_map(code: str, name: str, shares: str, weight: str) -> dict[str, Any]:
    """持股表欄位：代號與股數必要（_frame 以股數篩選）；名稱、權重缺少時以空值處理。"""
    return {"code": code, "name": opt(name), "shares": col(shares), "weight": opt(weight)}


def _tuples(df: pd.DataFrame) -> list[tuple[Any, Any, Any, Any]]:
    return list(zip(df["code"], df["name"], df["shares"], df["weight"], strict=True))


# ------------------------------------------------------------------ 野村投信（POST JSON Fund/GetFundAssets）
def parse_nomura(payload: bytes | str, etf: str) -> ParseResult:
    obj = load_json(payload)
    if not isinstance(obj, dict) or "StatusCode" not in obj:
        raise ParseError("野村：回應格式不符（缺 StatusCode）")
    data = (obj.get("Entries") or {}).get("Data") or {}
    tables = data.get("Table") or []
    if obj["StatusCode"] != 0 or not tables:
        return _empty(str(obj.get("Message") or "野村：查無持股資料"))
    asset = data.get("FundAsset") or {}
    d = parse_date(asset.get("NavDate"))
    if d is None:
        raise ParseError("野村：找不到淨值日期（FundAsset.NavDate）")
    stock = next((t for t in tables if str(t.get("TableTitle", "")).strip() == "股票"), None)
    if stock is None:
        return ParseResult(
            pd.DataFrame(columns=HOLDING_COLS), response_date=d, no_data=True, message="野村：無股票持股表"
        )
    cols = [str(c.get("Name", "")).strip() for c in stock.get("Columns", [])]
    df = frame_from_fields(
        cols, stock.get("Rows", []), _holding_map("股票代號", "股票名稱", "股數", "權重(%)"), source="野村股票表"
    )
    return ParseResult(_frame(_tuples(df), etf, d, to_num(asset.get("Units"))), response_date=d)


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
    df = frame_from_records(
        stocks, _holding_map("stocNo", "stocName", "share", "weight"), source="群益 stocks", infer_types=False
    )
    # totUnit＝已發行受益權單位總數（nav ÷ totUnit ＝ pUnit，與 date2 同一個淨值日）
    return ParseResult(_frame(_tuples(df), etf, d, to_num(pcf.get("totUnit"))), response_date=d)


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
    df = frame_from_records(
        stocks, _holding_map("code", "name", "qty", "weights"), source="元大 StockWeights", infer_types=False
    )
    # osunit＝trandate 的在外流通單位數（totalav ÷ osunit ＝ nav）；preunit 是下一日的預估值，不用
    return ParseResult(_frame(_tuples(df), etf, d, to_num(pcf.get("osunit"))), response_date=d)


# ------------------------------------------------------------------ HTML 表格共用（富邦、台新、凱基）
_TABLE = re.compile(r"<table[^>]*>(.*?)</table>", re.S)
_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)


def _html_text(payload: bytes | str) -> str:
    return payload.decode("utf-8", errors="replace") if isinstance(payload, bytes) else payload


def _html_tables(text: str) -> list[list[list[str]]]:
    """每張 <table> → 每列的儲存格文字（去標籤、去前後空白）。"""
    return [
        [[strip_tags(c).strip() for c in _TD.findall(tr)] for tr in _TR.findall(table)]
        for table in _TABLE.findall(text)
    ]


def _table_rows(rows: list[list[str]], mapping: dict[str, Any], source: str) -> list[tuple[Any, Any, Any, Any]]:
    """表頭在第一列的持股表 → (代號, 名稱, 股數, 權重) 列；欄數不足的列（合計、備註）略過。"""
    pos = resolve_fields(rows[0], mapping, source=source)
    width = last_position(pos)
    return [
        (cell(r, pos["code"]), cell(r, pos["name"]), cell(r, pos["shares"]), cell(r, pos["weight"]))
        for r in rows[1:]
        if len(r) > width
    ]


def _label_number(text: str, label: str) -> float | None:
    """頁面文字中「label」之後的第一個數字（跨過標籤、空白與幣別），例：「已發行受益權單位總數 39,327,000」。"""
    m = re.search(re.escape(label) + r"(?:\s|<[^>]*>|TWD\$?|NT\$)*([-0-9,]+(?:\.\d+)?)", text)
    return to_num(m.group(1)) if m else None


def _no_stock_table(d: date, message: str) -> ParseResult:
    return ParseResult(pd.DataFrame(columns=HOLDING_COLS), response_date=d, no_data=True, message=message)


# ------------------------------------------------------------------ 富邦投信（GET Trade/Assets.aspx，HTML 表格）
_FUBON_DATE = re.compile(r"資料日期：\s*([0-9/]+)")


def parse_fubon(html: bytes | str, etf: str) -> ParseResult:
    """非交易日查詢時網站會回傳最近一個有資料的日期；以頁面上的「資料日期」為準。"""
    text = _html_text(html)
    m = _FUBON_DATE.search(text)
    if not m:
        if "查無" in text or "無資料" in text:
            return _empty("富邦：查無持股資料")
        raise ParseError("富邦：找不到「資料日期」")
    d = parse_date(m.group(1))
    if d is None:
        raise ParseError(f"富邦：無法解析資料日期 {m.group(1)!r}")
    for rows in _html_tables(text):
        # 持股表：表頭有「股票…」或「股數」欄（另一張為現金等「項目／金額」表）
        if rows and any(h.startswith("股票") or h == "股數" for h in rows[0]):
            body = _table_rows(rows, _holding_map("股票代碼", "股票名稱", "股數", "權重(%)"), "富邦持股表")
            units = _label_number(text, "基金在外流通單位數(單位)")
            return ParseResult(_frame(body, etf, d, units), response_date=d)
    return _no_stock_table(d, "富邦：無股票持股表")


# ------------------------------------------------------------------ 台新投信（GET HTML ETF/Home/Pcf/{etf}?FundType=ALL&DataDate=YYYY-MM-DD）
_TAISHIN_ETF = re.compile(r'id="ETF_ID"[^>]*value="([^"]*)"')
_TAISHIN_NAV = re.compile(r"(\d{4}/\d{1,2}/\d{1,2})預估發行受益權單位數")
# 國內型（00987A）頁面沒有「預估發行受益權單位數」列：改取「YYYY/M/D每基數實際申購總價金」的日期（2026-10-03 實測：
# 淨值 17.76 對應 10/02 收盤 17.68）
_TAISHIN_ACTUAL = re.compile(r"(\d{4}/\d{1,2}/\d{1,2})每基數實際申購總價金")


def _strip_tt(code: Any) -> Any:
    """台新以彭博代碼呈現（「2330 TT」）：台股去掉 TT 字尾；其他市場（NVDA US…）保留原樣（holding_code 判定為海外）。"""
    parts = str(code or "").split()
    return parts[0] if len(parts) == 2 and parts[1] == "TT" else code


def parse_taishin(payload: bytes | str, etf: str) -> ParseResult:
    """DataDate 為申購買回清單適用日；持股日取頁面「YYYY/M/D預估發行受益權單位數」的日期（清單製作時的最新淨值日）。

    國內型（00987A）沒有「預估發行受益權單位數」列，改取「YYYY/M/D每基數實際申購總價金」的日期。
    查無資料時版面仍在：金額為 0、日期顯示 0001/1/1、沒有「預估發行受益權單位數」列。
    """
    text = _html_text(payload)
    page_etf = _TAISHIN_ETF.search(text)
    if page_etf and clean_code(page_etf.group(1)) != etf:
        raise ParseError(f"台新：頁面 ETF_ID 為 {page_etf.group(1)!r}，與查詢的 {etf} 不符")
    m = _TAISHIN_NAV.search(text)
    if not m and "0001/1/1" in text:
        return _empty("台新：該日無申購買回清單")
    m = m or _TAISHIN_ACTUAL.search(text)
    if not m:
        raise ParseError("台新：找不到「預估發行受益權單位數」或「每基數實際申購總價金」的日期")
    d = parse_date(m.group(1))
    if d is None:
        raise ParseError(f"台新：無法解析日期 {m.group(1)!r}")
    for rows in _html_tables(text):
        # 股票表的表頭為「代號／名稱／股數／持股權重」；期貨表為「期貨代號…」，基金資訊表沒有表頭列
        if rows and "代號" in rows[0] and "股數" in rows[0]:
            body = _table_rows(rows, _holding_map("代號", "名稱", "股數", "持股權重"), "台新持股表")
            units = _label_number(text, "已發行受益權單位總數")
            tw = [(_strip_tt(c), n, s, w) for c, n, s, w in body]
            return ParseResult(_frame(tw, etf, d, units), response_date=d)
    return _no_stock_table(d, "台新：無股票持股表")


# ------------------------------------------------------------------ 凱基投信（POST 表單 Fund/RedemptionVC，HTML 局部頁面）
_KGI_NAV = re.compile(r"\((\d{4}/\d{1,2}/\d{1,2})\)每受益權單位淨資產價值")


def parse_kgi(payload: bytes | str, etf: str) -> ParseResult:
    """queryDate 為申購買回清單適用日（DataDate）；持股日取「(YYYY/MM/DD)每受益權單位淨資產價值」的淨值日。

    頁面中文以 HTML 實體（&#x…;）編碼，先還原再解析；「看更多」隱藏列（display:none）也在 HTML 內，一併取得。
    """
    text = unescape(_html_text(payload))
    m = _KGI_NAV.search(text)
    if not m:
        if "查無" in text or "無資料" in text:
            return _empty("凱基：查無申購買回清單")
        raise ParseError("凱基：找不到淨值日期（「(YYYY/MM/DD)每受益權單位淨資產價值」）")
    d = parse_date(m.group(1))
    if d is None:
        raise ParseError(f"凱基：無法解析淨值日期 {m.group(1)!r}")
    for rows in _html_tables(text):
        if rows and any(h.startswith("股票代號") for h in rows[0]):
            body = _table_rows(rows, _holding_map("股票代號", "股票名稱", "股數", "權重(%)"), "凱基持股表")
            units = _label_number(text, "已發行受益權單位總數")
            return ParseResult(_frame(body, etf, d, units), response_date=d)
    return _no_stock_table(d, "凱基：無股票持股表")


# ------------------------------------------------------------------ 聯博投信（GET JSON webapi.alliancebernstein.com /v2/funds/tw/zh-tw/investor/{isin}/holdings）
def isin_of(code: str) -> str:
    """台灣 ISIN：TW000 ＋ 6 碼證券代號 ＋ 檢查碼（字母轉 10–35 後做 Luhn）；聯博 API 以 ISIN 識別 ETF（00404A → TW00000404A5）。"""
    body = f"TW000{clean_code(code)}"
    digits = "".join(str(int(ch, 36)) for ch in body)
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch) * (2 if i % 2 == 0 else 1)
        total += n - 9 if n > 9 else n
    return body + str((10 - total % 10) % 10)


def parse_ab(payload: bytes | str, etf: str) -> ParseResult:
    """date 參數即持股日（不帶＝最新）；domesticHoldings 依類別分段，只取 holdings-section-equity（期貨、選擇權另段）。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or "domesticHoldings" not in obj:
        raise ParseError("聯博：回應格式不符（缺 domesticHoldings）")
    sections = obj.get("domesticHoldings") or []
    if not isinstance(sections, list):
        raise ParseError("聯博：domesticHoldings 不是清單")
    equity = next((s for s in sections if s.get("holdingCategory") == "holdings-section-equity"), None)
    if equity is None or not equity.get("holdings"):
        return _empty("聯博：查無股票持股（非交易日或尚未公告）")
    d = parse_date(equity.get("asOfDate"))  # MM/DD/YYYY
    if d is None:
        raise ParseError("聯博：找不到持股日期（asOfDate）")
    df = frame_from_records(
        equity["holdings"],
        _holding_map("holdingCode", "holding", "holdingShares", "holdingPerc"),
        source="聯博 holdings",
        infer_types=False,
    )
    return ParseResult(_frame(_tuples(df), etf, d, aum=_ab_aum(obj)), response_date=d)


def _ab_aum(obj: dict[str, Any]) -> float | None:
    """聯博沒有揭露單位數與淨資產：以 fundAssetTotal 的股票市值 ÷ 股票占淨資產比例還原基金淨資產（元）。"""
    total = obj.get("fundAssetTotal") or {}
    for sec in total.get("allocationObjSecType") or []:
        if sec.get("allocationObjSecType") == "holdings-section-equity":
            value, pct = to_num(sec.get("underlyingSecuritiesValue")), to_num(sec.get("percentageUnderlyingSecurities"))
            if value and pct and pct > 0:
                return value / (pct / 100)
    return None


# ------------------------------------------------------------------ 第一金投信（POST JSON WebAPI.aspx/Get_hd，ASP.NET WebMethod）
def parse_fsitc(payload: bytes | str, etf: str) -> ParseResult:
    """回應為 {"d": "<JSON 字串>"}；列的 group 1＝股票（A 代號、B 名稱、C 權重、D 股數）、4＝現金、5＝資產配置摘要。

    pStrDate 為公告日（空字串＝最新），回應 sdate 為持股日（早 1 個交易日）；查無資料時 d 為 null。
    """
    obj = load_json(payload)
    if not isinstance(obj, dict) or "d" not in obj:
        raise ParseError("第一金：回應格式不符（缺 d）")
    if not obj["d"]:
        return _empty("第一金：查無持股資料")
    rows = load_json(obj["d"])
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise ParseError("第一金：d 不是紀錄清單")
    d = parse_date(rows[0].get("sdate")) if rows else None
    if d is None:
        raise ParseError("第一金：找不到資料日期（sdate）")
    stocks = [r for r in rows if str(r.get("group")) == "1"]
    df = frame_from_records(stocks, _holding_map("A", "B", "D", "C"), source="第一金 Get_hd", infer_types=False)
    return ParseResult(_frame(_tuples(df), etf, d), response_date=d)


def parse_fsitc_units(payload: bytes | str) -> float | None:
    """第一金申購買回清單摘要（WebAPI.aspx/Get_BuySellA，與 Get_hd 同樣以公告日 pStrDate 查詢）→ 已發行受益權單位總數。

    回應 {"d": "[{A: 項目, B: 值, sdate: 公告日}, …]"}；「基金淨資產價值 ÷ 已發行受益權單位總數 ＝ 每受益權單位淨資產價值」
    對應 Get_hd 的持股日（淨值日）。取不到（null、格式不符、沒有該列）回 None，不影響持股本身。
    """
    try:
        obj = load_json(payload)
        rows = load_json(obj["d"]) if isinstance(obj, dict) and obj.get("d") else None
    except (ParseError, KeyError, TypeError):
        return None
    if not isinstance(rows, list):
        return None
    for r in rows:
        if isinstance(r, dict) and str(r.get("A", "")).startswith("已發行受益權單位總數"):
            return to_num(r.get("B"))
    return None


# ------------------------------------------------------------------ 復華投信（GET xlsx api/assetsExcel/{基金代碼}/{YYYYMMDD}）
_XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_FHTRUST_DATE = re.compile(r"日期[:：]\s*([0-9/]+)")


def _col_index(ref: str | None) -> int | None:
    """儲存格參照（"C12"）→ 欄位置（2）；沒有參照時回 None（依序排放）。"""
    letters = re.match(r"[A-Z]+", ref or "")
    if not letters:
        return None
    n = 0
    for ch in letters.group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def xlsx_rows(raw: bytes, sheet_no: int = 1) -> list[list[str]]:
    """以標準函式庫讀 xlsx 第 sheet_no 張工作表（預設第一張） → 每列的儲存格文字（共用字串、數值、inline 字串）；不另外引入 openpyxl。"""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            name = f"xl/worksheets/sheet{sheet_no}.xml"
            if name not in z.namelist():
                raise ParseError(f"xlsx：找不到第 {sheet_no} 張工作表")
            shared: list[str] = []
            if "xl/sharedStrings.xml" in z.namelist():
                sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
                shared = ["".join(t.text or "" for t in si.iter(f"{_XLSX_NS}t")) for si in sst.iter(f"{_XLSX_NS}si")]
            sheet = ET.fromstring(z.read(name))
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        raise ParseError(f"xlsx：檔案損毀（{exc}）") from exc
    rows: list[list[str]] = []
    for row in sheet.iter(f"{_XLSX_NS}row"):
        cells: list[str] = []
        for c in row.iter(f"{_XLSX_NS}c"):
            v = c.find(f"{_XLSX_NS}v")
            if c.get("t") == "s" and v is not None:
                value = shared[int(v.text or 0)]
            elif c.get("t") == "inlineStr":
                value = "".join(t.text or "" for t in c.iter(f"{_XLSX_NS}t"))
            else:
                value = (v.text or "") if v is not None else ""
            idx = _col_index(c.get("r"))
            if idx is not None and idx > len(cells):
                cells.extend([""] * (idx - len(cells)))  # 跳過的空白欄補空字串
            cells.append(value)
        rows.append(cells)
    return rows


def parse_fhtrust(payload: bytes | str, etf: str) -> ParseResult:
    """URL 的日期即持股日；無資料時網站回 HTTP 200 的 JSON 文字「查無資料」。工作表：抬頭、「日期: YYYY/MM/DD」、
    基金資產淨值等摘要，接著「證券代號／證券名稱／股數／金額／權重(%)」持股表（海外持股如 LITE US 不列入）。"""
    if isinstance(payload, str) or not payload.startswith(b"PK"):
        text = _html_text(payload)
        if "查無" in text:
            return _empty("復華：查無資料（該日尚未公告或非交易日）")
        raise ParseError("復華：回應不是 xlsx，也不是「查無資料」")
    rows = xlsx_rows(payload)
    d: date | None = None
    units: float | None = None
    aum: float | None = None
    header_at: int | None = None
    for i, r in enumerate(rows):
        for text in r:
            m = _FHTRUST_DATE.search(text)
            if m:
                d = parse_date(m.group(1))
        # 摘要區：「基金在外流通單位數」的下一列是數值
        if r and r[0].strip() == "基金在外流通單位數" and i + 1 < len(rows) and rows[i + 1]:
            units = to_num(rows[i + 1][0])
        if r and r[0].strip() == "基金資產淨值" and i + 1 < len(rows) and rows[i + 1]:
            aum = to_num(rows[i + 1][0])
        if "證券代號" in r and "股數" in r:
            header_at = i
            break
    if d is None:
        raise ParseError("復華：找不到「日期」")
    if header_at is None:
        return _no_stock_table(d, "復華：無持股表")
    body = _table_rows(rows[header_at:], _holding_map("證券代號", "證券名稱", "股數", "權重(%)"), "復華持股表")
    return ParseResult(_frame(body, etf, d, units, aum), response_date=d)


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
    df = frame_from_records(
        result, _holding_map("stockCode", "stockName", "volumn", "weights"), source="國泰 result", infer_types=False
    )
    return ParseResult(_frame(_tuples(df), etf, d), response_date=d)


# ------------------------------------------------------------------ 統一投信（ezmoney：GET ETF/Transaction/PCF、POST GetPCF）
_EZ_FUNDS = re.compile(r"""id=['"]DataFundList['"][^>]*data-content=['"](.*?)['"]""", re.S)
_DOTNET_DATE = re.compile(r"/Date\((-?\d+)")


def parse_uni_funds(payload: bytes | str) -> dict[str, str]:
    """PCF 頁的 <div id="DataFundList" data-content="…">（HTML 跳脫的 JSON）→ ETF 代號 → 內部基金代碼（sFundCode）。
    取得這頁同時建立工作階段 cookie（GetPCF 需要）。"""
    m = _EZ_FUNDS.search(_html_text(payload))
    if not m:
        raise ParseError("統一：PCF 頁找不到 DataFundList")
    funds = load_json(unescape(m.group(1)))
    if not isinstance(funds, list):
        raise ParseError("統一：DataFundList 不是清單")
    return {clean_code(f["sStockNo"]): str(f["sFundCode"]) for f in funds if f.get("sStockNo") and f.get("sFundCode")}


def _uni_date(v: Any) -> date | None:
    """GetPCF 的日期可能是 .NET 格式（/Date(1759766400000)/）或 ISO 字串。"""
    m = _DOTNET_DATE.search(str(v or ""))
    if m:
        from datetime import UTC, datetime, timedelta

        return (datetime.fromtimestamp(int(m.group(1)) / 1000, UTC) + timedelta(hours=8)).date()
    return parse_date(str(v)[:10]) if v else None


def parse_uni(payload: bytes | str, etf: str) -> ParseResult:
    """GetPCF：asset[] 中 AssetCode＝ST 的 Details 為股票（DetailCode、DetailName、Share、NavRate）；
    pcf[] 以 PCFCode 為鍵：TranDate＝持股日，NAV＝基金淨資產、OUT_UNIT＝已發行單位數。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or "asset" not in obj:
        raise ParseError("統一：回應格式不符（缺 asset）")
    pcf = obj.get("pcf") or []
    stocks = next((a for a in obj.get("asset") or [] if a.get("AssetCode") == "ST"), None)
    if not pcf or stocks is None or not stocks.get("Details"):
        return _empty("統一：查無申購買回清單")
    d = _uni_date(pcf[0].get("TranDate"))
    if d is None:
        raise ParseError("統一：找不到持股日（pcf.TranDate）")
    amount = {str(r.get("PCFCode")): r.get("Amount") for r in pcf}
    df = frame_from_records(
        stocks["Details"], _holding_map("DetailCode", "DetailName", "Share", "NavRate"), source="統一 Details", infer_types=False
    )
    return ParseResult(
        _frame(_tuples(df), etf, d, to_num(amount.get("OUT_UNIT")), to_num(amount.get("NAV"))), response_date=d
    )


# ------------------------------------------------------------------ 中國信託投信（POST API/home/AuthToken、etf/ETFList、etf/ETFHoldingWeight）
def _ctbc_json(payload: bytes | str) -> Any:
    """全站 API 的回應可能是「JSON 字串」（雙層編碼）。"""
    obj = load_json(payload)
    return load_json(obj) if isinstance(obj, str) else obj


def parse_ctbc_token(payload: bytes | str) -> str:
    """匿名工作階段權杖（網站發給每位訪客，不需登入）；之後的 API 以 ?token= 帶入。"""
    obj = _ctbc_json(payload)
    try:
        return str(obj["Data"]["token"])
    except (KeyError, TypeError) as exc:
        raise ParseError("中信：AuthToken 回應格式不符") from exc


def parse_ctbc_list(payload: bytes | str) -> dict[str, str]:
    obj = _ctbc_json(payload)
    data = obj.get("Data") if isinstance(obj, dict) else None
    rows = data.get("Data") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ParseError("中信：ETFList 格式不符")
    return {clean_code(r["ETF_ID"]): str(r["FID"]) for r in rows if r.get("ETF_ID") and r.get("FID")}


def parse_ctbc(payload: bytes | str, etf: str) -> ParseResult:
    """StartDate 為查詢日，回應該日（含）以前最近一次揭露；FundAssets[0].資料日期＝持股日；
    FundAssetsDetail 中 Code＝STOCK 為股票（code_、name_、qty_、weights_），期貨、選擇權、保證金另段。"""
    obj = _ctbc_json(payload)
    if not isinstance(obj, dict) or "ResultCode" not in obj:
        raise ParseError("中信：回應格式不符（缺 ResultCode）")
    data = obj.get("Data") or {}
    assets = data.get("FundAssets") if isinstance(data, dict) else None
    if obj["ResultCode"] != 0 or not assets:
        return _empty(str(obj.get("ResultMsg") or "中信：查無持股資料"))
    a = assets[0]
    d = parse_date(a.get("資料日期"))
    if d is None:
        raise ParseError("中信：找不到資料日期")
    stock = next((g for g in data.get("FundAssetsDetail") or [] if g.get("Code") == "STOCK"), None)
    if stock is None or not stock.get("Data"):
        return _no_stock_table(d, "中信：無股票持股")
    df = frame_from_records(
        stock["Data"], _holding_map("code_", "name_", "qty_", "weights_"), source="中信 STOCK", infer_types=False
    )
    return ParseResult(
        _frame(_tuples(df), etf, d, to_num(a.get("基金在外流通單位數")), to_num(a.get("基金淨資產"))), response_date=d
    )


# ------------------------------------------------------------------ 安聯投信（etf.allianzgi.com.tw webapi：防偽權杖＋JSON）
def parse_allianz_token(payload: bytes | str) -> str:
    """ASP.NET 防偽權杖（與工作階段 cookie 綁定，網站發給每位訪客）；之後的 POST 以 X-XSRF-TOKEN 標頭帶入。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or not obj.get("token"):
        raise ParseError("安聯：GetAntiForgeryToken 回應格式不符")
    return str(obj["token"])


def parse_allianz_type(payload: bytes | str) -> int:
    """基金類別清單 → 「主動式」類別的 Id（不寫死，對方調整分類時才不會默默失效）。"""
    obj = load_json(payload)
    for e in (obj.get("Entries") if isinstance(obj, dict) else None) or []:
        if "主動" in str(e.get("Name") or ""):
            return int(e["Id"])
    raise ParseError("安聯：基金類別找不到「主動式」")


def parse_allianz_funds(payload: bytes | str) -> dict[str, str]:
    obj = load_json(payload)
    entries = obj.get("Entries") if isinstance(obj, dict) else None
    if not isinstance(entries, list):
        raise ParseError("安聯：基金清單格式不符")
    return {
        clean_code(e["SecuritiesCode"]): str(e["FundNo"])
        for e in entries
        if str(e.get("SecuritiesCode") or "").strip() and e.get("FundNo")
    }


def parse_allianz(payload: bytes | str, etf: str) -> ParseResult:
    """Fund/GetFundTradeInfo：Date＝申購買回清單公告日（非公告日回空的 Entries）；CNavDt＝持股日（淨值日）；
    DynamicTableData 中標題以「股票」開頭的表為持股（列：序號、代號、名稱、股數、權重）。"""
    obj = load_json(payload)
    if not isinstance(obj, dict) or "Entries" not in obj:
        raise ParseError("安聯：回應格式不符（缺 Entries）")
    e = obj.get("Entries") or {}
    d = parse_date(str(e.get("CNavDt") or "")[:10]) if e else None
    if d is None:
        return _empty("安聯：該日無申購買回清單")
    table = next((t for t in e.get("DynamicTableData") or [] if str(t.get("TableTitle") or "").startswith("股票")), None)
    if table is None:
        return _no_stock_table(d, "安聯：無股票持股表")
    rows = [(r[1], r[2], r[3], r[4]) for r in table.get("Rows") or [] if isinstance(r, list) and len(r) >= 5]
    return ParseResult(
        _frame(rows, etf, d, to_num(e.get("CAnceTotalIssues")), to_num(e.get("CAnceTotalAv"))), response_date=d
    )


# ------------------------------------------------------------------ 摩根投信（GET FundsMarketingHandler/excel，xlsx）
_JPM_TITLE = re.compile(r"\((\d{4}-\d{2}-\d{2})\)")
_JPM_NAV = re.compile(r"(\d{4}/\d{1,2}/\d{1,2})\s*每受益權單位淨資產價值")


def parse_jpmorgan(payload: bytes | str, etf: str) -> ParseResult:
    """type=holding_pcf：date＝持股日；第 1 張工作表標題「基金資產 - 股票 (YYYY-MM-DD)」，表頭「股票代碼／股票名稱／股數／金額／權重(%)」。
    沒有資料時回 HTTP 404 的 JSON（呼叫端視為查無）。"""
    if isinstance(payload, str) or not payload.startswith(b"PK"):
        return _empty("摩根：查無持股（非交易日或尚未公告）")
    rows = xlsx_rows(payload)
    m = _JPM_TITLE.search(rows[0][0]) if rows and rows[0] else None
    d = parse_date(m.group(1)) if m else None
    if d is None:
        raise ParseError("摩根：找不到工作表標題的持股日")
    header_at = next((i for i, r in enumerate(rows) if "股票代碼" in r and "股數" in r), None)
    if header_at is None:
        return _no_stock_table(d, "摩根：無股票持股表")
    body = _table_rows(rows[header_at:], _holding_map("股票代碼", "股票名稱", "股數", "權重(%)"), "摩根持股表")
    return ParseResult(_frame(body, etf, d), response_date=d)


def parse_jpmorgan_units(payload: bytes | str) -> tuple[date | None, float | None, float | None]:
    """type=m12_pcf（現金申購買回清單公告，date＝公告日）→（淨值日, 已發行受益權單位總數, 基金淨資產價值）；
    「標籤, 值」兩欄。取不到回三個 None。"""
    if isinstance(payload, str) or not payload.startswith(b"PK"):
        return None, None, None
    try:
        rows = xlsx_rows(payload)
    except ParseError:
        return None, None, None
    d, units, aum = None, None, None
    for r in rows:
        if len(r) < 2:
            continue
        label = r[0].strip()
        if label.startswith("已發行受益權單位總數"):
            units = to_num(r[1])
        elif label.startswith("基金淨資產價值"):
            aum = to_num(r[1])
        elif (m := _JPM_NAV.search(label)) is not None:
            d = parse_date(m.group(1))
    return d, units, aum


# ------------------------------------------------------------------ 永豐投信（GET sitc.sinopac.com SinopacEtfs/Etfs/SinglePcf/{etf}，HTML）
_SINOPAC_DATE = re.compile(r"資料日期：\s*(\d{4}/\d{1,2}/\d{1,2})")


def parse_sinopac(payload: bytes | str, etf: str) -> ParseResult:
    """只有最新一份。頁面留有全系列 ETF 的空白表格模板：取第一個「資料日期：」之後、第一張有資料列的
    「證券代碼／證券名稱／股數／佔基金淨資產之權重(%)」表；單位數與淨資產也取同一段（其他基金的殘留區塊在後面）。"""
    text = unescape(_html_text(payload))
    if f"{etf}" not in text:
        raise ParseError(f"永豐：頁面沒有 {etf}")
    m = _SINOPAC_DATE.search(text)
    if not m:
        return _empty("永豐：找不到資料日期（尚未公告）")
    d = parse_date(m.group(1))
    if d is None:
        raise ParseError(f"永豐：無法解析資料日期 {m.group(1)!r}")
    rest = text[m.end() :]
    for rows in _html_tables(rest):
        if rows and "證券代碼" in rows[0] and len(rows) > 1:
            body = _table_rows(rows, _holding_map("證券代碼", "證券名稱", "股數", "佔基金淨資產之權重(%)"), "永豐持股表")
            if body:
                head = rest[: rest.find("證券代碼")]
                units = _label_number(head, "基金在外流通單位數")
                aum = _label_number(head, "基金淨資產價值(元)")
                return ParseResult(_frame(body, etf, d, units, aum), response_date=d)
    return _no_stock_table(d, "永豐：無股票持股表")
