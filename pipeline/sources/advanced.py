"""進階資料解析：借券、外資持股、當沖、停券預告、內部人轉讓、集保、期交所、匯率、美債。"""

from __future__ import annotations

import csv
import io
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import is_security_code, strip_tags, to_num
from pipeline.sources.base import (
    ParseError,
    ParseResult,
    expect_fields,
    finalize,
    frame_from_fields,
    is_no_data,
    load_json,
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
    rows = load_json(payload)
    df = pd.DataFrame(
        [
            {
                "code": r.get("SecuritiesCompanyCode"),
                "name": r.get("CompanyName"),
                "last_cover_date": r.get("ShortSaleSuspensionStartDate"),
                "end": r.get("ShortSaleSuspensionEndDate"),
                "reason": r.get("Reason"),
            }
            for r in rows
        ],
        columns=HALT_COLS,
    )
    return ParseResult(finalize(df, dates=["last_cover_date", "end"]).reset_index(drop=True))


# ------------------------------------------------------------------ 內部人持股轉讓事前申報
INSIDER_COLS = ["report_date", "code", "name", "holder_type", "holder", "method", "shares", "start", "end"]


def parse_insider(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    rows = load_json(payload)
    out = []
    for r in rows:
        code = r.get("公司代號") or r.get("SecuritiesCompanyCode")
        if not code:
            continue
        period = str(r.get("有效轉讓期間", ""))
        a, _, b = period.partition("~")
        sa, sb = parse_date(a), parse_date(b)
        rd = parse_date(r.get("出表日期") or r.get("Date"))
        out.append(
            {
                "report_date": rd.isoformat() if rd else None,
                "code": code,
                "name": r.get("公司名稱") or r.get("CompanyName"),
                "holder_type": r.get("申報人身分") or r.get("申請人身分"),
                "holder": r.get("姓名"),
                "method": strip_tags(r.get("預定轉讓方式及股數-轉讓方式", "")),
                "shares": r.get("預定轉讓方式及股數-轉讓股數"),
                "start": sa.isoformat() if sa else None,
                "end": sb.isoformat() if sb else None,
            }
        )
    df = pd.DataFrame(out, columns=INSIDER_COLS)
    return ParseResult(finalize(df, numeric=["shares"]).reset_index(drop=True))


# ------------------------------------------------------------------ 集保股權分散表
TDCC_COLS = ["date", "code", "level", "holders", "shares", "pct"]


def parse_tdcc(payload: bytes | str) -> ParseResult:
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload
    reader = csv.reader(io.StringIO(text))
    header = next(reader, [])
    if not header or "持股分級" not in "".join(header):
        raise ParseError(f"集保 CSV 欄位不符：{header}")
    rows = []
    for r in reader:
        if len(r) < 6:
            continue
        code = r[1].strip()
        if not is_security_code(code):
            continue
        rows.append((r[0].strip(), code, int(r[2]), to_num(r[3]), to_num(r[4]), to_num(r[5])))
    df = pd.DataFrame(rows, columns=TDCC_COLS)
    if df.empty:
        return ParseResult(df, no_data=True)
    d = parse_date(df["date"].iloc[0])
    df["date"] = d.isoformat() if d else None
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


def parse_taifex_insti(payload: bytes | str) -> ParseResult:
    rows = _big5_csv(payload)
    if not rows or "身份別" not in rows[0]:
        return ParseResult(pd.DataFrame(columns=FUT_INSTI_COLS), no_data=True)
    h = rows[0]
    idx = {name: h.index(name) for name in h}
    out = []
    for r in rows[1:]:
        if len(r) < len(h):
            continue
        d = parse_date(r[idx["日期"]])
        out.append(
            {
                "date": d.isoformat() if d else None,
                "contract": CONTRACT_IDS.get(r[idx["商品名稱"]].strip(), r[idx["商品名稱"]].strip()),
                "party": r[idx["身份別"]].strip(),
                "long_vol": to_num(r[idx["多方交易口數"]]),
                "short_vol": to_num(r[idx["空方交易口數"]]),
                "long_oi": to_num(r[idx["多方未平倉口數"]]),
                "short_oi": to_num(r[idx["空方未平倉口數"]]),
                "net_oi": to_num(r[idx["多空未平倉口數淨額"]]),
                "long_oi_value": to_num(r[idx["多方未平倉契約金額(千元)"]]),
                "short_oi_value": to_num(r[idx["空方未平倉契約金額(千元)"]]),
                "net_oi_value": to_num(r[idx["多空未平倉契約金額淨額(千元)"]]),
            }
        )
    return ParseResult(pd.DataFrame(out, columns=FUT_INSTI_COLS))


FUT_OI_COLS = ["date", "contract", "total_oi", "volume", "settle"]


def parse_taifex_oi(payload: bytes | str) -> ParseResult:
    """全市場未平倉：同一契約所有到期月份「一般」時段未沖銷契約數加總。"""
    rows = _big5_csv(payload)
    if not rows or "未沖銷契約數" not in rows[0]:
        return ParseResult(pd.DataFrame(columns=FUT_OI_COLS), no_data=True)
    h = rows[0]
    i_date, i_c, i_month = h.index("交易日期"), h.index("契約"), h.index("到期月份(週別)")
    i_oi, i_sess, i_vol = h.index("未沖銷契約數"), h.index("交易時段"), h.index("成交量")
    i_settle = h.index("結算價")
    agg: dict[tuple[str, str], dict[str, float]] = {}
    for r in rows[1:]:
        if len(r) <= i_sess or r[i_sess].strip() != "一般" or "/" in r[i_month]:
            continue  # 跳過盤後時段與價差組合
        d = parse_date(r[i_date])
        if not d:
            continue
        key = (d.isoformat(), r[i_c].strip())
        a = agg.setdefault(key, {"total_oi": 0.0, "volume": 0.0, "settle": float("nan")})
        a["total_oi"] += to_num(r[i_oi]) or 0
        a["volume"] += to_num(r[i_vol]) or 0
        if a["settle"] != a["settle"] and to_num(r[i_settle]):
            a["settle"] = float(to_num(r[i_settle]) or 0)  # 最近月結算價（列表依到期月排序）
    out = [{"date": d, "contract": c, **v} for (d, c), v in sorted(agg.items())]
    return ParseResult(pd.DataFrame(out, columns=FUT_OI_COLS))


def parse_fx(payload: bytes | str) -> ParseResult:
    rows = _big5_csv(payload)
    if not rows or "日期" not in rows[0][0]:
        return ParseResult(pd.DataFrame(columns=["date", "usd_twd"]), no_data=True)
    h = rows[0]
    i = next(k for k, name in enumerate(h) if "美元" in name and "新台幣" in name)
    out = []
    for r in rows[1:]:
        d = parse_date(r[0])
        if d and len(r) > i:
            out.append({"date": d.isoformat(), "usd_twd": to_num(r[i])})
    return ParseResult(pd.DataFrame(out, columns=["date", "usd_twd"]))


def parse_treasury(payload: bytes | str) -> ParseResult:
    text = payload.decode("utf-8-sig", errors="replace") if isinstance(payload, bytes) else payload
    rows = [r for r in csv.reader(io.StringIO(text)) if r]
    if not rows or "10 Yr" not in rows[0]:
        raise ParseError("美國財政部 CSV 缺少 10 Yr 欄位")
    i = rows[0].index("10 Yr")
    out = []
    for r in rows[1:]:
        d = parse_date(r[0])
        if d and len(r) > i:
            out.append({"date": d.isoformat(), "y10": to_num(r[i])})
    return ParseResult(pd.DataFrame(out, columns=["date", "y10"]).sort_values("date").reset_index(drop=True))
