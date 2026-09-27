"""選配 AI 摘要：沒有金鑰時不執行、輸出過濾交易建議字眼、模型由 Models API 取得（不打真實網路）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from pipeline.derive import ai_summary


def _web(tmp_path: Path) -> Path:
    cols = ["code", "name", "industry", "change_pct", "value_million", "composite", "composite_chg", "foreign_net_lots"]
    rows = [
        ["2330", "台積電", "半導體業", -1.0, 30000, 72, 3, -1200],
        ["2317", "鴻海", "其他電子業", 1.0, 9000, 55, 8, 500],
    ]
    (tmp_path / "summary.json").write_text(json.dumps({"date": "2026-09-24", "columns": cols, "rows": rows}))
    market = {
        "taiex": {"close": 19398.48, "change": 134.98},
        "breadth": {"up": 1, "down": 1, "flat": 0},
        "flows": [{"date": "2026-09-24", "foreign": -12.3, "trust": 4.5, "dealer": 1.2}],
        "sectors": [],
        "env": {"lights": [{"label": "外資台指期淨未平倉", "state": "yellow", "value": "-5,728 口", "basis": "x"}]},
    }
    (tmp_path / "market.json").write_text(json.dumps(market, ensure_ascii=False))
    return tmp_path


def test_clean_lines_drops_advice() -> None:
    text = "・加權指數上漲 134 點\n- 外資賣超 12.3 億\n・建議買進台積電\n・可考慮進場\n\n・投信連續買超"
    assert ai_summary.clean_lines(text) == ["加權指數上漲 134 點", "外資賣超 12.3 億", "投信連續買超"]


def test_build_input(tmp_path: Path) -> None:
    data = ai_summary.build_input(_web(tmp_path))
    assert data["date"] == "2026-09-24"
    assert data["composite_up"][0]["code"] == "2317"
    assert data["env"] == [{"label": "外資台指期淨未平倉", "state": "yellow", "value": "-5,728 口"}]


def test_generate_skips_without_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert ai_summary.generate(_web(tmp_path)) is None
    assert not (tmp_path / "ai_summary.json").exists()


class _Resp:
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.data


def test_generate_with_mocked_api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    calls: dict[str, Any] = {}

    def fake_get(url: str, **kw: Any) -> _Resp:
        calls["get"] = url
        return _Resp({"data": [{"id": "newest-model"}, {"id": "older-model"}]})

    def fake_post(url: str, **kw: Any) -> _Resp:
        calls["post"] = kw["json"]
        return _Resp({"content": [{"type": "text", "text": "・大盤上漲\n・請在此價位買進"}]})

    monkeypatch.setattr(ai_summary.requests, "get", fake_get)
    monkeypatch.setattr(ai_summary.requests, "post", fake_post)
    res = ai_summary.generate(_web(tmp_path))
    assert res is not None and res["lines"] == ["大盤上漲"] and res["model"] == "newest-model"
    assert calls["post"]["model"] == "newest-model"
    assert "買進" in calls["post"]["system"]  # 提示詞明確禁止
    saved = json.loads((tmp_path / "ai_summary.json").read_text())
    assert saved["date"] == "2026-09-24"
