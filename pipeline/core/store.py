"""資料儲存：data 分支上的 raw/{來源}/{YYYY}/{YYYYMMDD}.csv.gz 與 manifest.json。"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.core.dates import TPE, parse_date

TEXT_COLUMNS = {
    "code",
    "name",
    "market",
    "industry",
    "industry_code",
    "kind",
    "reason",
    "measure",
    "note",
    "party",
    "contract",
    "ym",
    "report_date",
    "first_seen",
    "date",
    "start",
    "end",
    "announce_date",
    "fin_period",
    "situation",
    "method",
    "holder_type",
    "holder",
    "period",
    "session",
    "title",
    "description",
}


class DataStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.raw = self.root / "raw"

    # ---------- 路徑 ----------
    def path(self, source: str, d: date) -> Path:
        return self.raw / source / f"{d.year:04d}" / f"{d:%Y%m%d}.csv.gz"

    def exists(self, source: str, d: date) -> bool:
        return self.path(source, d).exists()

    def dates(self, source: str) -> list[date]:
        base = self.raw / source
        if not base.exists():
            return []
        out = []
        for p in base.glob("*/*.csv.gz"):
            d = parse_date(p.name.split(".")[0])
            if d:
                out.append(d)
        return sorted(out)

    # ---------- 讀寫 ----------
    def write(self, source: str, d: date, df: pd.DataFrame) -> Path:
        path = self.path(source, d)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        df.to_csv(tmp, index=False, compression={"method": "gzip", "mtime": 0}, lineterminator="\n")
        os.replace(tmp, path)
        return path

    def read(self, source: str, d: date) -> pd.DataFrame | None:
        path = self.path(source, d)
        if not path.exists():
            return None
        return read_csv_gz(path)

    def latest(self, source: str, before: date | None = None) -> tuple[date, pd.DataFrame] | None:
        for d in reversed(self.dates(source)):
            if before is None or d < before:
                df = self.read(source, d)
                if df is not None:
                    return d, df
        return None

    def read_range(self, source: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
        frames = []
        for d in self.dates(source):
            if (start and d < start) or (end and d > end):
                continue
            df = self.read(source, d)
            if df is not None and not df.empty:
                frames.append(df)
        if not frames:
            return pd.DataFrame()
        return pd.concat(frames, ignore_index=True)

    def upsert(self, source: str, d: date, df: pd.DataFrame, keys: Iterable[str]) -> pd.DataFrame:
        """合併寫入（月／年檔）：以 keys 為鍵，新資料覆蓋舊資料。"""
        keys = list(keys)
        old = self.read(source, d)
        if old is not None and not old.empty:
            merged = pd.concat([old, df], ignore_index=True)
            merged = merged.drop_duplicates(subset=keys, keep="last")
        else:
            merged = df
        merged = merged.sort_values(keys).reset_index(drop=True)
        self.write(source, d, merged)
        return merged

    # ---------- manifest ----------
    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def load_manifest(self) -> dict[str, Any]:
        if self.manifest_path.exists():
            data: dict[str, Any] = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            return data
        return {"version": 1, "sources": {}, "runs": [], "closed_days": []}

    def save_manifest(self, manifest: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        manifest["updated_at"] = datetime.now(TPE).isoformat(timespec="seconds")
        text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True)
        self.manifest_path.write_text(text + "\n", encoding="utf-8")


def read_csv_gz(path: Path) -> pd.DataFrame:
    head = pd.read_csv(path, nrows=0)
    dtypes = {c: str for c in head.columns if c in TEXT_COLUMNS}
    return pd.read_csv(path, dtype=dtypes, keep_default_na=True)  # type: ignore[arg-type]


def record(
    manifest: dict[str, Any],
    source: str,
    *,
    status: str,
    data_date: date | None = None,
    rows: int | None = None,
    message: str | None = None,
) -> None:
    """更新 manifest 中某來源的狀態。status：ok / failed / no_data / skipped / pending。"""
    entry = manifest.setdefault("sources", {}).setdefault(source, {})
    now = datetime.now(TPE).isoformat(timespec="seconds")
    entry["last_attempt"] = now
    entry["last_status"] = status
    entry["last_message"] = message
    if status == "ok":
        entry["last_success_at"] = now
        if data_date is not None:
            prev = entry.get("last_success")
            if prev is None or str(data_date) >= prev:
                entry["last_success"] = data_date.isoformat()
                entry["rows"] = rows
        entry["validation"] = "ok"
        entry["consecutive_failures"] = 0
    elif status == "failed":
        entry["validation"] = "failed"
        entry["consecutive_failures"] = int(entry.get("consecutive_failures", 0)) + 1
