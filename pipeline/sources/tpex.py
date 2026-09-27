"""櫃買中心（上櫃）資料解析：www/zh-tw JSON 與 OpenAPI。"""

from __future__ import annotations

import re
from datetime import date
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
    load_json,
    match_interval_minutes,
    opt,
    split_period,
)
from pipeline.sources.twse import (
    ACCUM_COLS,
    ATTENTION_COLS,
    CAPRED_COLS,
    COMPANY_COLS,
    DISPOSITION_COLS,
    EXRIGHT_COLS,
    INSTI_COLS,
    MARGIN_COLS,
    NOTICE_COLS,
    QUOTE_COLS,
    SPLIT_COLS,
    VALUATION_COLS,
    VALUATION_REQUIRED,
)


def _obj_date(obj: dict[str, Any]) -> date | None:
    raw = str(obj.get("date", ""))
    return parse_date(raw) if raw and "~" not in raw else None


def _first_table(obj: dict[str, Any]) -> dict[str, Any]:
    tables = obj.get("tables") or []
    if not tables or not isinstance(tables[0], dict):
        raise ParseError("櫃買回應缺少 tables")
    return tables[0]


def _empty(cols: list[str], obj: Any) -> ParseResult:
    msg = str(obj.get("stat", "")) if isinstance(obj, dict) else ""
    return ParseResult(pd.DataFrame(columns=cols), no_data=True, message=msg)


def _tpex_no_data(obj: Any) -> bool:
    if not isinstance(obj, dict):
        return False
    stat = str(obj.get("stat", "ok")).lower()
    if stat not in {"ok", ""}:
        return True
    tables = obj.get("tables") or []
    return not tables or not any(t.get("data") for t in tables if isinstance(t, dict))


# ---------------------------------------------------------------- 上櫃收盤行情
TPEX_QUOTE_COLS = [*QUOTE_COLS, "avg", "shares"]


def parse_quotes(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(TPEX_QUOTE_COLS, obj)
    d = _obj_date(obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "code": "代號",
            "name": "名稱",
            "close": "收盤",
            "change": "漲跌",
            "open": "開盤",
            "high": "最高",
            "low": "最低",
            "avg": "均價",
            "volume": "成交股數",
            "value": "成交金額(元)",
            "trades": "成交筆數",
            "shares": "發行股數",
        },
    )
    df = finalize(df, numeric=["close", "change", "open", "high", "low", "avg", "volume", "value", "trades", "shares"])
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    return ParseResult(df[TPEX_QUOTE_COLS].reset_index(drop=True), response_date=d)


# ---------------------------------------------------------------- 上櫃三大法人
TPEX_INSTI_FIELDS = ["代號", "名稱"] + ["買進股數", "賣出股數", "買賣超股數"] * 7 + ["三大法人買賣超股數合計"]


