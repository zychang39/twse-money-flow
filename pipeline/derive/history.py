"""長歷史股價（v3 M5）：收盤行情回補到 10 年前，但指標、分數、回測與個股檔只用最近一段（衍生計算視窗）。

- trim_window：把 Dataset 的每日型資料截到最近 N 個交易日（config/sources.yml history.derive_window_days），
  計算量與個股檔大小不隨歷史長度成長。
- write_long_history：只要收盤行情比視窗長，就為每一檔另存 `stocks/{code}.hist.json`
  （日期、收盤、還原因子），前端選 5Y／10Y／ALL 時才載入（週線取樣）。還原因子以完整歷史計算
  （官方除權息＋推估跳空），與個股檔同一個基準（最新一日＝1）。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.core import config
from pipeline.derive import adjust
from pipeline.derive import indicators as ind
from pipeline.derive.dataset import Dataset, pivot
from pipeline.derive.export import arr, write_json

log = logging.getLogger(__name__)

DAILY_ATTRS = ("quotes", "insti", "margin", "valuation")


def window_days() -> int:
    return int(config.history().get("derive_window_days", 1100))


def trim_window(ds: Dataset, days: int | None = None) -> pd.DataFrame:
    """截到最近 days 個交易日；回傳截斷前的完整收盤行情（給長歷史用）。"""
    full = ds.quotes
    dates = ds.dates
    n = days or window_days()
    if len(dates) <= n:
        return full
    cutoff = dates[-n]
    for attr in DAILY_ATTRS:
        df = getattr(ds, attr)
        if not df.empty and "date" in df.columns:
            setattr(ds, attr, df[df["date"] >= cutoff].reset_index(drop=True))
    log.info("衍生計算視窗：最近 %d 個交易日（%s 起）；收盤行情共 %d 個交易日", n, cutoff, len(dates))
    return full


def long_history(full_quotes: pd.DataFrame, ds: Dataset, codes: list[str]) -> dict[str, dict[str, Any]]:
    """每檔的完整日期、收盤、還原因子（只含有收盤價的日子）。"""
    if full_quotes.empty:
        return {}
    q = full_quotes[full_quotes["code"].isin(codes)]
    dates = sorted(q["date"].unique().tolist())
    close = pivot(q, "close", dates)
    open_ = pivot(q, "open", dates)
    change = pivot(q, "change", dates)
    events = adjust.all_events(close, open_, change, *adjust.tag_official(ds))
    af = ind.adjustment_table(dates, list(close.columns), events)
    out: dict[str, dict[str, Any]] = {}
    for code in close.columns:
        c = close[code]
        mask = c.notna().to_numpy()
        idx = [d for d, ok in zip(dates, mask, strict=True) if ok]
        if not idx:
            continue
        out[code] = {
            "code": code,
            "d": idx,
            "c": arr(c[mask].to_numpy(), 2),
            "af": arr(af[code][mask].to_numpy(), 6),
        }
    return out


def write_long_history(full_quotes: pd.DataFrame, ds: Dataset, out: Path, codes: list[str]) -> dict[str, Any]:
    """收盤行情比衍生視窗長時才輸出；回傳檔數與大小統計（DATA_SOURCES 記錄用）。"""
    if full_quotes.empty or full_quotes["date"].nunique() <= len(ds.dates):
        return {"files": 0}
    hist = long_history(full_quotes, ds, codes)
    sizes = [write_json(out / "stocks" / f"{code}.hist.json", h) for code, h in hist.items()]
    first = min((h["d"][0] for h in hist.values()), default=None)
    return {
        "files": len(sizes),
        "first_date": first,
        "gzip_avg_bytes": int(sum(sizes) / len(sizes)) if sizes else 0,
        "gzip_max_bytes": max(sizes, default=0),
    }
