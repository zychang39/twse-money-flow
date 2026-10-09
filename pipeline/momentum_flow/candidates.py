"""候選池的每日列（規格第三、四、五節）：候選、K1–K6 明細、三個清單（篩出／新觸發／差一項）與漏斗。"""

from __future__ import annotations

from typing import Any

import numpy as np

from pipeline.momentum_flow.checklist import FAIL, K_NAMES, LEVELS, NA, PASS, Panels
from pipeline.momentum_flow.data import FlowData
from pipeline.momentum_flow.ordering import sort_rows
from pipeline.momentum_flow.params import PARAMS

K_COLS = {
    "K1": ["rs", "min", "max"],
    "K2": ["pr12m", "pr3m"],
    "K3": ["r63_pct", "group_pct"],
    "K4": ["close", "ma60", "h250"],
    "K5": ["disposition", "attention", "limit_ups"],
    "K6": ["value20"],
}


def _r(v: float, d: int = 2) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def day_rows(fd: FlowData, P: Panels, t: int, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """t 列的候選列（未排序）。k＝[[判定, 數值…] × 6]，數值欄位見 K_COLS。"""
    p = params or PARAMS
    idx = np.flatnonzero(P.level[t] > 0)
    prev_pass = P.passed[t - 1] if t > 0 else np.zeros(fd.C, dtype=bool)
    rows: list[dict[str, Any]] = []
    for c in idx:
        code = fd.codes[c]
        lvl = int(P.level[t, c])
        ks = [int(P.k[i, t, c]) for i in range(6)]
        n_pass = sum(1 for x in ks if x == PASS)
        near = None
        if n_pass == 5 and NA not in ks:
            near = K_NAMES[ks.index(FAIL)]
        lo = p["k1_rs_min_a"] if lvl == 1 else p["k1_rs_min"]
        g = fd.group_of.get(code)
        rows.append(
            {
                "code": code,
                "name": fd.names.get(code, code),
                "level": LEVELS[lvl],
                "group": g,
                "group_name": fd.group_names.get(g, "") if g else None,
                "rs": _r(P.rs[t, c], 1),
                "pr1m": _r(P.pr1m[t, c], 1),
                "pr3m": _r(P.pr3m[t, c], 1),
                "pr12m": _r(P.pr12m[t, c], 1),
                "close": _r(fd.raw_close[t, c], 2),
                "ref": bool(P.ref[t, c]),
                "pullback": bool(np.isfinite(P.pr1m[t, c]) and P.pr1m[t, c] <= p["pr1m_pullback"]),
                "k": [
                    [ks[0], _r(P.rs[t, c], 1), lo, p["k1_rs_max"]],
                    [ks[1], _r(P.pr12m[t, c], 1), _r(P.pr3m[t, c], 1)],
                    [ks[2], _r(P.r63[t, c] * 100, 2), _r(P.gm63[t, c] * 100, 2)],
                    [ks[3], _r(fd.close[t, c], 2), _r(P.ma60[t, c], 2), _r(P.h250[t, c], 2)],
                    [ks[4], int(fd.in_disposition[t, c]), int(fd.in_attention[t, c]), _r(P.limit_count[t, c], 0)],
                    [ks[5], _r(P.value20[t, c], 0)],
                ],
                "n_pass": n_pass,
                "pass": bool(P.passed[t, c]),
                "new": bool(P.passed[t, c] and not prev_pass[c]),
                "near": near,
            }
        )
    return sort_rows(rows)


def funnel(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """漏斗：候選數 → 各項通過數 → 全通過數；另列各項未通過與資料不足的代號（點任一層可看被濾掉的股票）。"""
    out: dict[str, Any] = {"candidates": len(rows), "k": {}, "pass": sum(1 for r in rows if r["pass"])}
    for i, k in enumerate(K_NAMES):
        out["k"][k] = {
            "pass": sum(1 for r in rows if r["k"][i][0] == PASS),
            "fail": [r["code"] for r in rows if r["k"][i][0] == FAIL],
            "na": [r["code"] for r in rows if r["k"][i][0] == NA],
        }
    return out


def lists(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    return {
        "pass": [r for r in rows if r["pass"]],
        "new": [r for r in rows if r["new"]],
        "near": [r for r in rows if r["near"]],
    }
