"""每日快照（規格第七節）：資料分支 momentum_flow/snapshots/{YYYY}/{YYYYMMDD}.json.gz，每個交易日一個檔。

內容：資料基準日 T、eff、raw、曝險上限、候選池每檔的等級、K1–K6 數值與判定、PR1M、主族群（candidates.day_rows 的列）。
回補以時點正確的方式計算（面板只用 t 日（含）以前的資料）；既有檔案不重寫（--refresh 才重寫）。
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

SNAPSHOT_DIR = "snapshots"


def snapshot_path(root: Path, day: str) -> Path:
    return root / SNAPSHOT_DIR / day[:4] / f"{day.replace('-', '')}.json.gz"


def existing_days(root: Path) -> set[str]:
    out: set[str] = set()
    base = root / SNAPSHOT_DIR
    if not base.exists():
        return out
    for p in base.glob("*/*.json.gz"):
        s = p.name[:8]
        if s.isdigit():
            out.add(f"{s[:4]}-{s[4:6]}-{s[6:8]}")
    return out


def write_snapshot(root: Path, payload: dict[str, Any]) -> Path:
    path = snapshot_path(root, str(payload["date"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    return path


def read_snapshot(root: Path, day: str) -> dict[str, Any] | None:
    path = snapshot_path(root, day)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return dict(json.load(fh))