def parse_insti(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(INSTI_COLS, obj)
    d = _obj_date(obj)
    t = _first_table(obj)
    expect_fields(t["fields"], TPEX_INSTI_FIELDS)
    # 欄位群組：外資(不含外資自營) 2–4、外資自營 5–7、外資合計 8–10、投信 11–13、
    #           自營(自行) 14–16、自營(避險) 17–19、自營合計 20–22、三大法人合計 23
    mapping: dict[str, str | int] = {
        "code": 0,
        "name": 1,
        "foreign_buy": 2,
        "foreign_sell": 3,
        "foreign_net": 4,
        "foreign_dealer_net": 7,
        "trust_buy": 11,
        "trust_sell": 12,
        "trust_net": 13,
        "dealer_self_net": 16,
        "dealer_hedge_net": 19,
        "dealer_net": 22,
        "total_net": 23,
    }
    df = frame_from_fields(t["fields"], t.get("data", []), mapping)
    df = finalize(df, numeric=INSTI_COLS[3:])
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    return ParseResult(df[INSTI_COLS].reset_index(drop=True), response_date=d)


# ---------------------------------------------------------------- 上櫃融資融券
TPEX_MARGIN_FIELDS = [
    "代號",
    "名稱",
    "前資餘額(張)",
    "資買",
    "資賣",
    "現償",
    "資餘額",
    "資屬證金",
    "資使用率(%)",
    "資限額",
    "前券餘額(張)",
    "券賣",
    "券買",
    "券償",
    "券餘額",
    "券屬證金",
    "券使用率(%)",
    "券限額",
    "資券相抵(張)",
    "備註",
]
TPEX_MARGIN_COLS = [*MARGIN_COLS, "margin_usage", "short_usage"]


def parse_margin(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(TPEX_MARGIN_COLS, obj)
    d = _obj_date(obj)
    t = _first_table(obj)
    expect_fields(t["fields"], TPEX_MARGIN_FIELDS)
    mapping: dict[str, str | int] = {
        "code": 0,
        "name": 1,
        "margin_prev": 2,
        "margin_buy": 3,
        "margin_sell": 4,
        "margin_redeem": 5,
        "margin_balance": 6,
        "margin_usage": 8,
        "margin_limit": 9,
        "short_prev": 10,
        "short_sell": 11,
        "short_buy": 12,
        "short_redeem": 13,
        "short_balance": 14,
        "short_usage": 16,
        "short_limit": 17,
        "offset": 18,
        "note": 19,
    }
    df = frame_from_fields(t["fields"], t.get("data", []), mapping)
    numeric = [c for c in TPEX_MARGIN_COLS if c not in {"date", "code", "name", "note"}]
    df = finalize(df, numeric=numeric)
    df["note"] = [strip_tags(v) for v in df["note"]]
    df["date"] = d.isoformat() if d else None
    df = df[df["code"].map(is_security_code)]
    result = ParseResult(df[TPEX_MARGIN_COLS].reset_index(drop=True), response_date=d)
    summary = t.get("summary")
    if isinstance(summary, list):
        rows = []
        for r in summary:
            if len(r) >= 15:
                rows.append(
                    {
                        "date": d.isoformat() if d else None,
                        "item": strip_tags(r[1]),
                        "buy": to_num(r[3]),
                        "sell": to_num(r[4]),
                        "redeem": to_num(r[5]),
                        "prev": to_num(r[2]),
                        "balance": to_num(r[6]),
                    }
                )
        result.extras["tpex_margin_total"] = pd.DataFrame(rows)
    return result


# ---------------------------------------------------------------- 上櫃本益比
def parse_valuation(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(VALUATION_COLS, obj)
    d = _obj_date(obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "code": ("股票代號", "代號", "證券代號"),
            "name": ("公司名稱", "名稱", "證券名稱"),
            "pe": "本益比",
            "dividend_year": "股利年度",
            "dividend_yield": "殖利率(%)",
            "pb": "股價淨值比",
            # 2024 年（含）以前的回應沒有「財報年/季」欄位
            "fin_period": opt("財報年/季", "財報年季"),
        },
        required=VALUATION_REQUIRED,
        source="上櫃本益比",
    )
    df = finalize(df, numeric=["pe", "dividend_year", "dividend_yield", "pb"])
    df["fin_period"] = [strip_tags(v) or None for v in df["fin_period"]]
    df["close"] = None
    df["date"] = d.isoformat() if d else None
    return ParseResult(df[VALUATION_COLS].reset_index(drop=True), response_date=d)


# ---------------------------------------------------------------- 上櫃除權息結果
def parse_exright(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(EXRIGHT_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "date": "除權息日期",
            "code": "代號",
            "name": "名稱",
            "pre_close": "除權息前收盤價",
            "ref_price": "除權息參考價",
            "stock_dividend_value": "權值",
            "cash_dividend": "息值",
            "rights_dividend": "權值+息值",
            "kind": "權/息",
        },
    )
    df = finalize(
        df,
        numeric=["pre_close", "ref_price", "stock_dividend_value", "cash_dividend", "rights_dividend"],
        dates=["date"],
    )
    df["kind"] = [strip_tags(v).replace("除", "") for v in df["kind"]]
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[EXRIGHT_COLS].reset_index(drop=True))


def parse_exright_notice(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    rows = load_json(payload)
    if not isinstance(rows, list):
        raise ParseError("tpex_exright_prepost 應為 list")
    df = pd.DataFrame(
        [
            {
                "date": r.get("ExRrightsExDividendDate"),
                "code": r.get("SecuritiesCompanyCode"),
                "name": r.get("CompanyName"),
                "kind": str(r.get("ExRrightsExDividend", "")).replace("除", ""),
                "stock_ratio": r.get("StockDividendRatio"),
                "cash_capital_ratio": r.get("SubscriptionRatioToNewSharesIssued"),
                "subscription_price": r.get("SubscriptionPricePerShare"),
                "cash_dividend": r.get("CashDividend"),
            }
            for r in rows
        ],
        columns=NOTICE_COLS,
    )
    df = finalize(
        df, numeric=["stock_ratio", "cash_capital_ratio", "subscription_price", "cash_dividend"], dates=["date"]
    )
    return ParseResult(df.reset_index(drop=True))


# ---------------------------------------------------------------- 上櫃減資恢復買賣
def parse_capreduce(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(CAPRED_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "date": "恢復買賣日期",
            "code": "股票代號",
            "name": "名稱",
            "pre_close": "最後交易日之收盤價格",
            "ref_price": "減資恢復買賣開始日參考價格",
            "reason": "減資原因",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price"], dates=["date"])
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[CAPRED_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 上櫃注意股
def parse_attention(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(ATTENTION_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {"code": "證券代號", "name": "證券名稱", "count": "累計", "reason": "注意交易資訊", "date": "公告日期"},
    )
    df = finalize(df, numeric=["count"], dates=["date"])
    df["reason"] = [strip_tags(str(v).replace("<br>", "；")) for v in df["reason"]]
    return ParseResult(df[ATTENTION_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 上櫃處置股
_LINK = re.compile(r"\(.*?\)")


def parse_disposition(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(DISPOSITION_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "announce_date": "公布日期",
            "code": "證券代號",
            "name": "證券名稱",
            "count": "累計",
            "period": "處置起訖時間",
            "reason": "處置原因",
            "detail": "處置內容",
        },
    )
    df["name"] = [_LINK.sub("", str(v)) for v in df["name"]]
    df = finalize(df, numeric=["count"], dates=["announce_date"])
    periods = [split_period(p) for p in df["period"]]
    df["start"] = [p[0] for p in periods]
    df["end"] = [p[1] for p in periods]
    df["reason"] = [strip_tags(v) for v in df["reason"]]
    df["measure"] = ["第二次處置" if "第二次" in str(v) or "所有投資人" in str(v) else "處置" for v in df["detail"]]
    df["interval_minutes"] = [match_interval_minutes(v) for v in df["detail"]]
    df["detail"] = [strip_tags(v).replace("\n", " ")[:400] for v in df["detail"]]
    return ParseResult(df[DISPOSITION_COLS].reset_index(drop=True))


# ---------------------------------------------------------------- 上櫃注意累計可能達處置
def parse_attention_accum(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(ACCUM_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {"code": "證券代號", "name": "證券名稱", "situation": "近期達本公司「公布注意交易資訊」標準之情形"},
    )
    return ParseResult(finalize(df)[ACCUM_COLS].reset_index(drop=True), response_date=parse_date(t.get("date")))


# ---------------------------------------------------------------- 櫃買指數（月查詢）
TPEX_INDEX_COLS = ["date", "name", "kind", "open", "high", "low", "close", "change"]


def parse_index(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(TPEX_INDEX_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {"date": "日期", "open": "開市", "high": "最高", "low": "最低", "close": "收市", "change": "漲/跌"},
    )
    df = finalize(df, numeric=["open", "high", "low", "close", "change"], dates=["date"], code_col="__none__")
    df["name"] = "櫃買指數"
    df["kind"] = "price"
    return ParseResult(df[TPEX_INDEX_COLS].reset_index(drop=True))


def parse_reward_index(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    """OpenAPI tpex_reward_index：當月櫃買指數與櫃買報酬指數。"""
    rows = load_json(payload)
    out = []
    for r in rows:
        d = parse_date(r.get("Date"))
        if not d:
            continue
        out.append({"date": d.isoformat(), "name": "櫃買指數", "kind": "price", "close": to_num(r.get("TPExIndex"))})
        out.append(
            {
                "date": d.isoformat(),
                "name": "櫃買報酬指數",
                "kind": "return",
                "close": to_num(r.get("TPExTotalReturnIndex")),
            }
        )
    return ParseResult(pd.DataFrame(out, columns=["date", "name", "kind", "close"]))


# ---------------------------------------------------------------- 上櫃公司基本資料
def parse_company(payload: bytes | str | list[dict[str, Any]]) -> ParseResult:
    rows = load_json(payload)
    if not isinstance(rows, list):
        raise ParseError("mopsfin_t187ap03_O 應為 list")
    df = pd.DataFrame(
        [
            {
                "code": r.get("SecuritiesCompanyCode"),
                "name": r.get("CompanyAbbreviation"),
                "market": "tpex",
                "industry_code": str(r.get("SecuritiesIndustryCode", "")).strip(),
                "capital": r.get("Paidin.Capital.NTDollars"),
                "shares": r.get("IssueShares"),
                "listing_date": r.get("DateOfListing"),
            }
            for r in rows
        ],
        columns=COMPANY_COLS,
    )
    df = finalize(df, numeric=["capital", "shares"], dates=["listing_date"])
    return ParseResult(df.reset_index(drop=True))


# ---------------------------------------------------------------- 上櫃 ETF 分割／反分割結果
def parse_etf_split(payload: bytes | str | dict[str, Any]) -> ParseResult:
    obj = load_json(payload)
    if _tpex_no_data(obj):
        return _empty(SPLIT_COLS, obj)
    t = _first_table(obj)
    df = frame_from_fields(
        t["fields"],
        t.get("data", []),
        {
            "date": "恢復買賣日期",
            "code": "證券代號",
            "name": "證券名稱",
            "pre_close": "最後交易日之收盤價格",
            "ref_price": "恢復買賣開始參考價",
        },
    )
    df = finalize(df, numeric=["pre_close", "ref_price"], dates=["date"])
    df["kind"] = "分割"
    df["factor"] = df["ref_price"] / df["pre_close"]
    return ParseResult(df[SPLIT_COLS].reset_index(drop=True))
