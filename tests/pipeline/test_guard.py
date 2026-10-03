"""部署前守門（2026-10-02 健檢 M1-8）：欄位缺漏、日期倒退、筆數驟降 → 不部署、保留前一版。"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.derive.guard import check

COLS = [
    "code",
    "name",
    "market",
    "close",
    "change_pct",
    "volume_lots",
    "foreign_net_lots",
    "trust_net_lots",
    "composite",
]


def _write(
    d: Path, rows: int, date: str, *, cols: list[str] | None = None, grade: str = "有效", ev_rows: int = 30
) -> None:
    d.mkdir(parents=True, exist_ok=True)
    (d / "meta.json").write_text(json.dumps({"market_date": date, "status": "ok"}), encoding="utf-8")
    (d / "summary.json").write_text(
        json.dumps(
            {"date": date, "columns": cols or COLS, "rows": [[str(i)] * len(cols or COLS) for i in range(rows)]}
        ),
        encoding="utf-8",
    )
    (d / "strategies.json").write_text(
        json.dumps(
            {
                "strategies": [
                    {
                        "id": "a",
                        "label": "A",
                        "grade": grade,
                        "curve": {
                            "dates": ["2017-03-10", "2017-03-17"],
                            "equity": [1, 1.1],
                            "bench": [1, 1.02],
                            "etf": {"0050": [1, 1.01]},
                        },
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (d / "evidence.json").write_text(
        json.dumps({"meta": {}, "rows": [{"id": str(i)} for i in range(ev_rows)]}), encoding="utf-8"
    )


def test_ok_without_previous(tmp_path: Path) -> None:
    _write(tmp_path / "out", 2000, "2026-10-02")
    res = check(tmp_path / "out", None)
    assert res["ok"], res
    assert res["compared"] is False


def test_ok_with_previous(tmp_path: Path) -> None:
    _write(tmp_path / "out", 2000, "2026-10-02")
    _write(tmp_path / "prev", 1990, "2026-10-01")
    res = check(tmp_path / "out", tmp_path / "prev")
    assert res["ok"], res
    assert res["compared"] is True


def test_date_regression_and_row_drop_fail(tmp_path: Path) -> None:
    _write(tmp_path / "out", 1000, "2026-09-30")
    _write(tmp_path / "prev", 2000, "2026-10-01")
    res = check(tmp_path / "out", tmp_path / "prev")
    assert not res["ok"]
    assert any("倒退" in e for e in res["errors"])
    assert any("驟降" in e for e in res["errors"])


def test_missing_fields_fail(tmp_path: Path) -> None:
    _write(tmp_path / "out", 2000, "2026-10-02", cols=["code", "name"])
    res = check(tmp_path / "out", None)
    assert not res["ok"]
    assert any("缺少欄位" in e for e in res["errors"])


def test_evidence_error_and_missing_strategies_fail(tmp_path: Path) -> None:
    _write(tmp_path / "out", 2000, "2026-10-02")
    (tmp_path / "out" / "evidence.json").write_text(
        json.dumps({"meta": {"error": "boom"}, "rows": []}), encoding="utf-8"
    )
    (tmp_path / "out" / "strategies.json").unlink()
    res = check(tmp_path / "out", None)
    assert not res["ok"]
    assert any("評估失敗" in e for e in res["errors"])
    assert any("strategies.json" in e for e in res["errors"])


def test_curve_bench_missing_at_ends_is_warning(tmp_path: Path) -> None:
    _write(tmp_path / "out", 2000, "2026-10-02")
    s = json.loads((tmp_path / "out" / "strategies.json").read_text(encoding="utf-8"))
    s["strategies"][0]["curve"]["etf"]["0050"] = [None, 1.01]
    (tmp_path / "out" / "strategies.json").write_text(json.dumps(s), encoding="utf-8")
    res = check(tmp_path / "out", None)
    assert res["ok"]
    assert any("起訖日沒有值" in w for w in res["warnings"])
