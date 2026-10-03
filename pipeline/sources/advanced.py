"""進階資料解析：借券、外資持股、當沖、停券預告、內部人轉讓、集保、期交所、匯率、美債。"""

from __future__ import annotations

import csv
import io
import re
from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import is_security_code, strip_tags, to_num
from pipeline.sources.base import (
    ParseError,
    ParseResult,
    cell,
    col,
    expect_fields,
    finalize,
    frame_from_fields,
    frame_from_records,
    is_no_data,
    last_position,
    load_json,
    opt,
    resolve_fields,
)
from pipeline.sources.tpex import _empty, _first_table, _obj_date, _tpex_no_data

# ------------------------------------------------------------------ 借券賣出餘額（TWT93U／tpex sbl）
SBL_COLS = [
    "date",
    "code",
    "name",
    "short_balance",
    "sbl_prev",
    "sbl_sell",
    "sbl_return",
    "sbl_adjust",
    "sbl_balance",
    "sbl_limit",
]
_SBL_MAP: dict[str, str | int] = {
    "code": 0,
    "name": 1,
    "short_balance": 6,
    "sbl_prev": 8,
    "sbl_sell": 9,
    "sbl_return": 10,
    "sbl_adjust": 11,
    "sbl_balance": 12,
    "sbl_limit": 13,
}


def _sbl_frame(fields: list[str], rows: list[list[Any]], d: str | None) -> pd.DataFrame:
    df = frame_from_fields(fields, rows, _SBL_MAP)
    df = finalize(df, numeric=SBL_COLS[3:])
    df["date"] = d
    return df[df["code"].map(is_security_code)][SBL_COLS].reset_index(drop=True)


def parse_twse_sbl(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=SBL_COLS), no_data=True, message=str(obj.get("stat")))
    expect_fields(
        obj["fields"],
        [
            "代號",
            "名稱",
            "前日餘額",
            "賣出",
            "買進",
            "現券",
            "今日餘額",
            "次一營業日限額",
            "前日餘額",
            "當日賣出",
            "當日還券",
            "當日調整",
            "當日餘額",
        ],
    )
    d = parse_date(obj.get("date"))
    return ParseResult(_sbl_frame(obj["fields"], obj.get("data", []), d.isoformat() if d else None), response_date=d)


def parse_tpex_sbl(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(SBL_COLS, obj)
    t = _first_table(obj)
    expect_fields(
        t["fields"],
        [
            "股票代號",
            "股票名稱",
            "前日餘額",
            "賣出",
            "買進",
            "現券",
            "當日餘額",
            "限額",
            "前日餘額",
            "當日賣出",
            "當日還券",
            "當日調整數額",
            "當日餘額",
        ],
    )
    d = _obj_date(obj)
    return ParseResult(_sbl_frame(t["fields"], t.get("data", []), d.isoformat() if d else None), response_date=d)


# ------------------------------------------------------------------ 外資持股比率
QFII_COLS = ["date", "code", "name", "shares_issued", "foreign_shares", "foreign_pct", "limit_pct"]


def parse_twse_qfii(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=QFII_COLS), no_data=True, message=str(obj.get("stat")))
    d = parse_date(obj.get("date"))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "code": "證券代號",
            "name": "證券名稱",
            "shares_issued": "發行股數",
            "foreign_shares": "全體外資及陸資持有股數",
            "foreign_pct": "全體外資及陸資持股比率",
            "limit_pct": "外資及陸資共用法令投資上限比率",
        },
    )
    df = finalize(df, numeric=QFII_COLS[3:])
    df["date"] = d.isoformat() if d else None
    return ParseResult(df[df["code"].map(is_security_code)][QFII_COLS].reset_index(drop=True), response_date=d)


def parse_tpex_qfii(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(QFII_COLS, obj)
    t = _first_table(obj)
    d = _obj_date(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "code": "代號",
            "name": "名稱",
            "shares_issued": "發行股數(A)",
            "foreign_shares": "僑外資及陸資持有股數(C)",
            "foreign_pct": "僑外資及陸資持股比率(E=C/A)",
            "limit_pct": "法令投資上限比率(F)",
        },
    )
    df = finalize(df, numeric=QFII_COLS[3:])
    df["date"] = d.isoformat() if d else None
    return ParseResult(df[df["code"].map(is_security_code)][QFII_COLS].reset_index(drop=True), response_date=d)


