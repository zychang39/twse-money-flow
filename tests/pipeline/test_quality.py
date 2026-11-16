"""生意體質：財報新欄位解析、簡式 ROIC、近四季、類型分類、風險旗標、舊檔相容（2026-11；DECISIONS #470）。"""

from __future__ import annotations

from datetime import date
from statistics import median

import pandas as pd
import pytest

from pipeline import financials, tasks_advanced
from pipeline.derive import flags, quality
from pipeline.sources import optional
from tests.pipeline.conftest import sample
from tests.pipeline.test_tasks import make_ctx


def _fin(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def _row(code: str, y: int, q: int, **kw: float | None) -> dict:
    base = {
        "code": code,
        "year": y,
        "quarter": q,
        "revenue": 1000.0 * q,
        "gross_profit": 300.0 * q,
        "ni_parent": 80.0 * q,
        "eps": 1.0 * q,
        "equity_parent": 800.0,
        "op_income": 100.0 * q,
        "pretax": 100.0 * q,
        "tax": 20.0 * q,
        "total_assets": 1500.0,
        "cur_liab": 500.0,
    }
    return {**base, **kw}


def test_parser_keeps_new_columns_across_formats():
    inc = financials.parse_statement(sample("mops_t163sb04_get.html"), "income")
    bal = financials.parse_statement(sample("mops_t163sb05_get.html"), "balance")
    tsmc_i, tsmc_b = inc[inc["code"] == "2330"].iloc[0], bal[bal["code"] == "2330"].iloc[0]
    # 2026 年第 2 季（上半年累計；千元）：營業利益、稅前淨利、所得稅、資產總計、流動負債
    assert tsmc_i["op_income"] > 0 and tsmc_i["pretax"] > tsmc_i["tax"] > 0
    assert tsmc_i["op_income"] / tsmc_i["revenue"] == pytest.approx(0.593, abs=0.001)
    assert tsmc_b["total_assets"] > tsmc_b["cur_liab"] > 0
    assert tsmc_b["total_assets"] == pytest.approx(tsmc_b["total_liab"] + tsmc_b["equity_total"], rel=1e-9)
    # 金融業格式：沒有營業利益與流動負債，但有資產總額與稅前淨利
    bank_i, bank_b = inc[inc["code"] == "2801"].iloc[0], bal[bal["code"] == "2801"].iloc[0]
    assert bank_i["op_income"] is None or bank_i["op_income"] != bank_i["op_income"]
    assert bank_i["pretax"] > 0 and bank_i["tax"] > 0
    assert bank_b["total_assets"] > 0
    assert bank_b["cur_liab"] is None or bank_b["cur_liab"] != bank_b["cur_liab"]
    # 既有欄位不變
    assert inc[inc["code"] == "1101"].iloc[0]["revenue"] == 71289957
    assert bal[bal["code"] == "1101"].iloc[0]["equity_parent"] == 237429168


def test_roic_from_real_sample_matches_hand_calculation():
    """用真實樣本（2026 上半年）手算：台積電簡式 ROIC（上半年 × 2、期末投入資本）≈ 31.3%、聯發科 ≈ 17.5%。"""
    inc = financials.parse_statement(sample("mops_t163sb04_get.html"), "income")
    bal = financials.parse_statement(sample("mops_t163sb05_get.html"), "balance")
    for code, want in (("2330", 31.3), ("2454", 17.5)):
        i, b = inc[inc["code"] == code].iloc[0], bal[bal["code"] == code].iloc[0]
        rate = quality.tax_rate(i["pretax"], i["tax"])
        roic = i["op_income"] * (1 - rate) * 2 / (b["total_assets"] - b["cur_liab"]) * 100
        assert roic == pytest.approx(want, abs=0.05)


def test_ttm_average_capital_and_decomposition():
    rows = [_row("A", 2024, q) for q in (1, 2, 3, 4)] + [_row("A", 2025, q) for q in (1, 2)]
    rows[-1].update(total_assets=1700.0)  # 2025Q2 投入資本 1200，一年前 1000 → 平均 1100
    pts = quality.Points(quality.rows_by_code(_fin(rows))["A"])
    p = pts.at(2025, 2)
    assert p is not None
    # 近四季＝本季累計 200 ＋ 去年全年 400 − 去年同季累計 200 ＝ 400；稅率 20% → NOPAT 320
    assert p["nopat"] == pytest.approx(320)
    assert p["roic"] == pytest.approx(320 / 1100 * 100)
    assert p["nopat_margin"] == pytest.approx(8.0) and p["turnover"] == pytest.approx(4000 / 1100)
    assert p["nopat_margin"] / 100 * p["turnover"] * 100 == pytest.approx(p["roic"])  # 利潤率 × 周轉 ＝ ROIC
    assert p["roe"] == pytest.approx(320 / 800 * 100) and p["gap"] == pytest.approx(p["roe"] - p["roic"])
    # 沒有一年前的資產負債表 → 用期末投入資本
    assert pts.at(2024, 4)["roic"] == pytest.approx(320 / 1000 * 100)
    # 缺去年同季累計 → 拆不出近四季
    assert pts.at(2024, 2) is None


def test_tax_rate_is_clamped_and_losses_have_no_tax_shield():
    assert quality.tax_rate(100, 60) == 0.4  # 單期異常值（例：中鋼 2026 上半年 60%）
    assert quality.tax_rate(100, -5) == 0.0
    assert quality.tax_rate(-10, 3) == 0.2 and quality.tax_rate(None, None) == 0.2
    rows = [_row("L", 2024, 4, op_income=-100.0, pretax=-120.0, tax=0.0)]
    p = quality.Points(quality.rows_by_code(_fin(rows))["L"]).at(2024, 4)
    assert p["nopat"] == -100 and p["roic"] == pytest.approx(-10)


def test_status_financial_and_old_schema():
    fin_rows = quality.rows_by_code(_fin([_row("B", 2025, 4, op_income=None, cur_liab=None)]))["B"]
    assert quality.status_of(fin_rows) == "fin"
    assert quality.detail(fin_rows) == {"status": "fin", "period": "2025Q4", "roe": 40.0}  # 320 ÷ 800
    # 舊檔（2026-11 以前）沒有新欄位 → none，且不出錯
    old = pd.DataFrame([{k: v for k, v in _row("C", 2025, 4).items() if k in financials.BASE_COLS}])
    by = quality.rows_by_code(old)
    assert quality.status_of(by["C"]) == "none" and quality.detail(by["C"]) == {"status": "none"}
    assert quality.records(old).empty and quality.panels(old, ["2026-04-01"], ["C"]) == {}
    assert quality.build(old, ["C", "ZZ"]) == {"C": {"status": "none"}, "ZZ": {"status": "none"}}


def _annual(code: str, roics: list[float], rev_growth: float = 1.05) -> list[dict]:
    """年度資料（每年只有第 4 季），投入資本固定 1000、稅率 20%：ROIC＝營業利益 × 0.8 ÷ 1000。"""
    out = []
    for i, r in enumerate(roics):
        op = r / 100 * 1000 / 0.8
        out.append(_row(code, 2016 + i, 4, op_income=op, pretax=op, tax=op * 0.2, revenue=1000.0 * rev_growth**i))
    return out


@pytest.mark.parametrize(
    ("roics", "growth", "want_type", "want_band"),
    [
        ([27, 26, 24, 21, 27, 28, 35, 25, 29, 31], 1.05, "steady", "above"),
        ([10, 18, 22, 12, 9, 16, 24, 13, 10, 17], 1.05, "cyclical", "above"),
        ([10, 9.5, 9, 9.5, 9, 8.5, 9, 8, 6.5, 5], 1.05, "fading", "below"),
        ([10, 9.5, 9, 9.5, 9, 8.5, 9, 8, 6.5, 5], 0.97, None, "below"),  # 營收也在衰退 → 不是「報酬連年降」
        ([9, 8.5, 9, 8, 9.5, 9, 8.5, 9, 8, 8.5], 1.05, None, "near"),
        ([12, 11.5, 12, 11, 12, 11.5, 12, 11, 11.5, 12], 1.05, None, "above"),  # 高於門檻但不到「每年高 5 個百分點」
        ([27, 26, 28], 1.05, None, "above"),  # 年度不足 5 年 → 不分類
    ],
)
def test_classification(roics, growth, want_type, want_band):
    d = quality.detail(quality.rows_by_code(_fin(_annual("T", roics, growth)))["T"])
    assert d["status"] == "ok" and d["type"] == want_type and d["band"] == want_band
    assert d["n_years"] == len(roics) and d["roic"] == pytest.approx(roics[-1], abs=0.05)
    assert d["years"][0][0] == 2016 and d["years"][-1][1] == pytest.approx(roics[-1], abs=0.05)
    if len(roics) >= 5:
        assert d["median"] == pytest.approx(median(roics), abs=0.06)
    else:
        assert d["median"] is None  # 資料累積中


def test_legs_and_down_streak():
    assert quality.legs([10, 18, 22, 12, 9, 17], 8) == 3  # 升、降、升
    assert quality.legs([10, 18, 22, 12, 9, 16], 8) == 2  # 最後回升 7 個百分點，不到一段
    assert quality.legs([27, 26, 24, 21, 27, 28], 8) == 0  # 起伏都不到 8 個百分點
    assert quality.legs([15, 12, 9, 6, 3], 8) == 1  # 一路下滑只有一段
    assert quality.down_streak([9, 8, 6.5, 5]) == 3 and quality.down_streak([5, 6, 5]) == 1
    assert quality.down_streak([5]) == 0


def test_incremental_return_needs_capital_growth():
    rows = _annual("I", [20, 20, 20, 20, 20, 20])
    assert quality.detail(quality.rows_by_code(_fin(rows))["I"])["incr_roic"] is None  # 投入資本沒有增加
    rows[-1].update(total_assets=2000.0, op_income=450.0, pretax=450.0, tax=90.0)  # 投入資本 1000 → 1500
    d = quality.detail(quality.rows_by_code(_fin(rows))["I"])
    # 3 年前 NOPAT 200、現在 360；多投入 500 → 新增投入的報酬 32%
    assert d["incr_roic"] == pytest.approx((360 - 200) / 500 * 100)


def test_panels_use_statutory_deadline_no_lookahead():
    fin = _fin(_annual("P", [10, 12, 14, 16, 18, 20, 22]))
    dates = ["2022-03-30", "2022-03-31", "2023-03-30", "2023-03-31"]
    p = quality.panels(fin, dates, ["P"])
    # 2021 年報 2022-03-31 生效：前一天仍是 2020 年的值
    assert p["roic"]["P"].tolist() == pytest.approx([18, 20, 20, 22])
    # 近 5 年最低：到 2021 年為止是 2017–2021 的最低 12
    assert p["roic_min5"]["P"].loc["2022-03-31"] == pytest.approx(12)
    assert p["roic_chg3"]["P"].loc["2023-03-31"] == pytest.approx(22 - 16)
    assert p["revenue_chg_3y"]["P"].loc["2023-03-31"] == pytest.approx((1.05**3 - 1) * 100)
    assert set(p) == set(quality.PANEL_FIELDS)


def test_build_percentile_and_chip():
    fin = _fin(
        _annual("A", [30] * 6)
        + _annual("B", [9] * 6)
        + _annual("C", [2] * 6)
        + [_row("F", 2021, 4, op_income=None, cur_liab=None)]
    )
    out = quality.build(fin, ["A", "B", "C", "F", "X"])
    assert [out[c].get("pct") for c in ("A", "B", "C")] == [100, 50, 0]
    assert "pct" not in out["F"] and out["X"] == {"status": "none"}
    assert [quality.chip(out[c]) for c in ("A", "B", "C", "F", "X")] == ["steady", "near", "below", "fin", None]


def test_quality_flags_only_with_low_valuation():
    fading = {"type": "fading", "down_years": 3, "roic": 4.2, "hurdle": 8.0}
    assert flags.quality_flags(fading, 55.0, 60.0) == []
    got = flags.quality_flags(fading, 12.0, 60.0)
    assert [g[0] for g in got] == ["cheap_but_fading"] and "本益比" in got[0][1] and "連 3 年" in got[0][1]
    assert "淨值比" in flags.quality_flags(fading, None, 20.0)[0][1]
    cyc = {
        "type": "cyclical",
        "op_margin": 30.0,
        "years": [[2016 + i, 10, 100, m] for i, m in enumerate([5, 8, 12, 20, 28, 10, 6])],
    }
    assert [g[0] for g in flags.quality_flags(cyc, 10.0, None)] == ["cyclical_peak"]
    assert flags.quality_flags({**cyc, "op_margin": 9.0}, 10.0, None) == []  # 獲利不在高檔
    assert flags.quality_flags(cyc, 80.0, None) == []  # 本益比不低
    assert flags.quality_flags({"type": "steady"}, 5.0, 5.0) == []


class _Store:
    def __init__(self, frames: dict[date, pd.DataFrame]) -> None:
        self.frames = frames

    def read(self, _source: str, d: date) -> pd.DataFrame | None:
        return self.frames.get(d)

    def exists(self, _source: str, d: date) -> bool:
        return d in self.frames

    def dates(self, _source: str) -> list[date]:
        return sorted(self.frames)

    def write(self, _source: str, d: date, df: pd.DataFrame) -> None:
        self.frames[d] = df


class _Ctx:
    def __init__(self, store: _Store) -> None:
        self.store = store
        self.notes: list[tuple] = []

    def out_of_time(self) -> bool:
        return False

    def note(self, *a, **kw) -> None:
        self.notes.append((a, kw))


def test_stale_files_are_refetched(monkeypatch):
    old = pd.DataFrame([{"code": "A", "year": 2025, "quarter": 4, "revenue": 1.0}])
    new = pd.DataFrame([{"code": "A", "year": 2026, "quarter": 1, "revenue": 1.0, "total_assets": 9.0}])
    ctx = _Ctx(_Store({date(2025, 12, 1): old, date(2025, 9, 1): old.copy(), date(2026, 3, 1): new}))
    assert financials.is_stale(ctx, 2025, 4) and not financials.is_stale(ctx, 2026, 1)
    assert not financials.is_stale(ctx, 2020, 1)  # 不存在的季別不算舊檔
    fetched: list[tuple[int, int]] = []

    def fake_fetch(_ctx, y, q):
        fetched.append((y, q))
        return pd.DataFrame([{"code": "A", "year": y, "quarter": q, "revenue": 1.0, "total_assets": 9.0}])

    monkeypatch.setattr(financials, "fetch_quarter", fake_fetch)
    assert financials.upgrade_stale(ctx, limit=1) == 1 and fetched == [(2025, 4)]  # 由近到遠、每次最多 limit 季
    assert financials.upgrade_stale(ctx) == 1 and fetched[-1] == (2025, 3)
    assert financials.upgrade_stale(ctx) == 0  # 都補齊了
    # 回補：已存在且是新格式的季別略過，舊格式或不存在的才抓
    ctx.store.frames[date(2025, 6, 1)] = old.copy()
    fetched.clear()
    financials.run_history(ctx, date(2025, 4, 1), date(2026, 5, 20))
    assert fetched == [(2025, 2)]


def test_payout_uses_prior_year_eps_and_skips_current_year():
    rows = quality.rows_by_code(_fin([_row("D", y, 4, eps=e) for y, e in ((2022, 10.0), (2023, 8.0), (2024, -1.0))]))[
        "D"
    ]
    divs = [
        {"date": "2023-07-10", "cash": 6.0, "stock_ratio": 0},
        {"date": "2024-03-14", "cash": 2.0, "stock_ratio": 0},
        {"date": "2024-09-12", "cash": 2.0, "stock_ratio": 0},  # 半年配：同一年合計
        {"date": "2025-07-08", "cash": 1.0, "stock_ratio": 0},
        {"date": "2026-07-08", "cash": 3.0, "stock_ratio": 0},  # 今年還沒過完，不列
    ]
    got = quality.payout_rows(rows, divs, "2026-11-13")
    # 2023 配 6 ÷ 2022 EPS 10 ＝ 60%；2024 配 4 ÷ 2023 EPS 8 ＝ 50%；2025 配 1、前一年虧損 → 配發率空值
    assert got == [[2023, 6.0, 60.0], [2024, 4.0, 50.0], [2025, 1.0, None]]
    q = {"status": "ok"}
    quality.attach_payout(q, rows, divs, "2026-11-13")
    assert q["payout"] == got
    fin_q = {"status": "fin"}
    quality.attach_payout(fin_q, rows, divs, "2026-11-13")
    assert "payout" not in fin_q


def test_cash_flow_summary_real_sample_and_conversion():
    """現金流量表彙總（t163sb20，2026 上半年真實樣本）：台積電營業現金流 ÷ 歸屬母公司淨利 ≈ 116%。"""
    cash = financials.parse_statement(sample("mops_t163sb20_get.html"), "cash")
    inc = financials.parse_statement(sample("mops_t163sb04_get.html"), "income")
    tsmc_c, tsmc_i = cash[cash["code"] == "2330"].iloc[0], inc[inc["code"] == "2330"].iloc[0]
    assert tsmc_c["cfo"] > 0 > tsmc_c["cfi"]
    assert tsmc_c["cfo"] / tsmc_i["ni_parent"] * 100 == pytest.approx(116, abs=1)
    assert cash[cash["code"] == "2801"].iloc[0]["cfo"] < 0  # 金融業同一種表頭
    assert set(financials.CASH_EXTRA) <= set(financials.FIN_COLS)
    # 近四季營業現金流 ÷ 淨利；淨利 ≤ 0 或沒有現金流欄位時不計算
    rows = [_row("A", 2024, q, cfo=60.0 * q) for q in (1, 2, 3, 4)] + [
        _row("A", 2025, q, cfo=100.0 * q) for q in (1, 2)
    ]
    d = quality.detail(quality.rows_by_code(_fin(rows))["A"])
    assert d["cash_conv"] == pytest.approx((200 + 240 - 120) / 320 * 100, abs=0.5)
    assert quality.detail(quality.rows_by_code(_fin([_row("B", 2024, 4)]))["B"])["cash_conv"] is None
    loss = quality.detail(quality.rows_by_code(_fin([_row("C", 2024, 4, cfo=50.0, ni_parent=-10.0)]))["C"])
    assert loss["cash_conv"] is None


def test_directors_real_samples_and_weekly_task(tmp_path):
    twse = optional.parse_directors(sample("twse_openapi_t187ap11_L.json")).df.set_index("code")
    # 只算董事與監察人（含獨立董事、法人代表人），經理人與大股東不計；同一人只算一次
    assert list(twse.columns) == ["ym", "name", "directors", "shares", "pledged", "pledge_pct"]
    assert twse.loc["2330", "ym"] == "2026-10" and twse.loc["2330", "directors"] == 11
    assert twse.loc["2330", "pledged"] == 1600000 and twse.loc["2330", "pledge_pct"] == pytest.approx(0.09, abs=0.01)
    assert twse.loc["2454", "pledge_pct"] == 0
    tpex = optional.parse_directors(sample("tpex_openapi_t187ap11_O.json")).df  # 上櫃欄名沒有尾端空白，同一個解析器
    assert len(tpex) == 3 and tpex["pledge_pct"].max() == pytest.approx(23.37, abs=0.01)
    assert optional.parse_directors(b"[]").no_data
    with pytest.raises(optional.ParseError):
        optional.parse_directors(b"<html>maintenance</html>")
    # 每週檢查：該月已存在就不重寫；來源失敗只記錄、不中斷另一個市場
    ctx = make_ctx(tmp_path, {"t187ap11_L": sample("twse_openapi_t187ap11_L.json"), "t187ap11_O": b"<html>busy</html>"})
    tasks_advanced.run_directors(ctx)
    stored = ctx.store.read("twse_directors", date(2026, 10, 1))
    assert stored is not None and len(stored) == 4
    assert [f["source"] for f in ctx.failures] == ["tpex_directors"]
    tasks_advanced.run_directors(ctx)
    assert any(r["source"] == "twse_directors" and r["message"] == "本月已存在" for r in ctx.results)
    # 個股檔：董監持股 ÷ 發行股數、設質比例
    q = {"status": "ok"}
    quality.attach_insiders(q, quality.directors_by_code(stored)["2330"], 25_930_380_458)
    assert q["insiders"] == {"ym": "2026-10", "hold_pct": 6.5, "pledge_pct": 0.1}
    none = {"status": "fin"}
    quality.attach_insiders(none, {"shares": 1.0}, 10.0)
    assert "insiders" not in none
