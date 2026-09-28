"""進階資料 parser：以真實樣本驗證。"""

from __future__ import annotations

from datetime import date

import pytest

from pipeline.sources import advanced as adv
from pipeline.sources.base import ParseError
from tests.pipeline.conftest import sample


def row(df, **kw):
    sel = df
    for k, v in kw.items():
        sel = sel[sel[k] == v]
    assert len(sel) == 1, f"{kw} → {len(sel)} 列"
    return sel.iloc[0]


def test_sbl():
    t = adv.parse_twse_sbl(sample("twse_rwd_TWT93U.json"))
    assert t.response_date == date(2026, 9, 24)
    r = row(t.df, code="00400A")
    assert r["short_balance"] == 64000 and r["sbl_prev"] == 29009000 and r["sbl_sell"] == 1000
    assert r["sbl_return"] == 2290000 and r["sbl_balance"] == 26720000
    # 借券賣出餘額恆等式：前日 + 賣出 − 還券 + 調整 = 當日
    df = t.df
    diff = (df["sbl_prev"] + df["sbl_sell"] - df["sbl_return"] + df["sbl_adjust"] - df["sbl_balance"]).abs()
    assert (diff < 1).mean() > 0.95
    o = adv.parse_tpex_sbl(sample("tpex_sbl.json"))
    assert row(o.df, code="00411A")["sbl_balance"] == 140000


def test_qfii():
    t = adv.parse_twse_qfii(sample("twse_rwd_MI_QFIIS.json"))
    r = row(t.df, code="00400A")
    assert r["foreign_pct"] == pytest.approx(2.49) and r["foreign_shares"] == 46360151
    o = adv.parse_tpex_qfii(sample("tpex_qfii.json"))
    assert row(o.df, code="8455")["foreign_pct"] == pytest.approx(87.84)


def test_daytrade():
    t = adv.parse_twse_daytrade(sample("twse_rwd_TWTB4U.json"))
    r = row(t.df, code="00400A")
    assert r["dt_volume"] == 3196000 and r["dt_buy_value"] == 49755490
    assert t.extras["twse_daytrade_total"].iloc[0]["dt_volume_pct"] == pytest.approx(21.63)
    o = adv.parse_tpex_daytrade(sample("tpex_daytrade.json"))
    assert row(o.df, code="00411A")["dt_volume"] == 313000
    assert o.extras["tpex_daytrade_total"].iloc[0]["dt_volume_pct"] == pytest.approx(19.33)


def test_short_halt():
    t = adv.parse_twse_short_halt(sample("twse_rwd_BFI84U.json")).df
    r = row(t, code="00400A")
    assert r["last_cover_date"] == "2026-10-02" and r["end"] == "2026-10-07" and r["reason"] == "分配收益"
    o = adv.parse_tpex_short_halt(sample("tpex_openapi_margin_term.json")).df
    assert row(o, code="00950B")["last_cover_date"] == "2026-09-29"


def test_insider():
    t = adv.parse_insider(sample("twse_openapi_t187ap12_L.json")).df
    r = row(t, code="2892")
    assert r["shares"] == 259000 and r["start"] == "2026-09-27" and r["end"] == "2026-10-26"
    assert adv.parse_insider(sample("tpex_openapi_t187ap12_O.json")).df.empty  # 空白列略過


def test_tdcc():
    t = adv.parse_tdcc(sample("tdcc_1-5.csv"))
    assert t.response_date == date(2026, 9, 24)
    tsmc = t.df[t.df["code"] == "2330"]
    assert set(tsmc["level"]) >= {1, 15, 17}
    assert row(tsmc, level=1)["holders"] == 2471283
    # 分級 1–15 比例合計約 100%
    assert tsmc[tsmc["level"] <= 15]["pct"].sum() == pytest.approx(100, abs=0.5)


def test_taifex():
    ins = adv.parse_taifex_insti(sample("taifex_futContractsDate_MXF.csv")).df
    r = row(ins, date="2026-09-01", party="外資及陸資")
    assert r["contract"] == "MXF" and r["long_oi"] == 6209 and r["short_oi"] == 1203 and r["net_oi"] == 5006
    oi = adv.parse_taifex_oi(sample("taifex_futDataDown_MTX.csv")).df
    assert set(oi["contract"]) == {"MTX"}
    assert oi[oi["date"] == "2026-09-23"].iloc[0]["total_oi"] > 30000
    fx = adv.parse_fx(sample("taifex_dailyFXRate.csv")).df
    assert fx.iloc[0].to_dict() == {"date": "2026-09-01", "usd_twd": 31.633}


def test_treasury():
    t = adv.parse_treasury(sample("treasury_2026.csv")).df
    assert t.iloc[-1].to_dict() == {"date": "2026-09-25", "y10": 5.17}


def test_tdcc_stock_history():
    """集保個股查詢（HTML）：15 個分級＋合計（存成分級 17）；表單的 token 與可查詢週別。"""
    html = sample("tdcc_qryStock_3406.html")
    token, weeks = adv.parse_tdcc_form(html)
    assert token and len(weeks) == 51 and weeks[0] == "20260924" and weeks[-1] == "20251003"
    res = adv.parse_tdcc_stock(html, "3406")
    assert res.response_date == date(2025, 9, 26)
    df = res.df.set_index("level")
    assert list(df.index) == [*range(1, 16), 17]
    assert df.loc[1, "holders"] == 22361 and df.loc[2, "shares"] == 20631425 and df.loc[2, "pct"] == 18.29
    assert df.loc[15, "pct"] == 34.46 and df.loc[17, "holders"] == 35936 and df.loc[17, "shares"] == 112743063
    assert abs(df.loc[1:15, "shares"].sum() - df.loc[17, "shares"]) / df.loc[17, "shares"] < 0.01
    with pytest.raises(ParseError):
        adv.parse_tdcc_stock(html, "2330")  # 回應的代號與要求不符
    assert adv.parse_tdcc_stock("<p>查無此資料</p>", "2330").no_data
