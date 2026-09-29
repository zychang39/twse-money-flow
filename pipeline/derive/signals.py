"""選股「今日新觸發」與訊號追蹤（S2／S3）的前端資料。

- screen_days.json：全市場最近兩個交易日的所有選股欄位值（前端切到「今日新觸發」時才下載），
  以及週資料（集保大戶）的資料基準日與公布日。新觸發的定義與回測相同（backtest.new_triggers）。
- signals.json：每個內建策略在最近 N 個交易日的「今日新觸發」（全市場，預先計算），
  以及觸發過的股票從第一次觸發起的還原開盤／收盤價與加權報酬指數，供紀律頁「訊號追蹤」紙上交易使用。
  前端只記錄啟用追蹤之後的觸發（前瞻驗證），見 METHODOLOGY §5.3。
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.export import clean, write_json
from pipeline.derive.extras import TAIEX_TR, build_prices, field_lookup, index_series, preset_signals

WEEKLY_FIELDS = ("whale_pct", "whale_change", "whale400_pct")


def _r(v: Any, digits: int = 4) -> float | None:
    return clean(v, digits)


def weekly_asof(ds: Any) -> dict[str, Any] | None:
    """集保大戶：最新資料基準日（每週最後一個營業日）與公布日（次一日）。"""
    tdcc = ds.table("tdcc")
    if tdcc is None or tdcc.empty:
        return None
    d = str(tdcc["date"].max())
    published = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
    return {"data_date": d, "published": published, "fields": list(WEEKLY_FIELDS)}


def screen_days(ds: Any, p: Any, mp: Any, sc: dict[str, pd.DataFrame], out: Path) -> dict[str, Any]:
    if len(p.dates) < 2:
        return {}
    lookup = field_lookup(mp, sc)
    fields = [f for f in config.load("screener")["fields"] if lookup(f) is not None]
    arrays = {f: lookup(f) for f in fields}
    close = p.close.to_numpy()
    active = [i for i, _ in enumerate(p.codes) if np.isfinite(close[-20:, i]).any()]
    rows = []
    for i in active:
        prev = [_r(arrays[f][-2, i]) for f in fields]  # type: ignore[index]
        last = [_r(arrays[f][-1, i]) for f in fields]  # type: ignore[index]
        rows.append([p.codes[i], prev, last])
    write_json(
        out / "screen_days.json",
        {"dates": [p.dates[-2], p.dates[-1]], "fields": fields, "rows": rows, "weekly": weekly_asof(ds)},
    )
    return {"screen_days_rows": len(rows)}


def tracking_signals(
    ds: Any, p: Any, mp: Any, sc: dict[str, pd.DataFrame], out: Path, days: int = 250
) -> dict[str, Any]:
    lookup = field_lookup(mp, sc)
    px = build_prices(ds, p)
    T = len(p.dates)
    s0 = max(0, T - days)
    dates = p.dates[s0:]
    presets = []
    first_idx: dict[int, int] = {}
    for preset in config.load("screener")["presets"]:
        sig = preset_signals(preset, lookup, p)
        base = {"id": preset["id"], "label": preset["label"], "subtitle": preset.get("subtitle", "")}
        if sig is None or not sig["start"]:
            presets.append({**base, "status": "資料不足", "triggers": {}})
            continue
        new = sig["new"][s0:]
        triggers: dict[str, list[str]] = {}
        for t, c in zip(*np.nonzero(new), strict=True):
            triggers.setdefault(dates[int(t)], []).append(p.codes[int(c)])
            first_idx[int(c)] = min(first_idx.get(int(c), int(t)), int(t))
        presets.append({**base, "start": sig["start"], "triggers": {d: sorted(v) for d, v in sorted(triggers.items())}})
    prices = {}
    for c, t in sorted(first_idx.items()):
        o = px.open[s0 + t :, c]
        cl = px.close[s0 + t :, c]
        prices[p.codes[c]] = {"s": t, "o": [_r(v, 3) for v in o], "c": [_r(v, 3) for v in cl]}
    bench = index_series(ds, TAIEX_TR, p.dates).to_numpy()[s0:]
    write_json(
        out / "signals.json",
        {
            "dates": dates,
            "definition": config.thresholds()["backtest"].get("signal_definition", "new"),
            "presets": presets,
            "prices": prices,
            "bench": [_r(v, 2) for v in bench],
            "names": {code: p.names.get(code, code) for code in prices},
        },
    )
    return {"tracking_codes": len(prices), "tracking_days": len(dates)}


def today_triggers(sig_file: dict[str, Any]) -> dict[str, list[str]]:
    """signals.json → 各策略最新交易日的新觸發（Telegram 盤後推播用）。"""
    last = sig_file["dates"][-1] if sig_file.get("dates") else None
    return {p["label"]: p.get("triggers", {}).get(last, []) for p in sig_file.get("presets", [])} if last else {}


def exits_tomorrow(sig_file: dict[str, Any], preset_id: str, horizon: int, since: str | None = None) -> list[str]:
    """追蹤部位中「明天開盤出場」的股票：訊號日 t、t+1 進場、第 t+1+N 個交易日開盤出場 → 出場日＝明天
    ⇔ 訊號日是最新交易日往回第 N 個交易日（t + 1 + N = 最後一日索引 + 1）。since：只算這天之後的訊號。"""
    dates = sig_file.get("dates", [])
    i = len(dates) - 1 - horizon
    if i < 0:
        return []
    d = dates[i]
    if since and d <= since:
        return []
    for p in sig_file.get("presets", []):
        if p["id"] == preset_id:
            return list(p.get("triggers", {}).get(d, []))
    return []
