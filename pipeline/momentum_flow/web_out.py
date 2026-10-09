"""前端用 JSON（資料分支 momentum_flow/web/）：latest.json（T 日全部）、history.json（大盤狀態近 250 日）。

前端直接讀資料分支（raw.githubusercontent.com），不經過既有的 build-web／部署流程（隔離規則：既有部署不動）。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from pipeline.momentum_flow import candidates, params
from pipeline.momentum_flow.checklist import K_LABELS, K_NAMES, Panels
from pipeline.momentum_flow.data import FlowData

WEB_DIR = "web"
TPE = ZoneInfo("Asia/Taipei")


def _r(v: Any, d: int = 1) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(f) else round(f, d)


def review_dates(dates: list[str], day: int) -> list[int]:
    """每月 day 日（含）之後第一個交易日的索引（檢查日 R）。"""
    out: list[int] = []
    seen: set[str] = set()
    for i, d in enumerate(dates):
        ym = d[:7]
        if ym in seen:
            continue
        if int(d[8:10]) >= day:
            seen.add(ym)
            out.append(i)
    return out


def next_review_calendar(date: str, day: int) -> str:
    y, m = int(date[:4]), int(date[5:7])
    if int(date[8:10]) >= day:
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return f"{y:04d}-{m:02d}-{day:02d}"


def stocks_table(fd: FlowData, P: Panels, t: int, r: int) -> dict[str, list[Any]]:
    """持股條件監看需要的每檔數值（T 日與檢查日 R）：
    [rs_T, rs_R, yoy_T, yoy_avg3_T, yoy_R, yoy_avg3_R, group_id, gm_T(%), gm_R(%), d1_bits, pass_today, close_T]
    d1_bits：T−2、T−1、T 三日「還原收盤 < MA60」的位元（1＝T−2、2＝T−1、4＝T）；MA60 無值的日子不計。"""
    out: dict[str, list[Any]] = {}
    T = fd.T
    for c, code in enumerate(fd.codes):
        if not np.isfinite(fd.raw_close[t, c]):
            continue
        bits = 0
        for k, i in enumerate((t - 2, t - 1, t)):
            if (
                0 <= i < T
                and np.isfinite(P.ma60[i, c])
                and np.isfinite(fd.close[i, c])
                and fd.close[i, c] < P.ma60[i, c]
            ):
                bits |= 1 << k
        out[code] = [
            _r(P.rs[t, c]),
            _r(P.rs[r, c]),
            _r(P.yoy[t, c]),
            _r(P.yoy_avg3[t, c]),
            _r(P.yoy[r, c]),
            _r(P.yoy_avg3[r, c]),
            fd.group_of.get(code),
            _r(P.gm63[t, c] * 100, 2),
            _r(P.gm63[r, c] * 100, 2),
            bits,
            int(bool(P.passed[t, c])),
            _r(fd.raw_close[t, c], 2),
        ]
    return out


def latest_payload(fd: FlowData, P: Panels, sig: dict[str, Any], mk: dict[str, Any], t: int) -> dict[str, Any]:
    rows = candidates.day_rows(fd, P, t)
    day = int(params.PARAMS["review_day"])
    revs = [i for i in review_dates(fd.dates, day) if i <= t]
    r = revs[-1] if revs else t
    groups = {g: fd.group_names.get(g, g) for g in set(fd.group_of.values())}
    return {
        "version": 1,
        "generated": datetime.now(TPE).strftime("%Y-%m-%d %H:%M"),
        "date": fd.dates[t],
        "market": {k: mk[k] for k in ("state", "raw", "exposure", "entered", "countdown")},
        "funnel": candidates.funnel(rows),
        "lists": candidates.lists(rows),
        "candidates": len(rows),
        "k_names": K_NAMES,
        "k_labels": K_LABELS,
        "k_cols": candidates.K_COLS,
        "params": params.table(),
        "signals": sig.get("params", {}),
        "review": {"R": fd.dates[r], "next": next_review_calendar(fd.dates[t], day), "day": day},
        "lists_from": fd.lists_from,
        "stock_cols": [
            "rs",
            "rs_R",
            "yoy",
            "yoy_avg3",
            "yoy_R",
            "yoy_avg3_R",
            "group",
            "gm3m",
            "gm3m_R",
            "d1_bits",
            "pass",
            "close",
        ],
        "stocks": stocks_table(fd, P, t, r),
        "groups": groups,
    }


def write_json(root: Path, name: str, payload: dict[str, Any]) -> Path:
    path = root / WEB_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path
