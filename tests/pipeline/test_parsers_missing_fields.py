"""D-02：每個解析器都經過共用欄位工具——必要欄位缺少丟 ParseError、選用欄位缺少補空值並記錄格式變動警告。

一律從真實樣本出發，只在記憶體中改動（拿掉 key／改欄名／刪 CSV 欄位），不動 fixtures。
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Callable
from datetime import date
from typing import Any

import pandas as pd
import pytest

from pipeline.sources import advanced as adv
from pipeline.sources import etf_holdings as eh
from pipeline.sources import mops, optional, tpex, twse
from pipeline.sources.base import (
    ParseError,
    ParseResult,
    collect_format_warnings,
    frame_from_records,
    opt,
)
from tests.pipeline.conftest import sample


# ------------------------------------------------------------------ 樣本改動工具
def records(name: str) -> list[dict[str, Any]]:
    return json.loads(sample(name).decode("utf-8-sig"))


def drop_key(rows: list[dict[str, Any]], key: str) -> str:
    """每筆紀錄都拿掉 key（模擬來源移除欄位）。"""
    assert any(key in r for r in rows), key
    return json.dumps([{k: v for k, v in r.items() if k != key} for r in rows], ensure_ascii=False)


def text(name: str, encoding: str = "utf-8-sig") -> str:
    return sample(name).decode(encoding, errors="replace")


def drop_csv_column(src: str, column: str) -> str:
    """刪掉 CSV 的一欄（表頭與每一列同位置）。"""
    rows = list(csv.reader(io.StringIO(src)))
    i = rows[0].index(column)
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows([r[:i] + r[i + 1 :] for r in rows])
    return buf.getvalue()


def rename(src: str, old: str, new: str) -> str:
    assert old in src, old
    return src.replace(old, new)


def json_edit(name: str, edit: Callable[[Any], None]) -> str:
    obj = json.loads(sample(name).decode("utf-8-sig"))
    edit(obj)
    return json.dumps(obj, ensure_ascii=False)


def _nomura_rename(old: str, new: str) -> Callable[[Any], None]:
    def edit(obj: Any) -> None:
        stock = next(t for t in obj["Entries"]["Data"]["Table"] if t.get("TableTitle") == "股票")
        for c in stock["Columns"]:
            if c["Name"] == old:
                c["Name"] = new

    return edit


def _drop_in(path: tuple[str, ...], key: str) -> Callable[[Any], None]:
    def edit(obj: Any) -> None:
        node = obj
        for p in path:
            node = node[p]
        assert any(key in r for r in node), key
        for r in node:
            r.pop(key, None)

    return edit


TAIFEX_INSTI = text("taifex_futContractsDate_MXF.csv", "cp950")
TAIFEX_OI = text("taifex_futDataDown_MTX.csv", "cp950")
TAIFEX_FX = text("taifex_dailyFXRate.csv", "cp950")
TDCC = text("tdcc_1-5.csv")
TDCC_STOCK = text("tdcc_qryStock_3406.html", "utf-8")
TREASURY = text("treasury_2026.csv")
CBC = text("cbc_EF15M01.csv")
MOPS_SII = text("mops_t21sc03_sii.html", "cp950")
CONF = text("mops_t100sb02_get.html", "utf-8")
FUBON = text("etf_fubon_00405A.html", "utf-8")
D = date(2026, 9, 24)

# ------------------------------------------------------------------ 必要欄位缺少 → ParseError
REQUIRED: list[Any] = [
    # advanced
    pytest.param(
        lambda: adv.parse_tpex_short_halt(
            drop_key(records("tpex_openapi_margin_term.json"), "ShortSaleSuspensionStartDate")
        ),
        id="tpex_short_halt-停券起日",
    ),
    pytest.param(
        lambda: adv.parse_tpex_short_halt(drop_key(records("tpex_openapi_margin_term.json"), "SecuritiesCompanyCode")),
        id="tpex_short_halt-代號",
    ),
    pytest.param(lambda: adv.parse_tpex_short_halt(b'{"a": 1}'), id="tpex_short_halt-非list"),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("twse_openapi_t187ap12_L.json"), "公司代號")), id="insider-公司代號"
    ),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("twse_openapi_t187ap12_L.json"), "姓名")), id="insider-姓名"
    ),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("twse_openapi_t187ap12_L.json"), "有效轉讓期間")),
        id="insider-有效轉讓期間",
    ),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("tpex_openapi_t187ap12_O.json"), "SecuritiesCompanyCode")),
        id="insider-上櫃代號",
    ),
    pytest.param(lambda: adv.parse_tdcc(drop_csv_column(TDCC, "占集保庫存數比例%")), id="tdcc-比例"),
    pytest.param(lambda: adv.parse_tdcc(rename(TDCC, "持股分級", "分級")), id="tdcc-持股分級"),
    pytest.param(lambda: adv.parse_tdcc(drop_csv_column(TDCC, "證券代號")), id="tdcc-證券代號"),
    pytest.param(
        lambda: adv.parse_tdcc_stock(rename(TDCC_STOCK, "<th>占集保庫存數比例 (%)</th>", "<th>比例</th>"), "3406"),
        id="tdcc_stock-比例",
    ),
    pytest.param(
        lambda: adv.parse_tdcc_stock(rename(TDCC_STOCK, "<th>序</th>", "<th>編號</th>"), "3406"), id="tdcc_stock-序"
    ),
    pytest.param(lambda: adv.parse_taifex_insti(drop_csv_column(TAIFEX_INSTI, "身份別")), id="taifex_insti-身份別"),
    pytest.param(
        lambda: adv.parse_taifex_insti(drop_csv_column(TAIFEX_INSTI, "多空未平倉口數淨額")), id="taifex_insti-淨額"
    ),
    pytest.param(lambda: adv.parse_taifex_insti(drop_csv_column(TAIFEX_INSTI, "日期")), id="taifex_insti-日期"),
    pytest.param(lambda: adv.parse_taifex_oi(drop_csv_column(TAIFEX_OI, "未沖銷契約數")), id="taifex_oi-未沖銷"),
    pytest.param(lambda: adv.parse_taifex_oi(drop_csv_column(TAIFEX_OI, "交易時段")), id="taifex_oi-交易時段"),
    pytest.param(lambda: adv.parse_fx(drop_csv_column(TAIFEX_FX, "美元∕新台幣")), id="fx-美元"),
    pytest.param(lambda: adv.parse_fx(rename(TAIFEX_FX, "日期,", "Date,")), id="fx-日期"),
    pytest.param(lambda: adv.parse_treasury(drop_csv_column(TREASURY, "10 Yr")), id="treasury-10Yr"),
    pytest.param(lambda: adv.parse_treasury(drop_csv_column(TREASURY, "Date")), id="treasury-Date"),
    # etf_holdings
    pytest.param(
        lambda: eh.parse_nomura(json_edit("etf_nomura_00980A.json", _nomura_rename("股數", "持股數")), "00980A"),
        id="nomura-股數",
    ),
    pytest.param(
        lambda: eh.parse_nomura(json_edit("etf_nomura_00980A.json", _nomura_rename("股票代號", "代號")), "00980A"),
        id="nomura-代號",
    ),
    pytest.param(
        lambda: eh.parse_capital(json_edit("etf_capital_399.json", _drop_in(("data", "stocks"), "share")), "00982A"),
        id="capital-share",
    ),
    pytest.param(
        lambda: eh.parse_capital(json_edit("etf_capital_399.json", _drop_in(("data", "stocks"), "stocNo")), "00982A"),
        id="capital-stocNo",
    ),
    pytest.param(
        lambda: eh.parse_yuanta(
            json_edit("etf_yuanta_00990A.json", _drop_in(("FundWeights", "StockWeights"), "qty")), "00990A"
        ),
        id="yuanta-qty",
    ),
    pytest.param(
        lambda: eh.parse_yuanta(
            json_edit("etf_yuanta_00990A.json", _drop_in(("FundWeights", "StockWeights"), "code")), "00990A"
        ),
        id="yuanta-code",
    ),
    pytest.param(
        lambda: eh.parse_fubon(rename(FUBON, '<td class="">股數</td>', '<td class="">持有股數</td>'), "00405A"),
        id="fubon-股數",
    ),
    pytest.param(
        lambda: eh.parse_fubon(rename(FUBON, '<td class="tac">股票代碼</td>', '<td class="tac">代碼</td>'), "00405A"),
        id="fubon-股票代碼",
    ),
    pytest.param(
        lambda: eh.parse_cathay(json_edit("etf_cathay_EA.json", _drop_in(("result",), "volumn")), "00400A", D),
        id="cathay-volumn",
    ),
    pytest.param(
        lambda: eh.parse_cathay(json_edit("etf_cathay_EA.json", _drop_in(("result",), "stockCode")), "00400A", D),
        id="cathay-stockCode",
    ),
    # mops
    pytest.param(
        lambda: mops.parse_revenue_html(rename(MOPS_SII, ">當月營收</th>", ">本月營收</th>")),
        id="mops_revenue-當月營收",
    ),
    pytest.param(
        lambda: mops.parse_revenue_html(rename(MOPS_SII, ">去年同月<br>增減(%)</th>", ">年增率</th>")),
        id="mops_revenue-去年同月增減",
    ),
    pytest.param(
        lambda: mops.parse_revenue_html(rename(MOPS_SII, ">公司<br>代號</th>", ">證券<br>代號</th>")),
        id="mops_revenue-公司代號",
    ),
    pytest.param(
        lambda: mops.parse_revenue_html(rename(MOPS_SII, "<th class=tt>公司<br>代號</th>", "<td>公司代號</td>")),
        id="mops_revenue-找不到表頭",
    ),
    # optional
    pytest.param(lambda: optional.parse_cbc_money(drop_csv_column(CBC, "貨幣總計數 -Ｍ２-年增率")), id="cbc-M2年增率"),
    pytest.param(lambda: optional.parse_cbc_money(drop_csv_column(CBC, "貨幣總計數 -Ｍ１Ｂ-原始值")), id="cbc-M1B"),
    pytest.param(
        lambda: optional.parse_conference(rename(CONF, "<b>召開法人說明會日期</b>", "<b>日期</b>")),
        id="conference-日期",
    ),
    pytest.param(
        lambda: optional.parse_conference(rename(CONF, "<b>公司代號</b>", "<b>證券代號</b>")), id="conference-公司代號"
    ),
    # tpex
    pytest.param(
        lambda: tpex.parse_exright_notice(
            drop_key(records("tpex_openapi_exright_prepost.json"), "ExRrightsExDividendDate")
        ),
        id="tpex_exright_notice-日期",
    ),
    pytest.param(
        lambda: tpex.parse_exright_notice(
            drop_key(records("tpex_openapi_exright_prepost.json"), "SecuritiesCompanyCode")
        ),
        id="tpex_exright_notice-代號",
    ),
    pytest.param(
        lambda: tpex.parse_reward_index(drop_key(records("tpex_openapi_reward_index.json"), "TPExTotalReturnIndex")),
        id="tpex_reward_index-報酬指數",
    ),
    pytest.param(
        lambda: tpex.parse_reward_index(drop_key(records("tpex_openapi_reward_index.json"), "Date")),
        id="tpex_reward_index-Date",
    ),
    pytest.param(
        lambda: tpex.parse_company(drop_key(records("tpex_openapi_t187ap03_O.json"), "SecuritiesIndustryCode")),
        id="tpex_company-產業別",
    ),
    pytest.param(
        lambda: tpex.parse_company(drop_key(records("tpex_openapi_t187ap03_O.json"), "SecuritiesCompanyCode")),
        id="tpex_company-代號",
    ),
    # twse
    pytest.param(
        lambda: twse.parse_attention_accum(
            drop_key(records("twse_openapi_notetrans.json"), "RecentlyMetAttentionSecuritiesCriteria")
        ),
        id="twse_attention_accum-情形",
    ),
    pytest.param(
        lambda: twse.parse_attention_accum(drop_key(records("twse_openapi_notetrans.json"), "Code")),
        id="twse_attention_accum-Code",
    ),
    pytest.param(
        lambda: twse.parse_company(drop_key(records("twse_openapi_t187ap03_L.json"), "產業別")),
        id="twse_company-產業別",
    ),
    pytest.param(
        lambda: twse.parse_company(drop_key(records("twse_openapi_t187ap03_L.json"), "公司代號")),
        id="twse_company-公司代號",
    ),
    pytest.param(
        lambda: twse.parse_revenue_openapi(drop_key(records("twse_t187ap05_L.json"), "營業收入-當月營收"), "twse"),
        id="revenue_openapi-當月營收",
    ),
    pytest.param(
        lambda: twse.parse_revenue_openapi(drop_key(records("twse_t187ap05_L.json"), "資料年月"), "twse"),
        id="revenue_openapi-資料年月",
    ),
    pytest.param(
        lambda: twse.parse_revenue_openapi(
            drop_key(records("tpex_openapi_t187ap05_O.json"), "營業收入-去年同月增減(%)"), "tpex"
        ),
        id="revenue_openapi-去年同月增減",
    ),
]


@pytest.mark.parametrize("parse", REQUIRED)
def test_missing_required_field_raises_parse_error(parse: Callable[[], ParseResult]) -> None:
    with pytest.raises(ParseError):
        parse()


# ------------------------------------------------------------------ 選用欄位缺少 → 繼續解析、該欄為空值、記錄警告
OPTIONAL: list[Any] = [
    pytest.param(
        lambda: adv.parse_tpex_short_halt(drop_key(records("tpex_openapi_margin_term.json"), "Reason")),
        "Reason",
        "reason",
        id="tpex_short_halt-Reason",
    ),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("twse_openapi_t187ap12_L.json"), "預定轉讓方式及股數-轉讓股數")),
        "轉讓股數",
        "shares",
        id="insider-轉讓股數",
    ),
    pytest.param(
        lambda: adv.parse_insider(drop_key(records("twse_openapi_t187ap12_L.json"), "出表日期")),
        "出表日期",
        "report_date",
        id="insider-出表日期",
    ),
    pytest.param(lambda: adv.parse_tdcc(drop_csv_column(TDCC, "人數")), "人數", "holders", id="tdcc-人數"),
    pytest.param(
        lambda: adv.parse_tdcc_stock(rename(TDCC_STOCK, "<th>人數</th>", "<th>戶數</th>"), "3406"),
        "人數",
        "holders",
        id="tdcc_stock-人數",
    ),
    pytest.param(
        lambda: adv.parse_taifex_insti(drop_csv_column(TAIFEX_INSTI, "多方交易口數")),
        "多方交易口數",
        "long_vol",
        id="taifex_insti-多方交易口數",
    ),
    pytest.param(
        lambda: adv.parse_taifex_oi(drop_csv_column(TAIFEX_OI, "成交量")), "成交量", "volume", id="taifex_oi-成交量"
    ),
    pytest.param(
        lambda: eh.parse_nomura(json_edit("etf_nomura_00980A.json", _nomura_rename("權重(%)", "比重")), "00980A"),
        "權重",
        "weight",
        id="nomura-權重",
    ),
    pytest.param(
        lambda: eh.parse_capital(json_edit("etf_capital_399.json", _drop_in(("data", "stocks"), "weight")), "00982A"),
        "weight",
        "weight",
        id="capital-weight",
    ),
    pytest.param(
        lambda: eh.parse_yuanta(
            json_edit("etf_yuanta_00990A.json", _drop_in(("FundWeights", "StockWeights"), "weights")), "00990A"
        ),
        "weights",
        "weight",
        id="yuanta-weights",
    ),
    pytest.param(
        lambda: eh.parse_fubon(rename(FUBON, '<td class="">權重(%)</td>', '<td class="">比重</td>'), "00405A"),
        "權重",
        "weight",
        id="fubon-權重",
    ),
    pytest.param(
        lambda: eh.parse_cathay(json_edit("etf_cathay_EA.json", _drop_in(("result",), "weights")), "00400A", D),
        "weights",
        "weight",
        id="cathay-weights",
    ),
    pytest.param(
        lambda: mops.parse_revenue_html(rename(MOPS_SII, ">上月營收</th>", ">前月營收</th>")),
        "上月營收",
        "revenue_prev_month",
        id="mops_revenue-上月營收",
    ),
    pytest.param(
        lambda: optional.parse_conference(rename(CONF, "<b>召開法人說明會地點</b>", "<b>地點</b>")),
        "地點",
        "place",
        id="conference-地點",
    ),
    pytest.param(
        lambda: tpex.parse_exright_notice(drop_key(records("tpex_openapi_exright_prepost.json"), "CashDividend")),
        "CashDividend",
        "cash_dividend",
        id="tpex_exright_notice-CashDividend",
    ),
    pytest.param(
        lambda: tpex.parse_company(drop_key(records("tpex_openapi_t187ap03_O.json"), "IssueShares")),
        "IssueShares",
        "shares",
        id="tpex_company-IssueShares",
    ),
    pytest.param(
        lambda: twse.parse_attention_accum(drop_key(records("twse_openapi_notetrans.json"), "Name")),
        "Name",
        "name",
        id="twse_attention_accum-Name",
    ),
    pytest.param(
        lambda: twse.parse_company(drop_key(records("twse_openapi_t187ap03_L.json"), "上市日期")),
        "上市日期",
        "listing_date",
        id="twse_company-上市日期",
    ),
    pytest.param(
        lambda: twse.parse_revenue_openapi(drop_key(records("twse_t187ap05_L.json"), "營業收入-上月營收"), "twse"),
        "上月營收",
        "revenue_prev_month",
        id="revenue_openapi-上月營收",
    ),
]


def _is_blank(v: Any) -> bool:
    return v is None or v == "" or bool(pd.isna(v))


@pytest.mark.parametrize(("parse", "warning", "column"), OPTIONAL)
def test_missing_optional_field_is_null_with_warning(
    parse: Callable[[], ParseResult], warning: str, column: str
) -> None:
    with collect_format_warnings() as w:
        res = parse()
    assert not res.df.empty and not res.no_data
    assert all(_is_blank(v) for v in res.df[column]), res.df[column].head()
    assert any(warning in m and "缺少" in m for m in w), w


# ------------------------------------------------------------------ 正常樣本不應有格式警告（上市／上櫃兩種欄名都是正常格式）
CLEAN: list[Any] = [
    pytest.param(lambda: adv.parse_insider(sample("twse_openapi_t187ap12_L.json")), id="insider-上市"),
    pytest.param(lambda: adv.parse_insider(sample("tpex_openapi_t187ap12_O.json")), id="insider-上櫃"),
    pytest.param(lambda: adv.parse_tpex_short_halt(sample("tpex_openapi_margin_term.json")), id="tpex_short_halt"),
    pytest.param(lambda: adv.parse_tdcc(sample("tdcc_1-5.csv")), id="tdcc"),
    pytest.param(lambda: adv.parse_tdcc_stock(sample("tdcc_qryStock_3406.html"), "3406"), id="tdcc_stock"),
    pytest.param(lambda: adv.parse_taifex_insti(sample("taifex_futContractsDate_TXF.csv")), id="taifex_insti"),
    pytest.param(lambda: adv.parse_taifex_oi(sample("taifex_futDataDown_TMF.csv")), id="taifex_oi"),
    pytest.param(lambda: adv.parse_fx(sample("taifex_dailyFXRate.csv")), id="fx"),
    pytest.param(lambda: adv.parse_treasury(sample("treasury_2026.csv")), id="treasury"),
    pytest.param(lambda: eh.parse_nomura(sample("etf_nomura_00980A.json"), "00980A"), id="nomura"),
    pytest.param(lambda: eh.parse_capital(sample("etf_capital_399.json"), "00982A"), id="capital"),
    pytest.param(lambda: eh.parse_yuanta(sample("etf_yuanta_00990A.json"), "00990A"), id="yuanta"),
    pytest.param(lambda: eh.parse_fubon(sample("etf_fubon_00405A.html"), "00405A"), id="fubon"),
    pytest.param(lambda: eh.parse_cathay(sample("etf_cathay_EA.json"), "00400A", D), id="cathay"),
    pytest.param(lambda: mops.parse_revenue_html(sample("mops_t21sc03_otc.html")), id="mops_revenue"),
    pytest.param(lambda: optional.parse_cbc_money(sample("cbc_EF15M01.csv")), id="cbc"),
    pytest.param(lambda: optional.parse_conference(sample("mops_t100sb02_get.html")), id="conference"),
    pytest.param(lambda: tpex.parse_exright_notice(sample("tpex_openapi_exright_prepost.json")), id="tpex_notice"),
    pytest.param(lambda: tpex.parse_reward_index(sample("tpex_openapi_reward_index.json")), id="tpex_reward_index"),
    pytest.param(lambda: tpex.parse_company(sample("tpex_openapi_t187ap03_O.json")), id="tpex_company"),
    pytest.param(lambda: twse.parse_attention_accum(sample("twse_openapi_notetrans.json")), id="twse_accum"),
    pytest.param(lambda: twse.parse_company(sample("twse_openapi_t187ap03_L.json")), id="twse_company"),
    pytest.param(lambda: twse.parse_revenue_openapi(sample("tpex_openapi_t187ap05_O.json"), "tpex"), id="revenue"),
]


@pytest.mark.parametrize("parse", CLEAN)
def test_real_samples_parse_without_format_warnings(parse: Callable[[], ParseResult]) -> None:
    with collect_format_warnings() as w:
        parse()
    assert w == []


# ------------------------------------------------------------------ 查無資料／0 筆（D-04）
def test_taifex_header_only_is_no_data() -> None:
    header = TAIFEX_INSTI.splitlines()[0] + "\n"
    res = adv.parse_taifex_insti(header)
    assert res.no_data and res.df.empty and list(res.df.columns) == adv.FUT_INSTI_COLS
    assert adv.parse_taifex_oi(TAIFEX_OI.splitlines()[0] + "\n").no_data
    assert adv.parse_fx(TAIFEX_FX.splitlines()[0] + "\n").no_data


def test_mops_revenue_not_published_is_no_data() -> None:
    html = (
        "<html><body><center><b>上市公司 115 年 9 月份營業收入彙總表</b></center>"
        "<table><tr><td><font color=red>查無資料</font></td></tr></table></body></html>"
    )
    res = mops.parse_revenue_html(html.encode("cp950"))
    assert res.no_data and res.df.empty and res.message == "查無資料"
    assert list(res.df.columns) == twse.REVENUE_COLS


def test_tdcc_non_integer_level_raises_parse_error() -> None:
    bad = TDCC.replace("20260924,000218,1,", "20260924,000218,一,", 1)
    with pytest.raises(ParseError, match="持股分級"):
        adv.parse_tdcc(bad)


# ------------------------------------------------------------------ frame_from_records
def test_frame_from_records_union_of_keys_and_types() -> None:
    rows = [{"Code": "2330", "Name": "台積電"}, {"Code": "2317", "Extra": 1, "Name": None}]
    df = frame_from_records(rows, {"code": "Code", "name": opt("Name"), "extra": opt("Extra")})
    assert list(df.columns) == ["code", "name", "extra"]
    assert list(df["code"]) == ["2330", "2317"]
    assert df["name"].iloc[0] == "台積電" and pd.isna(df["name"].iloc[1])
    raw = frame_from_records(rows, {"code": "Code", "name": opt("Name")}, infer_types=False)
    assert raw["name"].iloc[1] is None and raw["code"].dtype == object


def test_frame_from_records_errors_and_empty() -> None:
    with pytest.raises(ParseError, match="list"):
        frame_from_records({"Code": "2330"}, {"code": "Code"})
    with pytest.raises(ParseError, match="dict"):
        frame_from_records(["2330"], {"code": "Code"})
    with pytest.raises(ParseError, match="Code"):
        frame_from_records([{"code": "2330"}], {"code": "Code"})
    empty = frame_from_records([], {"code": "Code", "name": opt("Name")})
    assert empty.empty and list(empty.columns) == ["code", "name"]
