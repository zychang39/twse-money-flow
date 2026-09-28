"""證交所（上市）資料解析：rwd JSON 與 OpenAPI。"""

from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd

from pipeline.core.dates import parse_date
from pipeline.core.normalize import is_security_code, sign_from_html, strip_tags, to_num
from pipeline.sources.base import (
    ParseError,
    ParseResult,
    col,
    expect_fields,
    finalize,
    frame_from_fields,
    frame_from_records,
    is_no_data,
    load_json,
    match_interval_minutes,
    opt,
    split_period,
)

QUOTE_COLS = ["date", "code", "name", "open", "high", "low", "close", "volume", "value", "trades", "change"]


def columns_frame(cols: dict[str, list[Any]], columns: list[str]) -> pd.DataFrame:
    """依欄建表（型別推斷與 list-of-dict 相同）；沒有資料列時回傳只有欄名的空表（與舊版一致）。"""
    if not any(cols.values()):
        return pd.DataFrame(columns=columns)
    return pd.DataFrame(cols, columns=columns)


def _response_date(obj: dict[str, Any]) -> date | None:
    return parse_date(obj.get("date")) if obj.get("date") else None


def _find_table(tables: list[dict[str, Any]], keyword: str) -> dict[str, Any] | None:
    for t in tables:
        if t and keyword in str(t.get("title", "")):
            return t
    return None


# ---------------------------------------------------------------- 每日收盤行情 + 指數（MI_INDEX）
def parse_quotes(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=QUOTE_COLS), no_data=True, message=str(obj.get("stat")))
    d = _response_date(obj)
    tables = obj.get("tables") or []
    quote_table = _find_table(tables, "每日收盤行情")
    if quote_table is None:
        raise ParseError("MI_INDEX 找不到「每日收盤行情」表")
    fields = quote_table["fields"]
    df = frame_from_fields(
        fields,
        quote_table.get("data", []),
        {
            "code": "證券代號",
            "name": "證券名稱",
            "volume": "成交股數",
            "trades": "成交筆數",
            "value": "成交金額",
            "open": "開盤價",
            "high": "最高價",
            "low": "最低價",
            "close": "收盤價",
            "sign": "漲跌(+/-)",
            "diff": "漲跌價差",
        },
    )
    df = finalize(df, numeric=["volume", "trades", "value", "open", "high", "low", "close", "diff"])
    signs = [strip_tags(s) for s in df["sign"]]
    change: list[float | None] = []
    for s, diff in zip(signs, df["diff"], strict=True):
        if s == "X" or pd.isna(diff):
            change.append(None)
        else:
            change.append(float(diff) * sign_from_html(s) if s in {"+", "-"} else 0.0)
    df["change"] = pd.Series(change, dtype="float64", index=df.index)
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    result = ParseResult(df[QUOTE_COLS].reset_index(drop=True), response_date=d)
    result.extras["twse_index"] = _parse_index_tables(tables, d)
    return result


def _parse_index_tables(tables: list[dict[str, Any]], d: date | None) -> pd.DataFrame:
    rows = []
    for t in tables:
        title = str(t.get("title", "")) if t else ""
        if "指數" not in title or not t.get("data"):
            continue
        kind = "return" if "報酬指數" in title else "price"
        for r in t["data"]:
            if len(r) < 5:
                continue
            sign = sign_from_html(r[2])
            points = to_num(r[3])
            rows.append(
                {
                    "date": d.isoformat() if d else None,
                    "name": strip_tags(r[0]),
                    "kind": kind,
                    "close": to_num(r[1]),
                    "change": points * sign if points is not None else None,
                    "change_pct": to_num(r[4]),
                }
            )
    df = pd.DataFrame(rows, columns=["date", "name", "kind", "close", "change", "change_pct"])
    return df.drop_duplicates(subset=["name"]).reset_index(drop=True)


# ---------------------------------------------------------------- 三大法人（T86）
INSTI_COLS = [
    "date",
    "code",
    "name",
    "foreign_buy",
    "foreign_sell",
    "foreign_net",
    "foreign_dealer_net",
    "trust_buy",
    "trust_sell",
    "trust_net",
    "dealer_net",
    "dealer_self_net",
    "dealer_hedge_net",
    "total_net",
    # 外資自營商、自營商（自行買賣／避險）的買進與賣出股數：2026-09 起才保存（較早的檔案為空值，可用 backfill --refresh 重抓）
    "foreign_dealer_buy",
    "foreign_dealer_sell",
    "dealer_self_buy",
    "dealer_self_sell",
    "dealer_hedge_buy",
    "dealer_hedge_sell",
]


