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


def text(value: Any, default: str = "") -> str:
    """文字欄位：None／NaN／空白／字面上的 "nan" → default（避免畫面出現「nan」，見 U-07）。"""
    if value is None:
        return default
    if isinstance(value, float | np.floating) and not math.isfinite(float(value)):
        return default
    if value is pd.NaT or (not isinstance(value, str | list | dict | tuple) and pd.isna(value)):
        return default
    s = str(value).strip()
    return default if s == "" or s.lower() in ("nan", "none", "nat", "<na>") else s


def text_or_none(value: Any) -> str | None:
    return text(value) or None


def num_text(value: Any, default: str = "—") -> str:
    """數字轉文字（事件說明用）：NaN → default；整數值不帶 .0。"""
    if value is None or isinstance(value, str):
        return text(value, default)
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return f"{v:g}" if math.isfinite(v) else default


def _sanitize_slow(obj: Any) -> Any:
    if obj is None or isinstance(obj, bool | str | int):
        return obj
    if isinstance(obj, dict):
        return {str(k): sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list | tuple):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float | np.floating):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [sanitize(v) for v in obj.tolist()]
    if obj is pd.NaT or obj is pd.NA:
        return None
    if isinstance(obj, pd.Timestamp):
        return obj.date().isoformat() if obj == obj.normalize() else obj.isoformat()
    return obj


_PLAIN = (str, int, bool, type(None))


def _seq(items: Any) -> list[Any]:
    """list／tuple 的元素：最常見的 float／int／str／None 直接處理，其餘遞迴（避免每個元素一次函式呼叫）。"""
    isfinite = math.isfinite
    out: list[Any] = []
    append = out.append
    for v in items:
        t = type(v)
        if t is float:
            append(v if isfinite(v) else None)
        elif t in _PLAIN:
            append(v)
        else:
            append(sanitize(v))
    return out


def sanitize(obj: Any) -> Any:
    """遞迴清理輸出物件：NaN／inf／NaT → None、numpy 型別 → Python 型別（不改變精度）。

    E-01：個股檔的 dict 欄位（例：short_halt.reason）可能含 NaN，json.dumps 會寫成字面上的 NaN，
    瀏覽器的 JSON.parse 無法解析。write_json 一律先經過這裡，並以 allow_nan=False 在 build 時就失敗。
    2026-10-08：先判斷確切型別走快速路徑（部署時約 1 億次呼叫）；其他型別（numpy、子類別、時間）走 _sanitize_slow，結果相同。
    """
    t = type(obj)
    if t is float:
        return obj if math.isfinite(obj) else None
    if t in _PLAIN:
        return obj
    if t is list or t is tuple:
        return _seq(obj)
    if t is dict:
        isfinite = math.isfinite
        d = {}
        for k, v in obj.items():
            tv = type(v)
            if tv is float:
                d[str(k)] = v if isfinite(v) else None
            elif tv in _PLAIN:
                d[str(k)] = v
            else:
                d[str(k)] = sanitize(v)
        return d
    if t is np.ndarray:
        return _seq(obj.tolist())
    return _sanitize_slow(obj)


