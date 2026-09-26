"""其他頁面的衍生資料：預先計算的回測、自訂回測面板、市場頁、行事曆、週報等。"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock, is_etf
from pipeline.derive import backtest as bt
from pipeline.derive.export import clean, write_json

log = logging.getLogger(__name__)

TAIEX = "發行量加權股價指數"
TAIEX_TR = "發行量加權股價報酬指數"


def index_series(ds: Any, name: str, dates: list[str]) -> pd.Series:
    if ds.index.empty:
        return pd.Series(np.nan, index=dates)
    s = ds.index[ds.index["name"] == name].drop_duplicates("date", keep="last").set_index("date")["close"]
    return s.reindex(dates).astype(float)


def disposition_mask(ds: Any, dates: list[str], codes: list[str]) -> np.ndarray:
    mask = np.zeros((len(dates), len(codes)), dtype=bool)
    if ds.disposition.empty:
        return mask
    pos = {c: i for i, c in enumerate(codes)}
    arr = np.array(dates)
    for _, r in ds.disposition.dropna(subset=["start", "end"]).iterrows():
        c = pos.get(r["code"])
        if c is None:
            continue
        mask[(arr >= r["start"]) & (arr <= r["end"]), c] = True
    return mask


def build_prices(ds: Any, p: Any) -> bt.Prices:
    af = p.af.to_numpy()
    op = p.open.to_numpy() * af
    lo = p.low.to_numpy() * af
    cl = p.close.to_numpy() * af
    vol = p.volume.to_numpy()
    tradable = np.isfinite(op) & (np.nan_to_num(vol) > 0)
    taiex = index_series(ds, TAIEX, p.dates)
    ma240 = taiex.rolling(240, min_periods=240).mean()
    regime = (taiex > ma240).fillna(False).to_numpy()
    bench = index_series(ds, TAIEX_TR, p.dates).to_numpy()
    return bt.Prices(
        dates=p.dates,
        codes=p.codes,
        open=op,
        low=lo,
        close=cl,
        tradable=tradable,
        blocked=disposition_mask(ds, p.dates, p.codes),
        bench=bench,
        regime_up=regime,
        is_etf=np.array([is_etf(c) for c in p.codes]),
    )


def field_lookup(mp: Any, sc: dict[str, pd.DataFrame]) -> Callable[[str], np.ndarray | None]:
    def lookup(field: str) -> np.ndarray | None:
        if field in sc:
            return sc[field].to_numpy(dtype=float)
        if field in mp.panels:
            return mp.panels[field].to_numpy(dtype=float)
        return None

    return lookup


def preset_backtests(ds: Any, p: Any, mp: Any, sc: dict[str, pd.DataFrame], out: Path) -> dict[str, Any]:
    px = build_prices(ds, p)
    lookup = field_lookup(mp, sc)
    index = []
    for preset in config.load("screener")["presets"]:
        mask = bt.conditions_mask(preset["conditions"], lookup)
        if mask is None:
            index.append({"id": preset["id"], "label": preset["label"], "status": "資料不足"})
            continue
        res = bt.run(mask, px)
        summary = bt.summarize(res, p.dates)
        summary.update(
            {
                "id": preset["id"],
                "label": preset["label"],
                "description": preset["description"],
                "conditions": preset["conditions"],
                "signals": int(mask.sum()),
            }
        )
        names = {c: p.names.get(c, c) for c in {t["code"] for t in summary["trades"]}}
        summary["names"] = names
        write_json(out / "backtests" / f"{preset['id']}.json", summary)
        index.append(
            {
                "id": preset["id"],
                "label": preset["label"],
                "signals": int(mask.sum()),
                "n10": summary["horizons"].get("10", {}).get("all", {}).get("n", 0),
            }
        )
    write_json(
        out / "backtests" / "index.json", {"presets": index, "period": {"start": p.dates[0], "end": p.dates[-1]}}
    )
    return {"backtests": len(index)}


def _round(a: np.ndarray, digits: int) -> list[Any]:
    return [[clean(v, digits) for v in row] for row in a]


def custom_panel(
    ds: Any, p: Any, mp: Any, sc: dict[str, pd.DataFrame], out: Path, universe: int = 600, days: int = 500
) -> dict[str, Any]:
    """前端 Web Worker 自訂條件回測用的精簡面板：成交值前 N 檔、最近 M 個交易日。"""
    value = p.value.iloc[-250:].mean()
    eligible = [c for c in p.codes if is_common_stock(c) or is_etf(c)]
    ranked = value[eligible].dropna().sort_values(ascending=False).index[:universe].tolist()
    codes = sorted(ranked)
    if not codes:
        return {}
    sl = slice(max(0, len(p.dates) - days), len(p.dates))
    dates = p.dates[sl]
    px = build_prices(ds, p)
    ci = [p.codes.index(c) for c in codes]
    base = out / "bt"
    write_json(
        base / "meta.json",
        {
            "dates": dates,
            "codes": codes,
            "names": [p.names.get(c, c) for c in codes],
            "is_etf": [bool(is_etf(c)) for c in codes],
            "bench": [clean(v, 2) for v in px.bench[sl]],
            "regime_up": [bool(v) for v in px.regime_up[sl]],
            "fields": [f for f in config.load("screener")["fields"] if f in sc or f in mp.panels],
        },
    )
    blocked = np.argwhere(px.blocked[sl][:, ci])
    write_json(
        base / "prices.json",
        {
            "open": _round(px.open[sl][:, ci], 3),
            "low": _round(px.low[sl][:, ci], 3),
            "close": _round(px.close[sl][:, ci], 3),
            "tradable": [[1 if v else 0 for v in row] for row in px.tradable[sl][:, ci]],
            "blocked": blocked.tolist(),
        },
    )
    lookup = field_lookup(mp, sc)
    count = 0
    for field in config.load("screener")["fields"]:
        arr = lookup(field)
        if arr is None:
            continue
        write_json(base / "f" / f"{field}.json", _round(arr[sl][:, ci], 2))
        count += 1
    return {"custom_universe": len(codes), "custom_days": len(dates), "custom_fields": count}


def build_extras(ds: Any, p: Any, mp: Any, sc: Any, fv: Any, out: Path) -> dict[str, Any]:
    report: dict[str, Any] = {}
    report.update(preset_backtests(ds, p, mp, sc, out))
    report.update(custom_panel(ds, p, mp, sc, out))
    return report