def parse_insti(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=INSTI_COLS), no_data=True, message=str(obj.get("stat")))
    d = _response_date(obj)
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "code": "證券代號",
            "name": "證券名稱",
            "foreign_buy": "外陸資買進股數(不含外資自營商)",
            "foreign_sell": "外陸資賣出股數(不含外資自營商)",
            "foreign_net": "外陸資買賣超股數(不含外資自營商)",
            "foreign_dealer_net": "外資自營商買賣超股數",
            "trust_buy": "投信買進股數",
            "trust_sell": "投信賣出股數",
            "trust_net": "投信買賣超股數",
            "dealer_net": "自營商買賣超股數",
            "dealer_self_net": "自營商買賣超股數(自行買賣)",
            "dealer_hedge_net": "自營商買賣超股數(避險)",
            "total_net": "三大法人買賣超股數",
            "foreign_dealer_buy": "外資自營商買進股數",
            "foreign_dealer_sell": "外資自營商賣出股數",
            "dealer_self_buy": "自營商買進股數(自行買賣)",
            "dealer_self_sell": "自營商賣出股數(自行買賣)",
            "dealer_hedge_buy": "自營商買進股數(避險)",
            "dealer_hedge_sell": "自營商賣出股數(避險)",
        },
    )
    df = finalize(df, numeric=INSTI_COLS[3:])
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    return ParseResult(df[INSTI_COLS].reset_index(drop=True), response_date=d)


# ---------------------------------------------------------------- 融資融券（MI_MARGN）
MARGIN_COLS = [
    "date",
    "code",
    "name",
    "margin_buy",
    "margin_sell",
    "margin_redeem",
    "margin_prev",
    "margin_balance",
    "margin_limit",
    "short_sell",
    "short_buy",
    "short_redeem",
    "short_prev",
    "short_balance",
    "short_limit",
    "offset",
    "note",
]
MARGIN_FIELDS = [
    "代號",
    "名稱",
    "買進",
    "賣出",
    "現金償還",
    "前日餘額",
    "今日餘額",
    "次一營業日限額",
    "買進",
    "賣出",
    "現券償還",
    "前日餘額",
    "今日餘額",
    "次一營業日限額",
    "資券互抵",
    "註記",
]


def parse_margin(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=MARGIN_COLS), no_data=True, message=str(obj.get("stat")))
    d = _response_date(obj)
    tables = obj.get("tables") or []
    detail = _find_table(tables, "融資融券彙總")
    if detail is None:
        raise ParseError("MI_MARGN 找不到「融資融券彙總」表")
    expect_fields(detail["fields"], MARGIN_FIELDS)
    # 融券欄位順序為「買進、賣出」→ 融券賣出＝第 9 欄（賣出）、融券買進＝第 8 欄（買進）
    mapping: dict[str, str | int] = {
        "code": 0,
        "name": 1,
        "margin_buy": 2,
        "margin_sell": 3,
        "margin_redeem": 4,
        "margin_prev": 5,
        "margin_balance": 6,
        "margin_limit": 7,
        "short_buy": 8,
        "short_sell": 9,
        "short_redeem": 10,
        "short_prev": 11,
        "short_balance": 12,
        "short_limit": 13,
        "offset": 14,
        "note": 15,
    }
    df = frame_from_fields(detail["fields"], detail.get("data", []), mapping)
    df = finalize(df, numeric=[c for c in MARGIN_COLS if c not in {"date", "code", "name", "note"}])
    df["note"] = [strip_tags(v) for v in df["note"]]
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    result = ParseResult(df[MARGIN_COLS].reset_index(drop=True), response_date=d)
    summary = _find_table(tables, "信用交易統計")
    if summary:
        rows = []
        for r in summary.get("data", []):
            rows.append(
                {
                    "date": d.isoformat() if d else None,
                    "item": strip_tags(r[0]),
                    "buy": to_num(r[1]),
                    "sell": to_num(r[2]),
                    "redeem": to_num(r[3]),
                    "prev": to_num(r[4]),
                    "balance": to_num(r[5]),
                }
            )
        result.extras["twse_margin_total"] = pd.DataFrame(rows)
    return result


