"""產生前端用衍生資料（web/public/data）。衍生資料不 commit，部署時產生。

輸出：
- meta.json       產生時間、市場最新交易日、資料狀態
- health.json     各資料源狀態（資料健康頁）
- summary.json    全市場摘要（每檔一列，欄位見 columns）
- stocks/{code}.json  個股歷史（延遲載入）
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.dates import TPE
from pipeline.core.normalize import is_common_stock, is_etf
from pipeline.core.store import DataStore
from pipeline.derive import dataset as dsmod
from pipeline.derive.dataset import Dataset

log = logging.getLogger(__name__)
SUMMARY_LIMIT_BYTES = 800 * 1024


def clean(value: Any, digits: int = 4) -> Any:
    """JSON 友善：NaN/inf → None；浮點數四捨五入。"""
    if value is None:
        return None
    if isinstance(value, float | np.floating):
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return None
        r = round(v, digits)
        return int(r) if r == int(r) and abs(r) < 1e15 else r
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def arr(values: Any, digits: int = 4) -> list[Any]:
    return [clean(v, digits) for v in values]


def write_json(path: Path, obj: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(gzip.compress(text.encode("utf-8")))


# ------------------------------------------------------------------ 健康頁
def build_health(ds: Dataset, market_date: str | None) -> dict[str, Any]:
    manifest = ds.manifest
    src_cfg = config.sources()
    rows = []
    trading = ds.dates
    for sid, cfg in src_cfg.items():
        entry = manifest.get("sources", {}).get(sid, {})
        last = entry.get("last_success")
        lag = None
        if last and market_date and cfg.get("frequency") == "daily":
            lag = sum(1 for d in trading if last < d <= market_date)
        status = cfg.get("status", "unverified")
        rows.append(
            {
                "id": sid,
                "label": cfg.get("label", sid),
                "tier": cfg.get("tier"),
                "market": cfg.get("market"),
                "frequency": cfg.get("frequency"),
                "verified": status,
                "last_success": last,
                "last_status": entry.get("last_status"),
                "last_message": entry.get("last_message"),
                "last_attempt": entry.get("last_attempt"),
                "rows": entry.get("rows"),
                "lag_days": lag,
                "consecutive_failures": entry.get("consecutive_failures", 0),
            }
        )
    return {
        "market_date": market_date,
        "sources": rows,
        "closed_days": manifest.get("closed_days", []),
        "runs": list(reversed(manifest.get("runs", [])))[:15],
        "coverage": manifest.get("coverage", {}),
        "trading_days": len(trading),
        "first_date": trading[0] if trading else None,
    }


# ------------------------------------------------------------------ 主流程
def build_web(data_dir: Path, out: Path, *, demo: bool = False) -> dict[str, Any]:
    store = DataStore(data_dir)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    ds = dsmod.load(store)
    market_date = ds.last_date
    generated = datetime.now(TPE).isoformat(timespec="seconds")
    health = build_health(ds, market_date)
    write_json(out / "health.json", health)
    meta: dict[str, Any] = {
        "generated_at": generated,
        "market_date": market_date,
        "demo": demo,
        "status": "ok" if market_date else "no_data",
        "sources_failed": [s["id"] for s in health["sources"] if s["last_status"] == "failed"],
    }
    if not market_date:
        write_json(out / "meta.json", meta)
        log.warning("沒有收盤行情資料：只輸出 meta 與 health")
        return {"status": "no_data"}

    from pipeline.derive.build import build_all

    report = build_all(ds, out, meta)
    meta.update(report.get("meta", {}))
    if not demo:
        from pipeline.derive import ai_summary

        meta["ai_summary"] = ai_summary.generate(out) is not None
    write_json(out / "meta.json", meta)
    summary_path = out / "summary.json"
    size = len(gzip.compress(summary_path.read_bytes())) if summary_path.exists() else 0
    report["summary_gzip_bytes"] = size
    if size > SUMMARY_LIMIT_BYTES:
        log.warning("summary.json gzip %d bytes 超過 800KB", size)
    return {k: v for k, v in report.items() if k != "meta"}


def is_listed_security(code: str) -> bool:
    return is_common_stock(code) or is_etf(code) or (len(code) == 5 and code[:4].isdigit())


__all__ = ["arr", "build_web", "clean", "is_listed_security", "pd", "write_json"]
