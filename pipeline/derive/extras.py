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


def index_file(ds: Any, p: Any, out: Path) -> None:
    """大盤指數序列（投資組合比較基準、市場頁）。"""
    series = {}
    for name in (TAIEX, TAIEX_TR):
        s = index_series(ds, name, p.dates)
        series[name] = [clean(v, 2) for v in s.to_numpy()]
    tpex = ds.index[(ds.index["name"] == "櫃買指數")] if not ds.index.empty else pd.DataFrame()
    if not tpex.empty:
        s = tpex.drop_duplicates("date", keep="last").set_index("date")["close"].reindex(p.dates)
        series["櫃買指數"] = [clean(v, 2) for v in s.to_numpy()]
    write_json(out / "index.json", {"dates": p.dates, "series": series})


def sector_rotation(p: Any) -> list[dict[str, Any]]:
    """產業資金輪動：法人淨買超金額（億元）與還原報酬中位數（%），期間 1／5／20 日。"""
    adj = p.adj_close
    amount = p.total_net * p.close  # 元
    groups: dict[str, list[str]] = {}
    for code in p.codes:
        ind = p.industries.get(code)
        if not ind or ind in ("ETF", "存託憑證", "管理股票") or not is_common_stock(code):
            continue
        if pd.isna(p.close[code].iloc[-1]):
            continue
        groups.setdefault(ind, []).append(code)
    rows = []
    for ind, codes in groups.items():
        row: dict[str, Any] = {"industry": ind, "count": len(codes)}
        for k in (1, 5, 20):
            if len(p.dates) <= k:
                continue
            amt = amount[codes].iloc[-k:].sum().sum()
            ret = (adj[codes].iloc[-1] / adj[codes].iloc[-1 - k] - 1).dropna()
            row[f"net_{k}"] = clean(amt / 1e8, 2)
            row[f"ret_{k}"] = clean(float(ret.median()) * 100 if len(ret) else None, 2)
        f1 = (p.foreign_net[codes].iloc[-1] * p.close[codes].iloc[-1]).sum()
        t1 = (p.trust_net[codes].iloc[-1] * p.close[codes].iloc[-1]).sum()
        row["foreign_1"] = clean(f1 / 1e8, 2)
        row["trust_1"] = clean(t1 / 1e8, 2)
        chg = (adj[codes].iloc[-1] / adj[codes].iloc[-2] - 1) if len(p.dates) >= 2 else pd.Series(dtype=float)
        row["up"] = int((chg > 0).sum())
        row["down"] = int((chg < 0).sum())
        rows.append(row)
    rows.sort(key=lambda r: -(r.get("net_5") or 0))
    return rows


def market_file(ds: Any, p: Any, mp: Any, out: Path) -> dict[str, Any]:
    taiex = index_series(ds, TAIEX, p.dates)
    k = min(len(p.dates), 60)
    flows = []
    for i in range(len(p.dates) - k, len(p.dates)):
        d = p.dates[i]
        close = p.close.iloc[i]
        flows.append(
            {
                "date": d,
                "foreign": clean(float((p.foreign_net.iloc[i] * close).sum()) / 1e8, 2),
                "trust": clean(float((p.trust_net.iloc[i] * close).sum()) / 1e8, 2),
                "dealer": clean(float((p.dealer_net.iloc[i] * close).sum()) / 1e8, 2),
            }
        )
    chg = p.close.iloc[-1] - p.close.iloc[-2] if len(p.dates) >= 2 else pd.Series(dtype=float)
    data: dict[str, Any] = {
        "date": p.dates[-1],
        "taiex": {
            "close": clean(taiex.iloc[-1], 2),
            "change": clean(taiex.iloc[-1] - taiex.iloc[-2], 2) if len(taiex) >= 2 else None,
            "ma240": clean(taiex.rolling(240, min_periods=240).mean().iloc[-1], 2),
        },
        "breadth": {"up": int((chg > 0).sum()), "down": int((chg < 0).sum()), "flat": int((chg == 0).sum())},
        "flows": flows,
        "sectors": sector_rotation(p),
    }
    write_json(out / "market.json", data)
    return data


def build_extras(ds: Any, p: Any, mp: Any, sc: Any, fv: Any, out: Path) -> dict[str, Any]:
    report: dict[str, Any] = {}
    index_file(ds, p, out)
    market_file(ds, p, mp, out)
    report.update(preset_backtests(ds, p, mp, sc, out))
    report.update(custom_panel(ds, p, mp, sc, out))
    return report
