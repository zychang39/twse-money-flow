"""核心資料 parser：以 Actions／本環境抓回的真實樣本驗證。預期值由樣本人工核對。"""

from __future__ import annotations

from datetime import date

import pytest

from pipeline.sources import mops, tpex, twse
from tests.pipeline.conftest import sample


def row(df, code):
    sel = df[df["code"] == code]
    assert len(sel) == 1, f"{code} 應恰有一列，實際 {len(sel)}"
    return sel.iloc[0]


# ------------------------------------------------------------------ 上市
def test_twse_quotes_latest():
    res = twse.parse_quotes(sample("twse_rwd_MI_INDEX_ALL.json"))
    assert res.response_date == date(2026, 9, 24)
    r = row(res.df, "00400A")
    assert r["close"] == 15.66 and r["open"] == 15.55 and r["high"] == 15.66 and r["low"] == 15.47
    assert r["volume"] == 22871974 and r["value"] == 356726371 and r["trades"] == 5535
    assert r["change"] == pytest.approx(0.09)
    assert row(res.df, "00401A")["change"] == pytest.approx(-0.04)
    assert set(res.df["date"]) == {"2026-09-24"}
    idx = res.extras["twse_index"]
    taiex = idx[idx["name"] == "發行量加權股價指數"].iloc[0]
    assert taiex["close"] == 48024.60 and taiex["change"] == pytest.approx(-132.69) and taiex["kind"] == "price"
    tr = idx[idx["name"] == "發行量加權股價報酬指數"].iloc[0]
    assert tr["close"] == 111049.87 and tr["kind"] == "return"


def test_twse_quotes_historical_format_2024():
    res = twse.parse_quotes(sample("twse_rwd_MI_INDEX_ALL_hist.json"))
    assert res.response_date == date(2024, 1, 2)
    r = row(res.df, "0050")
    assert r["close"] == 134.90 and r["change"] == pytest.approx(-0.55)


def test_twse_quotes_no_data():
    res = twse.parse_quotes(b'{"stat":"\xe5\xbe\x88\xe6\x8a\xb1\xe6\xad\x89\xef\xbc\x8c\xe6\xb2\x92\xe6\x9c\x89"}')
    assert res.no_data and res.df.empty


def test_twse_insti():
    res = twse.parse_insti(sample("twse_rwd_T86.json"))
    assert res.response_date == date(2026, 9, 24)
    r = row(res.df, "00403A")
    assert r["foreign_buy"] == 82945186 and r["foreign_sell"] == 18449050 and r["foreign_net"] == 64496136
    assert r["trust_net"] == 0 and r["dealer_net"] == 127820386 and r["dealer_hedge_net"] == 127820386
    assert r["total_net"] == 192316522
    # 三大法人合計 = 外資 + 外資自營 + 投信 + 自營商
    df = res.df
    diff = (df["foreign_net"] + df["foreign_dealer_net"] + df["trust_net"] + df["dealer_net"] - df["total_net"]).abs()
    assert (diff < 1).mean() > 0.99


def test_twse_insti_2024():
    res = twse.parse_insti(sample("twse_rwd_T86_hist.json"))
    assert res.response_date == date(2024, 1, 2)
    assert row(res.df, "2618")["foreign_net"] == 128977962


def test_twse_margin():
    res = twse.parse_margin(sample("twse_rwd_MI_MARGN.json"))
    r = row(res.df, "00400A")
    assert r["margin_buy"] == 225 and r["margin_sell"] == 250 and r["margin_redeem"] == 5
    assert r["margin_prev"] == 8027 and r["margin_balance"] == 7997 and r["margin_limit"] == 464410
    assert r["short_sell"] == 27 and r["short_buy"] == 0 and r["short_prev"] == 37 and r["short_balance"] == 64
    # 餘額恆等式：今日 = 前日 + 買進 − 賣出 − 現償
    df = res.df
    ok = (df["margin_prev"] + df["margin_buy"] - df["margin_sell"] - df["margin_redeem"] - df["margin_balance"]).abs()
    assert (ok < 1).mean() > 0.95
    total = res.extras["twse_margin_total"]
    amount = total[total["item"].str.contains("金額")].iloc[0]
    assert amount["balance"] == 615103402


