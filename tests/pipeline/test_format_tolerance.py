"""欄位別名＋必要／選用欄位：所有解析器共用的相容策略，以及格式變動警告寫入 manifest。"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from pipeline.core.store import record
from pipeline.registry import SPECS
from pipeline.smoke import check_frame, required_columns
from pipeline.sources.base import (
    ParseError,
    col,
    collect_format_warnings,
    drain_format_warnings,
    expect_fields,
    frame_from_fields,
    norm_field,
    opt,
    warn_format,
)

FIELDS = ["代號", "名稱", "收盤", "成交量"]
ROWS = [["2330", "台積電", "1,000", "10"], ["2317", "鴻海", "200", "20"]]


def test_norm_field_fullwidth():
    assert norm_field("殖利率（％）") == norm_field("殖利率(%)")
    assert norm_field(" 財報 年/季 ") == "財報年/季"


def test_alias_and_optional():
    with collect_format_warnings() as w:
        df = frame_from_fields(
            FIELDS,
            ROWS,
            {"code": ("股票代號", "代號"), "close": "收盤", "pe": opt("本益比"), "volume": col("成交量")},
        )
    assert list(df["code"]) == ["2330", "2317"]
    assert df["pe"].isna().all()
    assert any("股票代號" in m and "代號" in m for m in w)
    assert any("本益比" in m for m in w)


def test_default_policy_only_code_required():
    with collect_format_warnings() as w:
        df = frame_from_fields(FIELDS, ROWS, {"code": "代號", "high": "最高"})
    assert df["high"].isna().all() and len(w) == 1
    with pytest.raises(ParseError, match="證券代號"):
        frame_from_fields(FIELDS, ROWS, {"code": "證券代號"})


def test_explicit_required():
    with pytest.raises(ParseError, match="本益比"):
        frame_from_fields(FIELDS, ROWS, {"code": "代號", "pe": "本益比"}, required=("pe",))
    with pytest.raises(ParseError):
        frame_from_fields(FIELDS, ROWS, {"code": "代號", "pe": col("本益比")})


def test_expect_fields_positions():
    expect_fields(FIELDS, FIELDS[:2])  # 前綴相同
    with collect_format_warnings() as w:
        expect_fields([*FIELDS, "新欄位"], FIELDS, prefix_only=False)
    assert w and "新欄位" in w[0]
    with pytest.raises(ParseError, match="以位置解析"):
        expect_fields(["代號", "收盤", "名稱"], ["代號", "名稱"])


def test_pending_warnings_are_drained():
    drain_format_warnings()
    warn_format("x")
    warn_format("x")
    assert drain_format_warnings() == ["x"]
    assert drain_format_warnings() == []


def test_record_format_warnings_kept_until_clean_parse():
    m: dict = {}
    record(m, "tpex_valuation", status="ok", data_date=date(2024, 1, 2), rows=812, format_warnings=["缺少欄位"])
    e = m["sources"]["tpex_valuation"]
    assert e["format_warnings"] == ["缺少欄位"] and e["format_warning_date"] == "2024-01-02"
    # 沒有經過解析的紀錄（format_warnings=None）不清除
    record(m, "tpex_valuation", status="ok", data_date=date(2024, 1, 3))
    assert "format_warnings" in e
    record(m, "tpex_valuation", status="ok", data_date=date(2026, 9, 24), format_warnings=[])
    assert "format_warnings" not in e


def test_smoke_required_columns():
    spec = SPECS["tpex_valuation"]
    assert required_columns(spec) == ["code", "pb"]
    ok = pd.DataFrame({"code": ["1240"], "pb": [1.2]})
    assert check_frame(spec, ok) == []
    assert check_frame(spec, pd.DataFrame({"code": ["1240"]})) == ["pb"]
    assert check_frame(spec, pd.DataFrame({"code": ["1240"], "pb": [None]})) == ["pb"]
