"""季財報：MOPS 彙總表解析、YTD → 單季、毛利率年增、ROE、法定期限生效。"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from pipeline import financials
from pipeline.derive import fundamentals
from tests.pipeline.conftest import sample


def test_parse_income_and_balance_across_formats():
    inc = financials.parse_statement(sample("mops_t163sb04_get.html"), "income")
    tcc = inc[inc["code"] == "1101"].iloc[0]
    assert tcc["revenue"] == 71289957 and tcc["gross_profit"] == 12991724 and tcc["eps"] == 0.38
    assert tcc["ni_parent"] == 3279780
    bank = inc[inc["code"] == "2801"].iloc[0]  # 金融業格式：無營業毛利
    assert bank["gross_profit"] is None or bank["gross_profit"] != bank["gross_profit"]
    assert bank["ni_parent"] > 0
    bal = financials.parse_statement(sample("mops_t163sb05_get.html"), "balance")
    assert bal[bal["code"] == "1101"].iloc[0]["equity_parent"] == 237429168


def test_quarterly_decomposition_and_factors():
    rows = []
    # 2025 Q1–Q4 與 2026 Q1–Q2（YTD 累計）；每季營收 100、毛利 20（2026 起毛利 30）、淨利 10
    for y in (2025, 2026):
        for q in (1, 2, 3, 4):
            if y == 2026 and q > 2:
                break
            gp = 30 if y == 2026 else 20
            rows.append(
                {
                    "code": "A",
                    "year": y,
                    "quarter": q,
                    "revenue": 100 * q,
                    "gross_profit": gp * q,
                    "ni_parent": 10 * q,
                    "equity_parent": 200,
                }
            )
    fin = pd.DataFrame(rows)
    q = fundamentals.quarterly(fin)
    assert q[(q["year"] == 2026) & (q["quarter"] == 2)].iloc[0]["rev_q"] == 100
    rec = fundamentals.fundamental_records(fin).set_index("effective")
    r = rec.loc["2026-08-14"]  # 2026 Q2 於 8/14 生效
    assert r["gross_margin_change"] == pytest.approx(10.0)  # 30% − 20%（去年同季）
    assert r["roe"] == pytest.approx(40 / 200 * 100)  # 近四季淨利 40 ÷ 權益 200
    assert fundamentals.effective_date(2025, 4) == "2026-03-31"


def test_latest_due_quarter():
    assert financials.latest_due_quarter(date(2026, 9, 26)) == (2026, 2)
    assert financials.latest_due_quarter(date(2026, 8, 13)) == (2026, 1)
    assert financials.latest_due_quarter(date(2026, 4, 1)) == (2025, 4)