# ------------------------------------------------------------------ 當沖
DAYTRADE_COLS = ["date", "code", "name", "dt_volume", "dt_buy_value", "dt_sell_value", "suspend_flag"]
_DT_FIELDS = [
    "證券代號",
    "證券名稱",
    "暫停現股賣出後現款買進當沖註記",
    "當日沖銷交易成交股數",
    "當日沖銷交易買進成交金額",
    "當日沖銷交易賣出成交金額",
]


def _daytrade(tables: list[dict[str, Any]], d: str | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    detail = next((t for t in tables if t and "證券代號" in (t.get("fields") or [])), None)
    if detail is None:
        raise ParseError("當沖：找不到個股明細表")
    expect_fields(detail["fields"], _DT_FIELDS)
    df = frame_from_fields(
        detail["fields"],
        detail.get("data", []),
        {"code": 0, "name": 1, "suspend_flag": 2, "dt_volume": 3, "dt_buy_value": 4, "dt_sell_value": 5},
    )
    df = finalize(df, numeric=["dt_volume", "dt_buy_value", "dt_sell_value"])
    df["suspend_flag"] = [strip_tags(v) for v in df["suspend_flag"]]
    df["date"] = d
    summary = next((t for t in tables if t and "當日沖銷交易總成交股數" in (t.get("fields") or [])), None)
    tot = pd.DataFrame()
    if summary and summary.get("data"):
        r = summary["data"][0]
        tot = pd.DataFrame(
            [
                {
                    "date": d,
                    "dt_volume": to_num(r[0]),
                    "dt_volume_pct": to_num(r[1]),
                    "dt_buy_value": to_num(r[2]),
                    "dt_sell_value": to_num(r[4]),
                }
            ]
        )
    return df[df["code"].map(is_security_code)][DAYTRADE_COLS].reset_index(drop=True), tot


def parse_twse_daytrade(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=DAYTRADE_COLS), no_data=True, message=str(obj.get("stat")))
    d = parse_date(obj.get("date"))
    df, tot = _daytrade(obj.get("tables") or [], d.isoformat() if d else None)
    return ParseResult(df, response_date=d, extras={"twse_daytrade_total": tot})


def parse_tpex_daytrade(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(DAYTRADE_COLS, obj)
    d = _obj_date(obj)
    df, tot = _daytrade(obj.get("tables") or [], d.isoformat() if d else None)
    return ParseResult(df, response_date=d, extras={"tpex_daytrade_total": tot})


# ------------------------------------------------------------------ 每 5 秒指數統計（首頁 1D；M2 2026-10-03）
INTRADAY_INDEX_COLS = ["date", "time", "taiex"]


def parse_twse_intraday_index(payload: bytes | str | dict[str, Any]) -> ParseResult:
    """證交所「每 5 秒指數統計」（MI_5MINS_INDEX）：只取時間與發行量加權股價指數，其餘類股指數不存。"""
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=INTRADAY_INDEX_COLS), no_data=True, message=str(obj.get("stat")))
    d = parse_date(obj.get("date"))
    df = frame_from_fields(
        obj.get("fields") or [],
        obj.get("data") or [],
        {"time": "時間", "taiex": "發行量加權股價指數"},
        source="每 5 秒指數統計",
    )
    df["taiex"] = pd.to_numeric(df["taiex"].map(to_num), errors="coerce")
    df["time"] = df["time"].astype(str).str.strip()
    df = df[df["time"].str.match(r"^\d{2}:\d{2}:\d{2}$")].dropna(subset=["taiex"]).copy()
    df.insert(0, "date", d.isoformat() if d else None)
    return ParseResult(df[INTRADAY_INDEX_COLS].reset_index(drop=True), response_date=d)


# ------------------------------------------------------------------ 停券預告（融券最後回補日）
HALT_COLS = ["code", "name", "last_cover_date", "end", "reason"]


def parse_twse_short_halt(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=HALT_COLS), no_data=True)
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "code": "股票代號",
            "name": "股票名稱",
            "last_cover_date": "停券起日(最後回補日)",
            "end": "停券迄日",
            "reason": "原因",
        },
    )
    df = finalize(df, dates=["last_cover_date", "end"])
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    return ParseResult(df[HALT_COLS].reset_index(drop=True))


