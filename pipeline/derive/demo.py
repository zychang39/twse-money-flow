"""示範資料：以固定亂數種子產生合成的 data 分支內容，再走與正式資料相同的 build-web 流程。

用途：本機開發與 CI 的 Playwright 冒煙測試（不依賴 data 分支）。App 會顯示「示範資料」標示。
"""

from __future__ import annotations

import tempfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.core.store import DataStore

DEMO_STOCKS = [
    ("2330", "台積電", "twse", "24", 1000.0),
    ("2317", "鴻海", "twse", "31", 180.0),
    ("2454", "聯發科", "twse", "24", 1300.0),
    ("2412", "中華電", "twse", "27", 125.0),
    ("1101", "台泥", "twse", "01", 32.0),
    ("2882", "國泰金", "twse", "17", 60.0),
    ("0050", "元大台灣50", "twse", "", 180.0),
    ("6488", "環球晶", "tpex", "24", 450.0),
    ("5347", "世界", "tpex", "24", 95.0),
    ("8069", "元太", "tpex", "26", 260.0),
    ("3105", "穩懋", "tpex", "24", 120.0),
    ("6182", "合晶", "tpex", "24", 40.0),
]


def _trading_days(end: date, n: int) -> list[date]:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


def build_store(root: Path, *, days: int = 320, end: date | None = None, seed: int = 7) -> DataStore:
    rng = np.random.default_rng(seed)
    end = end or date(2026, 9, 24)
    dates = _trading_days(end, days)
    store = DataStore(root)
    paths: dict[str, np.ndarray] = {}
    for code, _, _, _, base in DEMO_STOCKS:
        drift = rng.normal(0.0004, 0.0003)
        rets = rng.normal(drift, 0.018, len(dates))
        paths[code] = base * np.exp(np.cumsum(rets))
    rows: dict[str, dict[str, list[dict[str, object]]]] = {}
    index_level = 20000.0
    ret_index = 40000.0
    for i, d in enumerate(dates):
        iso = d.isoformat()
        idx_ret = rng.normal(0.0004, 0.01)
        index_level *= 1 + idx_ret
        ret_index *= 1 + idx_ret + 0.0001
        for code, name, market, _, _ in DEMO_STOCKS:
            close = float(round(paths[code][i], 2))
            prev = float(paths[code][i - 1]) if i else close
            o = round(prev * (1 + rng.normal(0, 0.005)), 2)
            h = round(max(o, close) * (1 + abs(rng.normal(0, 0.006))), 2)
            low = round(min(o, close) * (1 - abs(rng.normal(0, 0.006))), 2)
            vol = int(abs(rng.normal(8e6, 3e6)))
            rows.setdefault(f"{market}_quotes", {}).setdefault(iso, []).append(
                {
                    "date": iso,
                    "code": code,
                    "name": name,
                    "open": o,
                    "high": h,
                    "low": low,
                    "close": close,
                    "volume": vol,
                    "value": round(vol * (o + close) / 2),
                    "trades": vol // 1000,
                    "change": round(close - round(prev, 2), 2),
                }
            )
            fnet = int(rng.normal(0, 2e6))
            tnet = int(rng.normal(3e5, 5e5))
            dnet = int(rng.normal(0, 3e5))
            rows.setdefault(f"{market}_insti", {}).setdefault(iso, []).append(
                {
                    "date": iso,
                    "code": code,
                    "name": name,
                    "foreign_net": fnet,
                    "trust_net": tnet,
                    "dealer_net": dnet,
                    "foreign_dealer_net": 0,
                    "total_net": fnet + tnet + dnet,
                }
            )
            mb = int(20000 + 5000 * np.sin(i / 20) + rng.normal(0, 300))
            rows.setdefault(f"{market}_margin", {}).setdefault(iso, []).append(
                {
                    "date": iso,
                    "code": code,
                    "name": name,
                    "margin_balance": mb,
                    "margin_limit": 500000,
                    "short_balance": int(abs(rng.normal(800, 200))),
                }
            )
            eps = max(close / 18, 0.5)
            rows.setdefault(f"{market}_valuation", {}).setdefault(iso, []).append(
                {
                    "date": iso,
                    "code": code,
                    "name": name,
                    "pe": round(close / eps * (1 + rng.normal(0, 0.1)), 2),
                    "pb": round(2 + rng.normal(0, 0.2), 2),
                    "dividend_yield": round(3 + rng.normal(0, 0.3), 2),
                }
            )
        rows.setdefault("twse_index", {}).setdefault(iso, []).extend(
            [
                {
                    "date": iso,
                    "name": "發行量加權股價指數",
                    "kind": "price",
                    "close": round(index_level, 2),
                    "change": 0,
                    "change_pct": round(idx_ret * 100, 2),
                },
                {
                    "date": iso,
                    "name": "發行量加權股價報酬指數",
                    "kind": "return",
                    "close": round(ret_index, 2),
                    "change": 0,
                    "change_pct": round(idx_ret * 100, 2),
                },
            ]
        )
    for source, by_date in rows.items():
        for iso, recs in by_date.items():
            store.write(source, date.fromisoformat(iso), pd.DataFrame(recs))
    # 除息事件（台泥）
    ex_day = dates[-60].isoformat()
    store.write(
        "twse_exright",
        date.fromisoformat(ex_day[:8] + "01"),
        pd.DataFrame(
            [
                {
                    "date": ex_day,
                    "code": "1101",
                    "name": "台泥",
                    "pre_close": 33.0,
                    "ref_price": 32.0,
                    "rights_dividend": 1.0,
                    "cash_dividend": 1.0,
                    "stock_dividend_value": None,
                    "kind": "息",
                    "factor": 32.0 / 33.0,
                }
            ]
        ),
    )
    # 月營收 24 個月
    for k in range(24):
        ym_date = (end.replace(day=1) - pd.DateOffset(months=k + 1)).date()
        recs = []
        for code, name, market, _, base in DEMO_STOCKS:
            rev = base * 1e4 * (1 + 0.01 * (24 - k)) * (1 + rng.normal(0, 0.05))
            recs.append(
                {
                    "ym": ym_date.strftime("%Y-%m"),
                    "code": code,
                    "name": name,
                    "market": market,
                    "industry": "",
                    "revenue": round(rev),
                    "first_seen": None,
                }
            )
        store.write("revenue", ym_date, pd.DataFrame(recs))
    comp = pd.DataFrame(
        [
            {
                "code": c,
                "name": n,
                "market": m,
                "industry_code": ic,
                "capital": 1e10,
                "shares": 1e9,
                "listing_date": "2000-01-01",
            }
            for c, n, m, ic, _ in DEMO_STOCKS
        ]
    )
    store.write("twse_company", end, comp[comp["market"] == "twse"])
    store.write("tpex_company", end, comp[comp["market"] == "tpex"])
    store.save_manifest(
        {
            "version": 1,
            "sources": {"twse_quotes": {"last_success": end.isoformat(), "last_status": "ok", "rows": 7}},
            "runs": [],
            "closed_days": [],
        }
    )
    return store


def build_demo(out: Path) -> dict[str, object]:
    from pipeline.derive.export import build_web

    with tempfile.TemporaryDirectory() as tmp:
        build_store(Path(tmp))
        return build_web(Path(tmp), out, demo=True)
