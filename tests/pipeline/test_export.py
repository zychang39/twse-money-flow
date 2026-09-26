"""build-web：以示範資料（合成）走完整流程，檢查輸出檔案與格式。"""

from __future__ import annotations

import gzip
import json

from pipeline.derive.demo import build_store
from pipeline.derive.export import build_web


def test_build_web_outputs(tmp_path):
    store_dir = tmp_path / "data"
    out = tmp_path / "out"
    build_store(store_dir, days=80)
    report = build_web(store_dir, out, demo=True)
    assert report["stocks"] == 12
    meta = json.loads((out / "meta.json").read_text())
    assert meta["status"] == "ok" and meta["demo"] is True and meta["market_date"] == "2026-09-24"
    summary = json.loads((out / "summary.json").read_text())
    assert summary["columns"][0] == "code" and len(summary["rows"]) == 12
    assert len(gzip.compress((out / "summary.json").read_bytes())) < 800 * 1024
    stock = json.loads((out / "stocks" / "1101.json").read_text())
    assert len(stock["d"]) == 80 and len(stock["c"]) == 80 and stock["industry"] == "水泥工業"
    # 除息日（倒數第 60 日）之前的還原因子 = 32/33，之後 = 1
    ex_idx = len(stock["d"]) - 60
    assert abs(stock["af"][ex_idx - 1] - 32 / 33) < 1e-6 and stock["af"][ex_idx] == 1
    health = json.loads((out / "health.json").read_text())
    assert any(s["id"] == "twse_quotes" for s in health["sources"])


def test_build_web_without_data(tmp_path):
    report = build_web(tmp_path / "missing", tmp_path / "out")
    assert report["status"] == "no_data"
    meta = json.loads((tmp_path / "out" / "meta.json").read_text())
    assert meta["status"] == "no_data"
