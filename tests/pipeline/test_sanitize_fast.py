"""2026-10-08：sanitize 的快速路徑與原本的遞迴版本輸出完全相同（write_json 一律經過這裡）。"""

from __future__ import annotations

import json
import math
import random

import numpy as np
import pandas as pd

from pipeline.derive.export import sanitize


def original(obj):  # 2026-10-08 以前的實作（對照用）
    if obj is None or isinstance(obj, bool | str | int):
        return obj
    if isinstance(obj, dict):
        return {str(k): original(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [original(v) for v in obj]
    if isinstance(obj, float | np.floating):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [original(v) for v in obj.tolist()]
    if obj is pd.NaT or obj is pd.NA:
        return None
    if isinstance(obj, pd.Timestamp):
        return obj.date().isoformat() if obj == obj.normalize() else obj.isoformat()
    return obj


LEAVES = [
    lambda r: r.uniform(-1e6, 1e6),
    lambda r: float("nan"),
    lambda r: float("inf"),
    lambda r: -float("inf"),
    lambda r: r.randrange(-1000, 1000),
    lambda r: r.random() < 0.5,
    lambda r: None,
    lambda r: "文字",
    lambda r: np.float64(r.uniform(-5, 5)),
    lambda r: np.float32(r.uniform(-5, 5)),
    lambda r: np.float64("nan"),
    lambda r: np.int64(r.randrange(100)),
    lambda r: np.bool_(r.random() < 0.5),
    lambda r: pd.NaT,
    lambda r: pd.Timestamp("2026-10-08"),
    lambda r: pd.Timestamp("2026-10-08 13:20"),
    lambda r: np.array([1.0, np.nan, 3.5]),
    lambda r: np.array([[1, 2], [3, 4]]),
]


def build(r: random.Random, depth: int = 0):
    k = r.random()
    if depth < 4 and k < 0.25:
        return {(r.randrange(5) if r.random() < 0.2 else f"k{i}"): build(r, depth + 1) for i in range(r.randrange(6))}
    if depth < 4 and k < 0.5:
        seq = [build(r, depth + 1) for _ in range(r.randrange(8))]
        return tuple(seq) if r.random() < 0.3 else seq
    return r.choice(LEAVES)(r)


def test_sanitize_matches_original_on_random_trees():
    r = random.Random(42)
    for _ in range(2000):
        obj = build(r)
        assert json.dumps(sanitize(obj), allow_nan=False) == json.dumps(original(obj), allow_nan=False)


def test_sanitize_keeps_types():
    out = sanitize({"a": [1, 2.5, None, True, "x"], "b": (np.float64(1.0), np.int64(2)), 3: float("nan")})
    assert out == {"a": [1, 2.5, None, True, "x"], "b": [1.0, 2], "3": None}
    assert type(out["b"][0]) is float and type(out["b"][1]) is int
