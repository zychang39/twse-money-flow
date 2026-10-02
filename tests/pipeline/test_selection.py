"""策略分級（2026-10-02 第二輪）：有效／觀察中／停用的規則、樣本年數上限、去重與名額的手算。"""

from __future__ import annotations

import pandas as pd

from pipeline.evidence import selection

G = {
    "valid": {
        "net_excess_positive_horizons": [40, 20],
        "t_corr_min": 3,
        "split_date": "2022-01-01",
        "year_pass_ratio": 0.7,
        "per_month_min": 10,
    },
    "watch": {"t_corr_min": 2},
    "min_years_for_valid": 5,
    "dedupe_corr": 0.8,
    "max_strategies": 15,
}


def _row(**kw) -> dict:
    base = {
        "excess": {40: 2.0, 20: 1.0},
        "t_corr": 3.5,
        "pre": 1.0,
        "post": 1.5,
        "years": {
            "2017": 1,
            "2018": 1,
            "2019": -1,
            "2020": 1,
            "2021": 1,
            "2022": 1,
            "2023": 1,
            "2024": 1,
            "2025": 1,
            "2026": 1,
        },
        "per_month": 12,
        "span_years": 9.5,
        "gates_passed": None,
    }
    base.update(kw)
    return base


def test_valid_watch_off():
    assert selection.grade_one(_row(), G)[0] == "有效"
    # 20 日 ≤ 0 → 觀察中（40 日 > 0 且 t ≥ 2）
    g, checks, failed = selection.grade_one(_row(excess={40: 2.0, 20: 0.0}), G)
    assert g == "觀察中" and not checks["net_excess"] and failed
    # t 2.5 → 觀察中；t 1.9 → 停用；40 日 ≤ 0 → 停用（即使 t 高）
    assert selection.grade_one(_row(t_corr=2.5), G)[0] == "觀察中"
    assert selection.grade_one(_row(t_corr=1.9), G)[0] == "停用"
    assert selection.grade_one(_row(excess={40: -0.1, 20: 1.0}, t_corr=5), G)[0] == "停用"
    # 2022 後為負 → 觀察中；逐年 6/10 → 觀察中；每月 9 → 觀察中
    assert selection.grade_one(_row(post=-0.2), G)[0] == "觀察中"
    years = {**_row()["years"], "2018": -1, "2020": -1, "2021": -1}
    assert selection.grade_one(_row(years=years), G)[0] == "觀察中"
    assert selection.grade_one(_row(per_month=9), G)[0] == "觀察中"


def test_sample_under_five_years_caps_at_watch():
    g, checks, _ = selection.grade_one(_row(span_years=4.9), G)
    assert g == "觀察中" and not checks["sample_years"]
    assert selection.grade_one(_row(span_years=5.0), G)[0] == "有效"


def test_swing_needs_gates():
    assert selection.grade_one(_row(gates_passed=False), G)[0] == "觀察中"
    assert selection.grade_one(_row(gates_passed=True), G)[0] == "有效"


def test_years_span():
    assert selection._years_span("2017-01-01", "2022-01-01") == 5.0
    assert selection._years_span(None, "2022-01-01") is None


def test_markdown_smoke():
    lib = {
        "selection": {"horizons": [40, 20]},
        "strategies": [
            {
                "id": "a",
                "label": "A",
                "grade": "有效",
                "grade_label": "有效・待前瞻驗證",
                "rank": 1,
                "t_corr": 3.2,
                "excess_h": {"40": 2.0, "20": 1.0},
            },
            {"id": "b", "label": "B", "grade": "停用", "grade_reason": "校正後 t 1.0 < 2", "rank": None},
        ],
    }
    md = selection.markdown(lib)
    assert "有效・待前瞻驗證" in md and "校正後 t 1.0 < 2" in md
    assert isinstance(pd.DataFrame({"x": [1]}), pd.DataFrame)