def test_twse_valuation():
    res = twse.parse_valuation(sample("twse_rwd_BWIBBU_d.json"))
    r = row(res.df, "1101")
    assert r["pe"] != r["pe"]  # '-'（虧損）→ NaN
    assert r["pb"] == 0.82 and r["dividend_yield"] == 3.17 and r["fin_period"] == "115/2"
    assert row(res.df, "1102")["pe"] == 9.86


def test_twse_exright():
    res = twse.parse_exright(sample("twse_rwd_TWT49U.json"))
    r = row(res.df, "00907")
    assert r["date"] == "2026-08-25" and r["pre_close"] == 17.47 and r["ref_price"] == 17.23
    assert r["kind"] == "息" and r["cash_dividend"] == pytest.approx(0.24)
    assert r["factor"] == pytest.approx(17.23 / 17.47)


def test_twse_exright_notice():
    res = twse.parse_exright_notice(sample("twse_rwd_TWT48U.json"))
    r = row(res.df, "00400A")
    assert r["date"] == "2026-10-08" and r["kind"] == "息"
    assert r["cash_dividend"] != r["cash_dividend"]  # 待公告 → NaN


def test_twse_capreduce():
    res = twse.parse_capreduce(sample("twse_rwd_TWTAUU.json"))
    r = row(res.df, "3432")
    assert r["date"] == "2024-01-22" and r["pre_close"] == 10.65 and r["ref_price"] == 19.69
    assert r["factor"] == pytest.approx(19.69 / 10.65)


def test_twse_attention_and_disposition():
    att = twse.parse_attention(sample("twse_rwd_notice.json")).df
    first = att.iloc[0]
    assert first["code"] == "044799" and first["date"] == "2026-08-26" and first["count"] == 1
    disp = twse.parse_disposition(sample("twse_rwd_punish.json")).df
    r = row(disp, "2305")
    assert r["announce_date"] == "2026-09-17" and r["start"] == "2026-09-18" and r["end"] == "2026-09-30"
    assert r["interval_minutes"] == 2 and r["measure"] == "第一次處置"


def test_twse_attention_accum():
    df = twse.parse_attention_accum(sample("twse_openapi_notetrans.json")).df
    assert "1560" in set(df["code"])
    assert "連續二次" in row(df, "1560")["situation"]


def test_twse_holidays_both_formats():
    api = twse.parse_holidays(sample("twse_holidaySchedule.json")).df
    assert "2026-09-25" in set(api["date"])
    assert api[api["date"] == "2026-09-25"].iloc[0]["name"] == "中秋節"
    rwd = twse.parse_holidays(sample("twse_rwd_holiday_2024.json")).df
    assert rwd.iloc[0]["date"] == "2024-01-01"


def test_twse_company():
    df = twse.parse_company(sample("twse_openapi_t187ap03_L.json")).df
    r = row(df, "1101")
    assert r["industry_code"] == "01" and r["shares"] == 7523181742 and r["market"] == "twse"


def test_twse_revenue_openapi():
    df = twse.parse_revenue_openapi(sample("twse_t187ap05_L.json"), "twse").df
    r = row(df, "1101")
    assert r["ym"] == "2026-08" and r["revenue"] == 13515534 and r["report_date"] == "2026-09-17"
    assert r["yoy"] == pytest.approx(10.649053245020621)


def test_mops_revenue_html():
    sii = mops.parse_revenue_html(sample("mops_t21sc03_sii.html")).df
    r = row(sii, "1101")
    assert r["ym"] == "2026-08" and r["market"] == "twse" and r["industry"] == "水泥工業"
    assert r["revenue"] == 13515534 and r["yoy"] == pytest.approx(10.64) and r["cum_revenue"] == 98726969
    otc = mops.parse_revenue_html(sample("mops_t21sc03_otc.html")).df
    assert set(otc["market"]) == {"tpex"} and len(otc) > 10
    hist = mops.parse_revenue_html(sample("mops_t21sc03_sii_hist.html")).df
    assert set(hist["ym"]) == {"2024-01"}


# ------------------------------------------------------------------ 上櫃
def test_tpex_quotes():
    res = tpex.parse_quotes(sample("tpex_dailyQuotes.json"))
    assert res.response_date == date(2026, 9, 24)
    r = row(res.df, "00411A")
    assert r["close"] == 10.47 and r["change"] == pytest.approx(-0.03) and r["volume"] == 8329797
    assert r["value"] == 87225652 and r["shares"] == 441076000 and r["avg"] == 10.47
    codes = set(res.df["code"])
    assert "22211" not in codes  # 可轉債排除


