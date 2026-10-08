"""指標效度評估（evidence）的快取（2026-10-08）。

build-web 每次都把全期間的事件研究、隨機對照、期間檢視重算一次，約佔部署時間三成；但一天裡的多次部署
（補抓、重試、5 分 K 分段、合併程式）多數時候 evidence 的輸入完全相同。這裡以「輸入資料（EvData 的每個陣列）
＋ pipeline 程式碼＋ config」的雜湊當 key：與上一次相同就直接沿用上一次寫出的檔案與結果，任何一項不同就重算。
快取目錄由 deploy.yml 以 actions/cache 保存（沒有快取時照常重算，結果相同）。
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

#: 快取格式或判斷方式改變時加 1（舊快取一律不用）
CACHE_VERSION = 1
ROOT = Path(__file__).resolve().parents[2]


def _feed(h: Any, obj: Any) -> None:
    if isinstance(obj, np.ndarray):
        h.update(b"nd" + obj.dtype.str.encode() + repr(obj.shape).encode())
        if obj.dtype == object:
            h.update(repr(obj.tolist()).encode())
        else:
            h.update(np.ascontiguousarray(obj).tobytes())
    elif isinstance(obj, pd.DataFrame):
        h.update(b"df" + repr(list(obj.columns)).encode() + repr(obj.shape).encode())
        if len(obj):
            h.update(pd.util.hash_pandas_object(obj, index=True).to_numpy().tobytes())
    elif isinstance(obj, dict):
        h.update(b"{" + str(len(obj)).encode())
        for k in sorted(obj, key=str):
            h.update(repr(k).encode())
            _feed(h, obj[k])
    elif isinstance(obj, list | tuple):
        h.update(b"[" + str(len(obj)).encode())
        for v in obj:
            _feed(h, v)
    else:
        h.update(repr(obj).encode())


def code_fingerprint(root: Path = ROOT) -> str:
    """pipeline 程式碼與 config 的雜湊（改了任何一個檔案就重算 evidence）。"""
    h = hashlib.sha256()
    for base in ("pipeline", "config"):
        for p in sorted((root / base).rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc":
                h.update(str(p.relative_to(root)).encode())
                h.update(p.read_bytes())
    return h.hexdigest()


def fingerprint(ev: Any, code: str | None = None) -> str:
    h = hashlib.sha256(f"evidence-cache-v{CACHE_VERSION}".encode())
    h.update((code if code is not None else code_fingerprint()).encode())
    if is_dataclass(ev):
        for f in fields(ev):
            h.update(f.name.encode())
            _feed(h, getattr(ev, f.name))
    else:
        _feed(h, ev)
    return h.hexdigest()


def _snapshot(out: Path) -> dict[str, int]:
    return {str(p.relative_to(out)): p.stat().st_mtime_ns for p in out.rglob("*") if p.is_file()}


def run_cached(ev: Any, out: Path, cache_dir: Path | None, run: Any = None) -> dict[str, Any]:
    """run(ev, out) 的結果；cache_dir 有相同 key 的快取時直接沿用（不推播判定改變：上一次已推播過）。"""
    if run is None:
        from pipeline.evidence.run import run_and_write

        def run(e: Any, o: Path) -> dict[str, Any]:
            return run_and_write(e, o, None)

    if cache_dir is None:
        return dict(run(ev, out))
    key = fingerprint(ev)
    meta_path = cache_dir / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    except (OSError, ValueError):
        meta = {}
    files = meta.get("files") or []
    if meta.get("key") == key and files and all((cache_dir / "files" / f).is_file() for f in files):
        for f in files:
            dst = out / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cache_dir / "files" / f, dst)
        log.info("指標效度評估：輸入、程式與設定都沒變，沿用快取（%d 個檔案）", len(files))
        res = dict(meta.get("result") or {})
        res["verdict_changes"] = []
        res["cached"] = True
        return res
    before = _snapshot(out)
    res = dict(run(ev, out))
    after = _snapshot(out)
    written = sorted(f for f, t in after.items() if before.get(f) != t)
    try:
        from pipeline.derive.export import sanitize

        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        (cache_dir / "files").mkdir(parents=True)
        for f in written:
            dst = cache_dir / "files" / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out / f, dst)
        meta_path.write_text(
            json.dumps({"key": key, "files": written, "result": sanitize(res)}, ensure_ascii=False), encoding="utf-8"
        )
    except OSError as exc:  # 快取寫不進去不影響部署
        log.warning("指標效度評估快取寫入失敗：%s", exc)
    res["cached"] = False
    return res
