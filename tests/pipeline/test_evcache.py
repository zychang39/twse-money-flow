"""2026-10-08：指標效度評估快取——輸入、程式、設定都沒變才沿用；任何一項不同就重算。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pipeline.derive import evcache


@dataclass
class Ev:
    dates: list[str]
    close: np.ndarray
    revenue: pd.DataFrame = field(default_factory=pd.DataFrame)
    etf: dict = field(default_factory=dict)


def make(v: float = 1.0) -> Ev:
    return Ev(
        dates=["2026-10-06", "2026-10-07"],
        close=np.array([[1.0, v], [2.0, np.nan]]),
        revenue=pd.DataFrame({"code": ["2330"], "revenue": [1e9]}),
        etf={"0050": {"close": np.array([1.0, 2.0])}},
    )


def fake_run(calls):
    def run(ev, out):
        calls.append(1)
        (out / "evidence").mkdir(parents=True, exist_ok=True)
        (out / "evidence.json").write_text(json.dumps({"v": float(ev.close[0, 1])}), encoding="utf-8")
        (out / "evidence" / "a.json").write_text("{}", encoding="utf-8")
        return {
            "tests": 1,
            "_signals": {"presets": {"x": {"2026-10-07": ["2330"]}}, "labels": {"x": ("X", "x")}},
            "verdict_changes": ["改判"],
        }

    return run


def test_fingerprint_changes_with_any_input():
    code = "c"
    base = evcache.fingerprint(make(), code)
    assert evcache.fingerprint(make(), code) == base
    assert evcache.fingerprint(make(1.5), code) != base
    assert evcache.fingerprint(make(), "other-code") != base
    ev = make()
    ev.revenue = pd.DataFrame({"code": ["2330"], "revenue": [2e9]})
    assert evcache.fingerprint(ev, code) != base
    ev = make()
    ev.etf["0050"]["close"][1] = 3.0
    assert evcache.fingerprint(ev, code) != base


def test_run_cached_reuses_outputs_when_unchanged(tmp_path, monkeypatch):
    monkeypatch.setattr(evcache, "code_fingerprint", lambda root=None: "code-v1")
    cache = tmp_path / "cache"
    calls: list[int] = []
    out1 = tmp_path / "out1"
    out1.mkdir()
    (out1 / "health.json").write_text("{}", encoding="utf-8")  # 評估前就有的檔案不進快取
    r1 = evcache.run_cached(make(), out1, cache, fake_run(calls))
    assert calls == [1] and r1["cached"] is False
    meta = json.loads((cache / "meta.json").read_text(encoding="utf-8"))
    assert meta["files"] == ["evidence.json", "evidence/a.json"]
    # 同樣的輸入：不重算，檔案原樣複製，結果沿用（判定改變不再推播）
    out2 = tmp_path / "out2"
    out2.mkdir()
    r2 = evcache.run_cached(make(), out2, cache, fake_run(calls))
    assert calls == [1] and r2["cached"] is True and r2["verdict_changes"] == []
    assert (out2 / "evidence.json").read_text(encoding="utf-8") == (out1 / "evidence.json").read_text(encoding="utf-8")
    assert r2["_signals"]["presets"] == {"x": {"2026-10-07": ["2330"]}}
    label, subtitle = r2["_signals"]["labels"]["x"]
    assert (label, subtitle) == ("X", "x")
    # 輸入變了 → 重算
    out3 = tmp_path / "out3"
    out3.mkdir()
    r3 = evcache.run_cached(make(2.0), out3, cache, fake_run(calls))
    assert calls == [1, 1] and r3["cached"] is False
    assert json.loads((out3 / "evidence.json").read_text(encoding="utf-8")) == {"v": 2.0}


def test_run_cached_without_cache_dir_always_runs(tmp_path):
    calls: list[int] = []
    evcache.run_cached(make(), tmp_path, None, fake_run(calls))
    evcache.run_cached(make(), tmp_path, None, fake_run(calls))
    assert calls == [1, 1]


def test_corrupt_cache_recomputes(tmp_path, monkeypatch):
    monkeypatch.setattr(evcache, "code_fingerprint", lambda root=None: "code-v1")
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "meta.json").write_text("not json", encoding="utf-8")
    calls: list[int] = []
    out = tmp_path / "out"
    out.mkdir()
    assert evcache.run_cached(make(), out, cache, fake_run(calls))["cached"] is False and calls == [1]


def test_code_fingerprint_covers_pipeline_and_config():
    a = evcache.code_fingerprint()
    assert len(a) == 64 and a == evcache.code_fingerprint()
