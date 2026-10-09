"""每日快照（規格第七節）：資料分支 momentum_flow/snapshots/{YYYY}/{YYYYMMDD}.json.gz，每個交易日一個檔。

內容：資料基準日 T、eff、raw、曝險上限、候選池每檔的等級、K1–K6 數值與判定、PR1M、主族群（candidates.day_rows 的列）。
回補以時點正確的方式計算（面板只用 t 日（含）以前的資料）；既有檔案不重寫（--refresh 才重寫），
但最近 rewrite_recent_days 個交易日每次都重算（收盤後陸續補進的法人、注意／處置名單）。
寫入是原子的（暫存檔＋改名），gzip 時間戳固定為 0：內容相同時位元相同。
"""

from __future__ import annotations

import gzip
import io
import json
import os
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


def atomic_write(path: Path, data: bytes) -> None:
    """暫存檔寫完再改名：執行中被中斷（逾時、取消）不會留下半個檔案被提交。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def gzip_json(payload: dict[str, Any]) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    return buf.getvalue()


def write_snapshot(root: Path, payload: dict[str, Any]) -> Path:
    path = snapshot_path(root, str(payload["date"]))
    atomic_write(path, gzip_json(payload))
    return path


def read_snapshot(root: Path, day: str) -> dict[str, Any] | None:
    path = snapshot_path(root, day)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return dict(json.load(fh))