# ---------------------------------------------------------------- 本益比／殖利率／淨值比（BWIBBU_d）
VALUATION_COLS = ["date", "code", "name", "close", "dividend_yield", "dividend_year", "pe", "pb", "fin_period"]
# 本益比表的必要欄位：代號、本益比、殖利率、淨值比；其餘（名稱、股利年度、財報年/季…）缺少時仍可解析
VALUATION_REQUIRED = ("code", "pe", "dividend_yield", "pb")


def parse_valuation(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=VALUATION_COLS), no_data=True, message=str(obj.get("stat")))
    d = _response_date(obj)
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "code": ("證券代號", "股票代號"),
            "name": ("證券名稱", "公司名稱"),
            "close": "收盤價",
            "dividend_yield": "殖利率(%)",
            "dividend_year": "股利年度",
            "pe": "本益比",
            "pb": "股價淨值比",
            "fin_period": opt("財報年/季", "財報年季"),
        },
        required=VALUATION_REQUIRED,
        source="上市本益比",
    )
    df = finalize(df, numeric=["close", "dividend_yield", "dividend_year", "pe", "pb"])
    df["fin_period"] = [strip_tags(v) or None for v in df["fin_period"]]
    df["date"] = d.isoformat() if d else None
    return ParseResult(df[VALUATION_COLS].reset_index(drop=True), response_date=d)


# ---------------------------------------------------------------- 除權除息結果（TWT49U）
EXRIGHT_COLS = [
    "date",
    "code",
    "name",
    "pre_close",
    "ref_price",
    "rights_dividend",
    "cash_dividend",
    "stock_dividend_value",
    "kind",
    "factor",
]