def write_json(path: Path, obj: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(sanitize(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(payload, encoding="utf-8")
    return len(gzip.compress(payload.encode("utf-8")))


MAX_GZIP = 300 * 1024
ROWS = "_"  # 整個檔案就是一個陣列時，分檔後放在這個鍵


def write_json_split(path: Path, obj: Any, row_keys: list[str] | None = None, limit: int = MAX_GZIP) -> int:
    """F 節：單一資料檔壓縮後 ≤ 300KB。超過時把 row_keys 指定的陣列（obj 本身是陣列時整個陣列）依列切成 k 份：
    主檔保留其他欄位並加上 parts＝k，分檔 {stem}-{i}.json 只有被切的陣列。前端 api.getJsonParts 讀回並依序接起來。"""
    for f in path.parent.glob(f"{path.stem}-*.json"):
        if f.stem[len(path.stem) + 1 :].isdigit():
            f.unlink()
    size = write_json(path, obj)
    if size <= limit:
        return size
    data: dict[str, Any] = {ROWS: obj} if isinstance(obj, list) else dict(obj)
    keys = [ROWS] if isinstance(obj, list) else [k for k in (row_keys or []) if isinstance(data.get(k), list)]
    if not keys:
        log.warning("%s 壓縮後 %dKB 超過上限，但沒有可切的陣列", path.name, size // 1024)
        return size
    k = size // int(limit * 0.85) + 1
    n = max(len(data[key]) for key in keys)
    step = -(-n // k)
    base = {key: v for key, v in data.items() if key not in keys}
    base["parts"] = k
    base["part_keys"] = keys
    total = write_json(path, base)
    for i in range(k):
        total += write_json(
            path.parent / f"{path.stem}-{i}.json", {key: data[key][i * step : (i + 1) * step] for key in keys}
        )
    return total


# ------------------------------------------------------------------ 健康頁
def stale_warning(entry: dict[str, Any]) -> bool:
    wd, last = entry.get("format_warning_date"), entry.get("last_success")
    return bool(wd and last and str(wd) < str(last))


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
        failed = entry.get("last_status") == "failed"
        # 失敗是否影響「最新」資料：每日型只有落後（或從未成功）才算；回補歷史日期失敗不影響今天的畫面
        # 手動回補型（on_demand，例：集保個股歷史）只補過去，失敗不影響最新資料
        affects_latest = (
            failed
            and cfg.get("frequency") != "on_demand"
            and (cfg.get("frequency") != "daily" or not last or lag is None or lag > 0)
        )
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
                "affects_latest": bool(affects_latest),
                # Q-08：警告日期早於最後成功日 → 是回補舊資料留下的，現在的格式正常，不顯示相容模式
                "format_warnings": [] if stale_warning(entry) else entry.get("format_warnings") or [],
                "format_warning_date": None if stale_warning(entry) else entry.get("format_warning_date"),
                # M3.4：分段更新實測的公布時間（5 分鐘粒度）
                "publish": publish_summary(manifest.get("publish_times", {}).get(sid, [])),
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
        # 2026-10-02 健檢：每個資料集的最新資料日（各頁區塊標自己的資料日，不共用「資料至」）
        "asof": dataset_asof(ds),
        # 2026-10-02 健檢 M2：集保全市場回補進度（資料狀態頁）；nodata 清單太長不輸出
        "backfill": {k: v for k, v in (manifest.get("holders_backfill") or {}).items() if k != "nodata"},
        "backfilled": manifest.get("backfilled", {}),
    }


# 各資料集的最新資料日：鍵名與前端 lib/asof.ts 共用（quotes 收盤行情、insti 法人、credit 信用、valuation 本益比、
# sbl 借券、daytrade 當沖、qfii 外資持股、tdcc 集保、etf_holdings 主動式 ETF 持股、revenue 月營收、financials 季財報、
# taifex 期貨法人、margin_total 融資總計）
def _max_col(df: pd.DataFrame, col: str = "date") -> str | None:
    if df is None or df.empty or col not in df.columns:
        return None
    s = df[col].dropna()
    return str(s.max()) if len(s) else None


def dataset_asof(ds: Dataset) -> dict[str, str | None]:
    return {
        "quotes": _max_col(ds.quotes),
        "insti": _max_col(ds.insti),
        "credit": _max_col(ds.margin),
        "valuation": _max_col(ds.valuation),
        "sbl": _max_col(ds.table("sbl")),
        "daytrade": _max_col(ds.table("daytrade")),
        "qfii": _max_col(ds.table("qfii")),
        "tdcc": _max_col(ds.table("tdcc")),
        "etf_holdings": _max_col(ds.table("etf_holdings")),
        "revenue": _max_col(ds.revenue, "ym"),
        "financials": _max_col(ds.table("financials")) if "date" in ds.table("financials").columns else None,
        "taifex": _max_col(ds.table("taifex_insti")),
        "margin_total": _max_col(ds.margin_total),
        "index": _max_col(ds.index),
    }


def publish_summary(rows: list[dict[str, str]], last: int = 20) -> dict[str, Any] | None:
    """最近 last 次實測的公布時間：中位數、最早、最晚（HH:MM）與天數。"""
    times = sorted(str(r["at"]) for r in rows[-last:] if r.get("at"))
    if not times:
        return None
    return {"median": times[(len(times) - 1) // 2], "earliest": times[0], "latest": times[-1], "days": len(times)}


# ------------------------------------------------------------------ 主流程
def build_web(data_dir: Path, out: Path, *, demo: bool = False, evidence_cache: Path | None = None) -> dict[str, Any]:
    store = DataStore(data_dir)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    ds = dsmod.load(store)
    market_date = ds.last_date
    generated = datetime.now(TPE).isoformat(timespec="seconds")
    health = build_health(ds, market_date)
    write_json(out / "health.json", health)
    from pipeline.core.calendar import TradingCalendar

    meta: dict[str, Any] = {
        "generated_at": generated,
        "market_date": market_date,
        "demo": demo,
        # E-02：前端與 pipeline 共用同一份交易日曆（證交所休市日曆＋臨時休市日）
        "calendar": TradingCalendar.from_store(store, ds.manifest).to_json(),
        "status": "ok" if market_date else "no_data",
        "sources_failed": [s["id"] for s in health["sources"] if s["last_status"] == "failed"],
        # 影響最新資料的異常來源（頁首「N 個資料源異常」只依這份清單與該頁用到的來源判斷）
        "sources_affected": [s["id"] for s in health["sources"] if s["affects_latest"]],
        # M3.4 分段更新：今晚頁狀態列（各段的目標日、狀態、完成時間）與排程
        "stages": ds.manifest.get("stages"),
        "schedule": {k: {"label": v["label"], "time": v["time"]} for k, v in config.load("schedule")["stages"].items()},
        # 2026-10-02 健檢：各資料集最新資料日（前端每個區塊標自己的資料日）
        "asof": health["asof"],
    }
    if not market_date:
        write_json(out / "meta.json", meta)
        log.warning("沒有收盤行情資料：只輸出 meta 與 health")
        return {"status": "no_data"}

    from pipeline.derive import history
    from pipeline.derive.build import build_all

    # M1：指標效度評估用全期間資料（在截衍生計算視窗之前）；每次部署重算，資料補齊後自動移除「樣本範圍受限」
    evidence = build_evidence(ds, out, evidence_cache)
    # v3：衍生計算只用最近一段（約 4.5 年）；更早的收盤另存長歷史檔（stocks/{code}.hist.json）
    full_quotes = history.trim_window(ds)
    report = build_all(ds, out, meta)
    lab = evidence.pop("_signals", None)
    from pipeline.derive.signals import merge_strategy_signals

    evidence["lab_signals"] = merge_strategy_signals(
        out, lab, dict(zip(ds.quotes["code"], ds.quotes["name"], strict=True))
    )
    report["evidence"] = evidence
    # M1.2：族群「今日新觸發」檔數（需要 evidence_today.json）
    from pipeline.derive.sectors import add_triggers

    report["sector_triggers"] = add_triggers(out)
    meta.update(report.get("meta", {}))
    codes = sorted(p.stem for p in (out / "stocks").glob("*.json") if not p.stem.endswith(".hist"))
    report["long_history"] = history.write_long_history(full_quotes, ds, out, codes)
    meta["long_history"] = {k: v for k, v in report["long_history"].items() if k in ("files", "first_date")}
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


def build_evidence(ds: Dataset, out: Path, cache_dir: Path | None = None) -> dict[str, Any]:
    """指標效度評估（M1）→ evidence.json、evidence/{id}.json、evidence_today.json。失敗時寫出空表並記錄原因，不中斷部署。
    cache_dir：輸入資料、程式、設定都沒變時沿用上一次的輸出（derive/evcache.py；2026-10-08）。"""
    try:
        from pipeline.derive.evcache import run_cached
        from pipeline.evidence import data as evdata

        return run_cached(evdata.from_dataset(ds), out, cache_dir)
    except Exception as exc:  # 評估失敗不影響其他頁面
        log.exception("指標效度評估失敗")
        write_json(out / "evidence.json", {"meta": {"error": f"{type(exc).__name__}: {exc}"[:300]}, "rows": []})
        return {"error": str(exc)[:300]}


def is_listed_security(code: str) -> bool:
    return is_common_stock(code) or is_etf(code) or (len(code) == 5 and code[:4].isdigit())


__all__ = [
    "arr",
    "build_web",
    "clean",
    "is_listed_security",
    "num_text",
    "pd",
    "sanitize",
    "text",
    "text_or_none",
    "write_json",
]