def parse_tpex_short_halt(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    df = frame_from_records(
        load_json(payload),
        {
            "code": "SecuritiesCompanyCode",
            "name": opt("CompanyName"),
            "last_cover_date": col("ShortSaleSuspensionStartDate"),
            "end": opt("ShortSaleSuspensionEndDate"),
            "reason": opt("Reason"),
        },
        source="上櫃停券預告",
    )
    return ParseResult(finalize(df, dates=["last_cover_date", "end"])[HALT_COLS].reset_index(drop=True))


# ------------------------------------------------------------------ 內部人持股轉讓事前申報
INSIDER_COLS = ["report_date", "code", "name", "holder_type", "holder", "method", "shares", "start", "end"]


# 上市（t187ap12_L）用中文欄名、上櫃（t187ap12_O）部分欄位用英文；依是否有 SecuritiesCompanyCode 判斷版本，
# 避免把正常的另一版欄名當成「改名」而發出格式變動警告。
_INSIDER_COMMON: dict[str, Any] = {
    "holder": col("姓名"),
    "method": opt("預定轉讓方式及股數-轉讓方式"),
    "shares": opt("預定轉讓方式及股數-轉讓股數"),
    "period": col("有效轉讓期間"),
}
_INSIDER_TWSE: dict[str, Any] = {
    "report_date": opt("出表日期"),
    "code": "公司代號",
    "name": opt("公司名稱"),
    "holder_type": opt("申報人身分", "申請人身分"),
    **_INSIDER_COMMON,
}
_INSIDER_TPEX: dict[str, Any] = {
    "report_date": opt("Date"),
    "code": "SecuritiesCompanyCode",
    "name": opt("CompanyName"),
    "holder_type": opt("申請人身分", "申報人身分"),
    **_INSIDER_COMMON,
}


def parse_insider(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    rows = load_json(payload)
    tpex = isinstance(rows, list) and any(isinstance(r, dict) and "SecuritiesCompanyCode" in r for r in rows)
    raw = frame_from_records(rows, _INSIDER_TPEX if tpex else _INSIDER_TWSE, source="內部人持股轉讓", infer_types=False)
    out = []
    for r in raw.to_dict("records"):
        code = r["code"]
        if not code:
            continue
        a, _, b = str(r["period"] or "").partition("~")
        sa, sb = parse_date(a), parse_date(b)
        rd = parse_date(r["report_date"])
        out.append(
            {
                "report_date": rd.isoformat() if rd else None,
                "code": code,
                "name": r["name"],
                "holder_type": r["holder_type"],
                "holder": r["holder"],
                "method": strip_tags(r["method"]),
                "shares": r["shares"],
                "start": sa.isoformat() if sa else None,
                "end": sb.isoformat() if sb else None,
            }
        )
    df = pd.DataFrame(out, columns=INSIDER_COLS)
    return ParseResult(finalize(df, numeric=["shares"]).reset_index(drop=True))


# ------------------------------------------------------------------ 集保股權分散表
TDCC_COLS = ["date", "code", "level", "holders", "shares", "pct"]
# 大戶比例（whale）只用到 pct；人數、股數缺少時以空值處理
_TDCC_MAP: dict[str, Any] = {
    "date": col("資料日期"),
    "code": "證券代號",
    "level": col("持股分級"),
    "holders": opt("人數"),
    "shares": opt("股數"),
    "pct": col("占集保庫存數比例%"),
}


def parse_tdcc(payload: bytes | str) -> ParseResult:
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload
    reader = csv.reader(io.StringIO(text))
    header = next(reader, [])
    if not header:
        raise ParseError("集保 CSV 是空的")
    pos = resolve_fields(header, _TDCC_MAP, source="集保股權分散表")
    width = last_position(pos)
    rows = []
    for r in reader:
        if len(r) <= width:
            continue
        code = str(cell(r, pos["code"])).strip()
        if not is_security_code(code):
            continue
        level = str(cell(r, pos["level"])).strip()
        if not level.isdigit():
            raise ParseError(f"集保 CSV 持股分級不是整數：{level!r}（{code}）")
        rows.append(
            (
                str(cell(r, pos["date"])).strip(),
                code,
                int(level),
                to_num(cell(r, pos["holders"])),
                to_num(cell(r, pos["shares"])),
                to_num(cell(r, pos["pct"])),
            )
        )
    df = pd.DataFrame(rows, columns=TDCC_COLS)
    if df.empty:
        return ParseResult(df, no_data=True)
    d = parse_date(df["date"].iloc[0])
    df["date"] = d.isoformat() if d else None
    return ParseResult(df, response_date=d)


# ------------------------------------------------------------------ 集保個股歷史（qryStock，近一年逐週）
TDCC_TOTAL_LEVEL = 17  # 與開放資料一致：1–15 持股分級、16 差異數調整、17 合計


def parse_tdcc_form(html: bytes | str) -> tuple[str, list[str]]:
    """集保「股權分散表查詢」頁：回傳表單的 SYNCHRONIZER_TOKEN 與可查詢的週別（YYYYMMDD，新到舊）。"""
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    token = re.search(r'name="SYNCHRONIZER_TOKEN"\s+value="([^"]+)"', text)
    select = re.search(r'<select[^>]*name="scaDate"[^>]*>(.*?)</select>', text, re.S)
    if not token or not select:
        raise ParseError("集保查詢頁格式不符：找不到 SYNCHRONIZER_TOKEN 或週別選單")
    weeks = re.findall(r'<option value="(\d{8})"', select.group(1))
    if not weeks:
        raise ParseError("集保查詢頁格式不符：週別選單沒有選項")
    return token.group(1), weeks


_TDCC_STOCK_MAP: dict[str, Any] = {
    "seq": col("序"),
    "label": col("持股/單位數分級"),
    "holders": opt("人數"),
    "shares": opt("股數/單位數"),
    "pct": col("占集保庫存數比例(%)"),
}


def parse_tdcc_stock(html: bytes | str, code: str) -> ParseResult:
    """集保個股查詢結果（HTML 表格：序、持股分級、人數、股數、占集保庫存數比例）→ TDCC_COLS。

    分級 1–15 與開放資料相同；「合計」列存成分級 17（開放資料的 16 為差異數調整，這裡沒有）。
    查無資料（例：代號不存在、該週未掛牌）回傳 no_data。
    """
    text = html.decode("utf-8", errors="replace") if isinstance(html, bytes) else html
    m = re.search(r"資料日期：\s*(\d{2,3})年(\d{1,2})月(\d{1,2})日", text)
    i = text.find("持股/單位數分級")
    if not m or i < 0:
        if "查無此資料" in text or "查無資料" in text:
            return ParseResult(pd.DataFrame(columns=TDCC_COLS), no_data=True, message="查無資料")
        raise ParseError("集保個股查詢結果格式不符：找不到資料日期或分級表")
    d = date(int(m.group(1)) + 1911, int(m.group(2)), int(m.group(3)))
    shown = re.search(r"證券代號：\s*([0-9A-Z]+)", text)
    if shown and shown.group(1) != code:
        raise ParseError(f"集保查詢結果的代號 {shown.group(1)} 與要求的 {code} 不符")
    start = text.rfind("<table", 0, i)
    table = text[start if start >= 0 else i : text.find("</table>", i)]
    header = [strip_tags(c).strip() for c in re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)]
    pos = resolve_fields(header, _TDCC_STOCK_MAP, source="集保個股查詢")
    width = last_position(pos)
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", table, re.S):
        cells = [strip_tags(c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) <= width:
            continue
        seq, label = str(cell(cells, pos["seq"])), str(cell(cells, pos["label"])).replace(" ", "")
        level = TDCC_TOTAL_LEVEL if label == "合計" else int(seq) if seq.isdigit() else None
        if level is None or not (1 <= level <= 15 or level == TDCC_TOTAL_LEVEL):
            continue
        rows.append(
            (
                d.isoformat(),
                code,
                level,
                to_num(cell(cells, pos["holders"])),
                to_num(cell(cells, pos["shares"])),
                to_num(cell(cells, pos["pct"])),
            )
        )
    df = pd.DataFrame(rows, columns=TDCC_COLS)
    if len(df) != 16 or TDCC_TOTAL_LEVEL not in set(df["level"]):
        raise ParseError(f"集保個股查詢結果應有 15 個分級＋合計，實際 {len(df)} 列")
    return ParseResult(df, response_date=d)


# ------------------------------------------------------------------ 期交所（Big5 CSV）
CONTRACT_IDS = {"臺股期貨": "TXF", "小型臺指期貨": "MXF", "微型臺指期貨": "TMF"}
FUT_INSTI_COLS = [
    "date",
    "contract",
    "party",
    "long_vol",
    "short_vol",
    "long_oi",
    "short_oi",
    "net_oi",
    "long_oi_value",
    "short_oi_value",
    "net_oi_value",
]


def _big5_csv(payload: bytes | str) -> list[list[str]]:
    text = payload.decode("cp950", errors="replace") if isinstance(payload, bytes) else payload
    if "<html" in text[:200].lower():
        raise ParseError("期交所回傳 HTML（查詢失敗或無資料）")
    return [r for r in csv.reader(io.StringIO(text)) if r]


# 外資期貨淨部位用 net_oi、散戶多空比用 long_oi／short_oi；交易口數與契約金額為選用
_FUT_INSTI_MAP: dict[str, Any] = {
    "date": col("日期"),
    "contract": col("商品名稱"),
    "party": col("身份別"),
    "long_vol": opt("多方交易口數"),
    "short_vol": opt("空方交易口數"),
    "long_oi": col("多方未平倉口數"),
    "short_oi": col("空方未平倉口數"),
    "net_oi": col("多空未平倉口數淨額"),
    "long_oi_value": opt("多方未平倉契約金額(千元)"),
    "short_oi_value": opt("空方未平倉契約金額(千元)"),
    "net_oi_value": opt("多空未平倉契約金額淨額(千元)"),
}
_FUT_INSTI_NUM = [k for k in FUT_INSTI_COLS if k not in ("date", "contract", "party")]


def parse_taifex_insti(payload: bytes | str) -> ParseResult:
    """表頭欄位缺少 → ParseError；表頭正確但沒有資料列 → no_data。"""
    rows = _big5_csv(payload)
    if not rows:
        return ParseResult(pd.DataFrame(columns=FUT_INSTI_COLS), no_data=True, message="期交所回傳空白 CSV")
    h = rows[0]
    pos = resolve_fields(h, _FUT_INSTI_MAP, source="期交所三大法人期貨")
    out = []
    for r in rows[1:]:
        if len(r) < len(h):
            continue
        d = parse_date(cell(r, pos["date"]))
        name = str(cell(r, pos["contract"])).strip()
        out.append(
            {
                "date": d.isoformat() if d else None,
                "contract": CONTRACT_IDS.get(name, name),
                "party": str(cell(r, pos["party"])).strip(),
                **{k: to_num(cell(r, pos[k])) for k in _FUT_INSTI_NUM},
            }
        )
    if not out:
        return ParseResult(pd.DataFrame(columns=FUT_INSTI_COLS), no_data=True, message="查無資料")
    return ParseResult(pd.DataFrame(out, columns=FUT_INSTI_COLS))


FUT_OI_COLS = ["date", "contract", "total_oi", "volume", "settle"]
_FUT_OI_MAP: dict[str, Any] = {
    "date": col("交易日期"),
    "contract": col("契約"),
    "month": col("到期月份(週別)"),
    "oi": col("未沖銷契約數"),
    "session": col("交易時段"),
    "volume": opt("成交量"),
    "settle": opt("結算價"),
}


def parse_taifex_oi(payload: bytes | str) -> ParseResult:
    """全市場未平倉：同一契約所有到期月份「一般」時段未沖銷契約數加總。"""
    rows = _big5_csv(payload)
    if not rows:
        return ParseResult(pd.DataFrame(columns=FUT_OI_COLS), no_data=True, message="期交所回傳空白 CSV")
    pos = resolve_fields(rows[0], _FUT_OI_MAP, source="期交所期貨行情")
    i_date, i_c, i_month, i_oi, i_sess = (pos[k] for k in ("date", "contract", "month", "oi", "session"))
    i_vol, i_settle = pos["volume"], pos["settle"]
    width = last_position({k: pos[k] for k in ("date", "contract", "month", "oi", "session")})
    agg: dict[tuple[str, str], dict[str, float]] = {}
    for r in rows[1:]:
        if len(r) <= width or str(cell(r, i_sess)).strip() != "一般" or "/" in str(cell(r, i_month)):
            continue  # 跳過盤後時段與價差組合
        d = parse_date(cell(r, i_date))
        if not d:
            continue
        key = (d.isoformat(), str(cell(r, i_c)).strip())
        a = agg.setdefault(
            key, {"total_oi": 0.0, "volume": 0.0 if i_vol is not None else float("nan"), "settle": float("nan")}
        )
        a["total_oi"] += to_num(cell(r, i_oi)) or 0
        if i_vol is not None:
            a["volume"] += to_num(cell(r, i_vol)) or 0
        settle = to_num(cell(r, i_settle))
        if a["settle"] != a["settle"] and settle:
            a["settle"] = float(settle)  # 最近月結算價（列表依到期月排序）
    out = [{"date": d, "contract": c, **v} for (d, c), v in sorted(agg.items())]
    if not out:
        return ParseResult(pd.DataFrame(columns=FUT_OI_COLS), no_data=True, message="查無資料")
    return ParseResult(pd.DataFrame(out, columns=FUT_OI_COLS))


def parse_fx(payload: bytes | str) -> ParseResult:
    rows = _big5_csv(payload)
    if not rows:
        return ParseResult(pd.DataFrame(columns=["date", "usd_twd"]), no_data=True, message="期交所回傳空白 CSV")
    h = rows[0]
    # 美元欄名為「美元∕新台幣」（斜線字元不固定）：以同時包含「美元」「新台幣」比對，找不到時用標準名稱讓 resolve_fields 報錯
    usd = next((name for name in h if "美元" in name and "新台幣" in name), "美元/新台幣")
    pos = resolve_fields(h, {"date": col("日期"), "usd_twd": col(usd)}, source="期交所匯率")
    i_d, i = pos["date"], pos["usd_twd"]
    out = []
    for r in rows[1:]:
        d = parse_date(cell(r, i_d))
        if d and i is not None and len(r) > i:
            out.append({"date": d.isoformat(), "usd_twd": to_num(r[i])})
    if not out:
        return ParseResult(pd.DataFrame(columns=["date", "usd_twd"]), no_data=True, message="查無資料")
    return ParseResult(pd.DataFrame(out, columns=["date", "usd_twd"]))


PC_COLS = ["date", "put_vol", "call_vol", "pc_vol_ratio", "put_oi", "call_oi", "pc_oi_ratio"]
# 期交所「臺指選擇權 Put/Call 比」CSV（pcRatioDown，Big5、每列結尾多一個逗號）；只有未平倉比率是必要欄位，其餘選用
_PC_MAP: dict[str, Any] = {
    "date": col("日期"),
    "put_vol": opt("賣權成交量"),
    "call_vol": opt("買權成交量"),
    "pc_vol_ratio": opt("買賣權成交量比率%"),
    "put_oi": opt("賣權未平倉量"),
    "call_oi": opt("買權未平倉量"),
    "pc_oi_ratio": col("買賣權未平倉量比率%"),
}


def parse_taifex_pc(payload: bytes | str) -> ParseResult:
    """臺指選擇權 Put/Call 比（M2 2026-10-03）：成交量比率與未平倉量比率（%，賣權 ÷ 買權 × 100），依日期一列。"""
    rows = _big5_csv(payload)
    if not rows:
        return ParseResult(pd.DataFrame(columns=PC_COLS), no_data=True, message="期交所回傳空白 CSV")
    pos = resolve_fields(rows[0], _PC_MAP, source="期交所選擇權 Put/Call 比")
    out = []
    for r in rows[1:]:
        d = parse_date(cell(r, pos["date"]))
        if not d:
            continue
        out.append({"date": d.isoformat(), **{k: to_num(cell(r, pos[k])) for k in PC_COLS[1:]}})
    if not out:
        return ParseResult(pd.DataFrame(columns=PC_COLS), no_data=True, message="查無資料")
    return ParseResult(pd.DataFrame(out, columns=PC_COLS).sort_values("date").reset_index(drop=True))


def parse_treasury(payload: bytes | str) -> ParseResult:
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload
    rows = [r for r in csv.reader(io.StringIO(text)) if r]
    if not rows:
        raise ParseError("美國財政部 CSV 是空的")
    pos = resolve_fields(rows[0], {"date": col("Date"), "y10": col("10 Yr")}, source="美國財政部殖利率")
    i_d, i = pos["date"], pos["y10"]
    out = []
    for r in rows[1:]:
        d = parse_date(cell(r, i_d))
        if d and i is not None and len(r) > i:
            out.append({"date": d.isoformat(), "y10": to_num(r[i])})
    return ParseResult(pd.DataFrame(out, columns=["date", "y10"]).sort_values("date").reset_index(drop=True))