def parse_exright(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=EXRIGHT_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "date": "資料日期",
            "code": "股票代號",
            "name": "股票名稱",
            "pre_close": "除權息前收盤價",
            "ref_price": "除權息參考價",
            "rights_dividend": "權值+息值",
            "kind": "權/息",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price", "rights_dividend"], dates=["date"])
    df["kind"] = [strip_tags(v) for v in df["kind"]]
    # 上市結果表只有「權值＋息值」合計：「息」事件即現金股利；「權息」事件無法拆分 → 留空由衍生計算處理
    df["cash_dividend"] = [rd if k == "息" else None for rd, k in zip(df["rights_dividend"], df["kind"], strict=True)]
    df["stock_dividend_value"] = [
        rd if k == "權" else None for rd, k in zip(df["rights_dividend"], df["kind"], strict=True)
    ]
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[EXRIGHT_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 除權除息預告（TWT48U）
NOTICE_COLS = [
    "date",
    "code",
    "name",
    "kind",
    "stock_ratio",
    "cash_capital_ratio",
    "subscription_price",
    "cash_dividend",
]


def parse_exright_notice(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=NOTICE_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "date": "除權除息日期",
            "code": "股票代號",
            "name": "名稱",
            "kind": "除權息",
            "stock_ratio": "無償配股率",
            "cash_capital_ratio": "現金增資配股率",
            "subscription_price": "現金增資認購價",
            "cash_dividend": "現金股利",
        },
    )
    df = finalize(
        df, numeric=["stock_ratio", "cash_capital_ratio", "subscription_price", "cash_dividend"], dates=["date"]
    )
    df["kind"] = [strip_tags(v) for v in df["kind"]]
    return ParseResult(df[NOTICE_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 減資恢復買賣（TWTAUU）
CAPRED_COLS = ["date", "code", "name", "pre_close", "ref_price", "reason", "factor"]


def parse_capreduce(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=CAPRED_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "date": "恢復買賣日期",
            "code": "股票代號",
            "name": "名稱",
            "pre_close": "停止買賣前收盤價格",
            "ref_price": "恢復買賣參考價",
            "reason": "減資原因",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price"], dates=["date"])
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[CAPRED_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 變更面額（TWTB8U）、ETF 分割／反分割（TWTCAU）
SPLIT_COLS = ["date", "code", "name", "kind", "pre_close", "ref_price", "factor"]


def parse_parchange(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=SPLIT_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "date": "恢復買賣日期",
            "code": "股票代號",
            "name": "名稱",
            "pre_close": "停止買賣前收盤價格",
            "ref_price": "恢復買賣參考價",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price"], dates=["date"])
    df["kind"] = "面額變更"
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[SPLIT_COLS].reset_index(drop=True))


def parse_etf_split(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=SPLIT_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "date": "恢復買賣日期",
            "code": "ETF代號",
            "name": "名稱",
            "kind": "分割(反分割)",
            "pre_close": "停止買賣前收盤價格",
            "ref_price": "恢復買賣參考價",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price"], dates=["date"])
    df["kind"] = [strip_tags(v) for v in df["kind"]]
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[SPLIT_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 注意股（announcement/notice）
ATTENTION_COLS = ["date", "code", "name", "count", "reason"]


def parse_attention(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=ATTENTION_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {"code": "證券代號", "name": "證券名稱", "count": "累計次數", "reason": "注意交易資訊", "date": "日期"},
    )
    df = finalize(df, numeric=["count"], dates=["date"])
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    return ParseResult(df[ATTENTION_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 處置股（announcement/punish）
DISPOSITION_COLS = [
    "announce_date",
    "code",
    "name",
    "count",
    "start",
    "end",
    "reason",
    "measure",
    "interval_minutes",
    "detail",
]


def parse_disposition(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if is_no_data(obj):
        return ParseResult(pd.DataFrame(columns=DISPOSITION_COLS), no_data=True, message=str(obj.get("stat")))
    df = frame_from_fields(
        obj["fields"],
        obj.get("data", []),
        {
            "announce_date": "公布日期",
            "code": "證券代號",
            "name": "證券名稱",
            "count": "累計",
            "reason": "處置條件",
            "period": "處置起迄時間",
            "measure": "處置措施",
            "detail": "處置內容",
        },
    )
    df = finalize(df, numeric=["count"], dates=["announce_date"])
    periods = [split_period(p) for p in df["period"]]
    df["start"] = [p[0] for p in periods]
    df["end"] = [p[1] for p in periods]
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    df["measure"] = [strip_tags(v) for v in df["measure"]]
    df["interval_minutes"] = [match_interval_minutes(v) for v in df["detail"]]
    df["detail"] = [strip_tags(v).replace("\n", " ")[:400] for v in df["detail"]]
    return ParseResult(df[DISPOSITION_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 注意累計可能達處置（OpenAPI notetrans）
ACCUM_COLS = ["code", "name", "situation"]


def parse_attention_accum(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    raw = frame_from_records(
        load_json(payload),
        {"code": "Code", "name": opt("Name"), "situation": col("RecentlyMetAttentionSecuritiesCriteria")},
        source="notetrans",
        infer_types=False,
    )
    raw = raw[raw["code"].map(bool).astype(bool)]
    df = columns_frame({c: raw[c].tolist() for c in ACCUM_COLS}, ACCUM_COLS)
    return ParseResult(finalize(df))


# ---------------------------------------------------------------- 休市日曆
HOLIDAY_COLS = ["date", "name", "description"]


def parse_holidays(payload: bytes | str | Any) -> ParseResult:
    """支援 rwd 版（fields/data）與 OpenAPI 版（list of dict）。"""
    obj = load_json(payload)
    if isinstance(obj, list):
        df = pd.DataFrame(
            [{"date": r.get("Date"), "name": r.get("Name"), "description": r.get("Description")} for r in obj]
        )
    else:
        if is_no_data(obj):
            return ParseResult(pd.DataFrame(columns=HOLIDAY_COLS), no_data=True)
        df = frame_from_fields(
            obj["fields"], obj.get("data", []), {"date": "日期", "name": "名稱", "description": "說明"}
        )
    df = finalize(df, dates=["date"], code_col="__none__", name_col=None)
    df["name"] = [strip_tags(v) for v in df["name"]]
    df["description"] = [strip_tags(v) for v in df["description"]]
    return ParseResult(df[HOLIDAY_COLS].dropna(subset=["date"]).reset_index(drop=True))


# ---------------------------------------------------------------- 公司基本資料（OpenAPI t187ap03_L）
COMPANY_COLS = ["code", "name", "market", "industry_code", "capital", "shares", "listing_date"]


def company_frame(raw: pd.DataFrame, market: str) -> pd.DataFrame:
    """frame_from_records(infer_types=False) 的公司基本資料 → COMPANY_COLS（上市、上櫃共用）。"""
    cols = {c: raw[c].tolist() for c in COMPANY_COLS if c in raw.columns}
    cols["market"] = [market] * len(raw)
    cols["industry_code"] = [str("" if v is None else v).strip() for v in cols["industry_code"]]
    return columns_frame(cols, COMPANY_COLS)


def parse_company(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    """產業別為必要欄位（產業分組用）；股數缺少時由行情的發行股數補（見 derive.dataset）。"""
    raw = frame_from_records(
        load_json(payload),
        {
            "code": "公司代號",
            "name": opt("公司簡稱"),
            "industry_code": col("產業別"),
            "capital": opt("實收資本額"),
            "shares": opt("已發行普通股數或TDR原股發行股數"),
            "listing_date": opt("上市日期"),
        },
        source="t187ap03_L",
        infer_types=False,
    )
    df = finalize(company_frame(raw, "twse"), numeric=["capital", "shares"], dates=["listing_date"])
    return ParseResult(df.reset_index(drop=True))


# ------------------------------------------------ 月營收（OpenAPI t187ap05_L／mopsfin_t187ap05_O 同格式）
REVENUE_COLS = [
    "ym",
    "code",
    "name",
    "market",
    "industry",
    "revenue",
    "revenue_prev_month",
    "revenue_last_year",
    "mom",
    "yoy",
    "cum_revenue",
    "cum_last_year",
    "cum_yoy",
    "note",
    "report_date",
]


# 月營收：資料年月、當月營收、去年同月增減為必要（分數與篩選用），其餘缺少時以空值處理
_REVENUE_API_MAP: dict[str, Any] = {
    "ym": col("資料年月"),
    "code": "公司代號",
    "name": opt("公司名稱"),
    "industry": opt("產業別"),
    "revenue": col("營業收入-當月營收"),
    "revenue_prev_month": opt("營業收入-上月營收"),
    "revenue_last_year": opt("營業收入-去年當月營收"),
    "mom": opt("營業收入-上月比較增減(%)"),
    "yoy": col("營業收入-去年同月增減(%)"),
    "cum_revenue": opt("累計營業收入-當月累計營收"),
    "cum_last_year": opt("累計營業收入-去年累計營收"),
    "cum_yoy": opt("累計營業收入-前期比較增減(%)"),
    "note": opt("備註"),
    "report_date": opt("出表日期"),
}


def parse_revenue_openapi(payload: bytes | str | list[dict[str, Any]], market: str) -> ParseResult:
    from pipeline.core.dates import parse_ym

    raw = frame_from_records(load_json(payload), _REVENUE_API_MAP, source="月營收 OpenAPI", infer_types=False)
    cols: dict[str, list[Any]] = {c: raw[c].tolist() for c in REVENUE_COLS if c in raw.columns}
    yms = [parse_ym(v) for v in cols["ym"]]
    reps = [parse_date(v) for v in cols["report_date"]]
    cols["ym"] = [ym.strftime("%Y-%m") if ym else None for ym in yms]
    cols["report_date"] = [d.isoformat() if d else None for d in reps]
    cols["market"] = [market] * len(raw)
    df = columns_frame(cols, REVENUE_COLS)
    df = finalize(
        df,
        numeric=[
            "revenue",
            "revenue_prev_month",
            "revenue_last_year",
            "mom",
            "yoy",
            "cum_revenue",
            "cum_last_year",
            "cum_yoy",
        ],
    )
    df["note"] = [strip_tags(v) for v in df["note"]]
    return ParseResult(df.dropna(subset=["ym"]).reset_index(drop=True))


def split_by_date(df: pd.DataFrame, col: str = "date") -> dict[date, pd.DataFrame]:
    out: dict[date, pd.DataFrame] = {}
    if df.empty or col not in df.columns:
        return out
    for key, part in df.groupby(col):
        d = parse_date(key)
        if d:
            out[d] = part.reset_index(drop=True)
    return out


__all__ = [
    "parse_attention",
    "parse_attention_accum",
    "parse_capreduce",
    "parse_company",
    "parse_disposition",
    "parse_exright",
    "parse_exright_notice",
    "parse_holidays",
    "parse_insti",
    "parse_margin",
    "parse_quotes",
    "parse_revenue_openapi",
    "parse_valuation",
    "split_by_date",
]
_ = match_interval_minutes