def test_tpex_quotes_2024():
    res = tpex.parse_quotes(sample("tpex_dailyQuotes_hist.json"))
    assert res.response_date == date(2024, 1, 2)
    assert row(res.df, "006201")["close"] == 19.77


def test_tpex_insti():
    res = tpex.parse_insti(sample("tpex_insti.json"))
    r = row(res.df, "00411A")
    assert r["foreign_net"] == 1169000 and r["foreign_dealer_net"] == 0 and r["trust_net"] == 0
    assert r["dealer_hedge_net"] == 1441820 and r["dealer_net"] == 1441820 and r["total_net"] == 2610820
    hist = tpex.parse_insti(sample("tpex_insti_hist.json"))
    assert row(hist.df, "00679B")["dealer_net"] == -10191887


def test_tpex_margin():
    res = tpex.parse_margin(sample("tpex_margin.json"))
    r = row(res.df, "00411A")
    assert r["margin_prev"] == 5455 and r["margin_buy"] == 123 and r["margin_sell"] == 103
    assert r["margin_balance"] == 5475 and r["margin_usage"] == 5.27 and r["short_balance"] == 11
    tot = res.extras["tpex_margin_total"]
    assert tot.iloc[0]["balance"] == 2349052


def test_tpex_valuation():
    r = row(tpex.parse_valuation(sample("tpex_pe.json")).df, "1240")
    assert r["pe"] == 10.26 and r["dividend_yield"] == 0.91 and r["pb"] == 1.63


def test_tpex_exright_and_capreduce():
    ex = tpex.parse_exright(sample("tpex_exDailyQ.json")).df
    r = row(ex, "2729")
    assert r["date"] == "2026-08-25" and r["cash_dividend"] == pytest.approx(6.930038) and r["kind"] == "息"
    assert r["factor"] == pytest.approx(155.57 / 162.5)
    cr = tpex.parse_capreduce(sample("tpex_revivt.json")).df
    r = row(cr, "3064")
    assert r["date"] == "2024-02-05" and r["ref_price"] == 35.5 and r["factor"] == pytest.approx(35.5 / 10.65)


def test_tpex_attention_disposition_warning():
    att = tpex.parse_attention(sample("tpex_attention.json")).df
    assert row(att[att["date"] == "2026-09-24"], "2221")["count"] == 20
    disp = tpex.parse_disposition(sample("tpex_disposal.json")).df
    r = disp[disp["code"] == "2221"].iloc[0]
    assert r["name"] == "大甲" and r["start"] == "2026-09-24" and r["end"] == "2026-10-06"
    assert r["interval_minutes"] == 2
    warn = tpex.parse_attention_accum(sample("tpex_warning.json")).df
    assert set(warn["code"]) == {"22211", "30165", *set(warn["code"])}


def test_tpex_index_and_company():
    idx = tpex.parse_index(sample("tpex_inx.json")).df
    assert idx.iloc[0]["date"] == "2026-09-01" and idx.iloc[0]["close"] == 410.77
    rw = tpex.parse_reward_index(sample("tpex_openapi_reward_index.json")).df
    assert set(rw["kind"]) == {"price", "return"}
    comp = tpex.parse_company(sample("tpex_openapi_t187ap03_O.json")).df
    assert row(comp, "1240")["industry_code"] == "33"


def test_twse_parchange_and_etf_split():
    pc = twse.parse_parchange(sample("twse_rwd_TWTB8U.json")).df
    r = row(pc, "8070")
    assert r["date"] == "2020-08-17" and r["factor"] == pytest.approx(19 / 190)
    sp = twse.parse_etf_split(sample("twse_rwd_TWTCAU.json")).df
    r = row(sp, "0050")
    assert r["date"] == "2025-06-18" and r["kind"] == "分割" and r["factor"] == pytest.approx(47.16 / 188.65)
    assert row(sp, "00632R")["kind"] == "反分割"
    empty = tpex.parse_etf_split(sample("tpex_etfSplitRslt.json"))
    assert empty.df.empty
