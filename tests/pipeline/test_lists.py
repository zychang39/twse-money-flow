"""系統清單「熱門動能」：規則（成交值排名、RS 百分位、風險旗標）與排序。"""

from __future__ import annotations

from pipeline.derive.lists import build_lists, hot_momentum

CFG = {
    "label": "熱門動能",
    "exclude_etf": True,
    "value_rank_top": 3,
    "min_rs_percentile": 80,
    "max_warn_flags": 1,
    "max_danger_flags": 0,
    "size": 2,
}
WARN = {"id": "w", "label": "注意", "level": "warn"}
DANGER = {"id": "d", "label": "處置", "level": "danger"}


def r(code, value, rs, flags=()):
    return {"code": code, "name": code, "value_million": value, "rs_percentile": rs, "flags": list(flags)}


def test_rules_and_order():
    rows = [
        r("0050", 9000, 99),  # ETF 排除
        r("2330", 8000, 85),
        r("2317", 7000, 95, [WARN]),  # 1 個注意旗標仍可
        r("2454", 6000, 90, [DANGER]),  # 危險旗標排除
        r("3008", 5000, 99),  # 成交值排名第 4（前 3 名以外）
        r("2382", 100, 70),
    ]
    out = hot_momentum(rows, CFG)
    assert [x["code"] for x in out["items"]] == ["2317", "2330"]
    assert out["items"][0]["value_rank"] == 2 and "RS 百分位 95" in out["items"][0]["reason"]
    assert out["rule"]["size"] == 2


def test_too_many_warn_flags_and_missing_values():
    rows = [r("2330", 8000, 85, [WARN, WARN]), r("2317", None, 99), r("2454", 7000, None)]
    assert hot_momentum(rows, CFG)["items"] == []


def test_build_lists_from_summary_columns():
    cols = ["code", "name", "value_million", "rs_percentile", "flags"]
    rows = [["2330", "台積電", 8000, 88.0, []]]
    out = build_lists(cols, rows, "2026-09-24")
    assert out["date"] == "2026-09-24" and out["hot_momentum"]["items"][0]["code"] == "2330"


def test_default_config_loads():
    assert hot_momentum([])["rule"]["value_rank_top"] > 0


def test_marks_and_values():
    """M2：每檔列實際數值；處置／注意、20 日乖離 > 20%、漲停、流動性不足只標記不剔除。"""
    row = r("2330", 8000, 90, [{"id": "attention", "label": "注意股", "level": "warn"}])
    row.update({"ma20_gap": 23.4, "change_pct": 9.8})
    low = r("2317", 50, 85)
    low.update({"ma20_gap": 3.0, "change_pct": 1.0})
    out = hot_momentum([row, low], CFG)
    a, b = out["items"]
    assert a["marks"] == ["注意股", "20 日乖離 +23.4%", "漲停"]
    assert a["value_million"] == 8000 and a["ma20_gap"] == 23.4 and a["change_pct"] == 9.8
    assert b["marks"] == ["流動性不足"]
    assert out["rule"]["mark_bias_above"] == 20
