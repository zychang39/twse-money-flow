"""主動式 ETF 每日持股：各投信官網公開的持股揭露／申購買回清單（PCF）。

只涵蓋沒有反爬、導向循環或驗證機制的投信（清單與狀態見 config/sources.yml 的 active_etf.issuers）。
每家一個 parser，輸出統一欄位：date（持股日期＝淨值日，ISO）、etf、code、name、shares（股）、weight（%）、
units（該 ETF 當日已發行／在外流通受益權單位數，每列相同；投信沒有揭露時為空值，見 UNITS_FIELD）。
只保留台灣掛牌的證券代號（4–6 碼數字，可帶 1 碼英文）；海外持股（如 "NVDA US"）、期貨、現金不列入。
已實作：野村、群益、元大、富邦（2026-09-27）；台新、凱基、聯博、第一金、復華（2026-10-03）；國泰解析器完成但網站擋本工具。
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

HOLDING_COLS = ["date", "etf", "code", "name", "shares", "weight", "units"]
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
}
TW_CODE = re.compile(r"^\d{4,6}[A-Z]?$")


def issuer_of(name: str, issuers: dict[str, dict[str, Any]]) -> str | None:
    """由行情名稱（如「主動野村臺灣優選」）判定發行投信；關鍵字設定在 config。"""
    for issuer_id, cfg in issuers.items():
        if str(cfg.get("keyword", "")) and str(cfg["keyword"]) in name:
            return issuer_id
    return None


def _frame(rows: list[tuple[Any, Any, Any, Any]], etf: str, d: date, units: float | None = None) -> pd.DataFrame:
    """units：該 ETF 當日受益權單位數（> 0 才保留，其餘記為空值）。"""
    u = units if units is not None and units > 0 else None
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
                "units": u,
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
    """台新以彭博代碼呈現（「2330 TT」）：台股去掉 TT 字尾；其他市場（NVDA US…）保留原樣，之後由 TW_CODE 篩掉。"""
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
    return ParseResult(_frame(_tuples(df), etf, d), response_date=d)


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


def xlsx_rows(raw: bytes) -> list[list[str]]:
    """以標準函式庫讀 xlsx 第一張工作表 → 每列的儲存格文字（共用字串、數值、inline 字串）；不另外引入 openpyxl。"""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            sheets = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
            if not sheets:
                raise ParseError("xlsx：找不到工作表")
            shared: list[str] = []
            if "xl/sharedStrings.xml" in z.namelist():
                sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
                shared = ["".join(t.text or "" for t in si.iter(f"{_XLSX_NS}t")) for si in sst.iter(f"{_XLSX_NS}si")]
            sheet = ET.fromstring(z.read(sheets[0]))
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
    header_at: int | None = None
    for i, r in enumerate(rows):
        for text in r:
            m = _FHTRUST_DATE.search(text)
            if m:
                d = parse_date(m.group(1))
        # 摘要區：「基金在外流通單位數」的下一列是數值
        if r and r[0].strip() == "基金在外流通單位數" and i + 1 < len(rows) and rows[i + 1]:
            units = to_num(rows[i + 1][0])
        if "證券代號" in r and "股數" in r:
            header_at = i
            break
    if d is None:
        raise ParseError("復華：找不到「日期」")
    if header_at is None:
        return _no_stock_table(d, "復華：無持股表")
    body = _table_rows(rows[header_at:], _holding_map("證券代號", "證券名稱", "股數", "權重(%)"), "復華持股表")
    return ParseResult(_frame(body, etf, d, units), response_date=d)


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
