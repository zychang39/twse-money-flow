"""示範資料：以固定亂數種子產生合成的 data 分支內容，再走與正式資料相同的 build-web 流程。

用途：本機開發與 CI 的 Playwright 冒煙測試（不依賴 data 分支）。App 會顯示「示範資料」標示。
"""

from __future__ import annotations

import tempfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.core.calendar import TradingCalendar
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


def _gross(volume: int, net: int, share: float) -> tuple[int, int]:
    """示範用買進、賣出股數：以成交量的固定比例為雙邊基本量，再加上買賣超（不額外抽亂數，其他示範數值不變）。"""
    base = int(volume * share)
    return base + max(net, 0), base + max(-net, 0)


# 示範用集保分級：分級 1–14 的相對比例與人數（分級 15 為千張大戶，比例由 whale 決定）
_TDCC_SHAPE = [1.5, 12, 5, 2.5, 2, 2, 1.8, 1.5, 4.5, 4.5, 5.5, 4, 3, 2.5]
_TDCC_HOLDERS = [20000, 12000, 900, 250, 130, 90, 60, 40, 70, 40, 25, 12, 6, 3]


def _tdcc_rows(iso: str, code: str, whale: float) -> list[dict[str, object]]:
    """一週的 15 個分級＋差異數調整＋合計（總股數 10 億股）；大戶比例下降時散戶人數增加（不額外抽亂數）。"""
    total = 1_000_000_000
    rest = 100 - whale
    scale = rest / sum(_TDCC_SHAPE)
    retail = 1 + (50 - whale) / 100
    rows: list[dict[str, object]] = []
    pcts = [p * scale for p in _TDCC_SHAPE] + [whale]
    holders = [int(h * (retail if i < 3 else 1)) for i, h in enumerate(_TDCC_HOLDERS)] + [max(3, int(whale / 4))]
    for level, (pct, n) in enumerate(zip(pcts, holders, strict=True), start=1):
        rows.append(
            {
                "date": iso,
                "code": code,
                "level": level,
                "holders": n,
                "shares": round(total * pct / 100),
                "pct": round(pct, 2),
            }
        )
    rows.append({"date": iso, "code": code, "level": 16, "holders": 0, "shares": 0, "pct": 0.0})
    rows.append({"date": iso, "code": code, "level": 17, "holders": sum(holders), "shares": total, "pct": 100.0})
    return rows


def _demo_conferences(store: DataStore, end: date) -> None:
    """示範用法說會（依月份存檔，與 conference 來源相同）：自辦、受券商邀請各幾場。"""
    items = [
        (end - timedelta(days=200), "2330", "受邀參加元大證券舉辦之法人說明會，說明本公司營運概況。"),
        (end - timedelta(days=120), "2330", "本公司召開 2026 年第一季法人說明會。"),
        (end - timedelta(days=60), "2330", "受BofA邀請參加投資人會議，說明本公司營運概況。"),
        (end - timedelta(days=20), "2330", "本公司召開 2026 年第二季法人說明會。"),
        (end - timedelta(days=40), "2317", "應凱基證券之邀參加法人說明會。"),
    ]
    by_month: dict[date, list[dict[str, object]]] = {}
    for d, code, text in items:
        name = next(n for c, n, *_ in DEMO_STOCKS if c == code)
        by_month.setdefault(d.replace(day=1), []).append(
            {"date": d.isoformat(), "code": code, "name": name, "time": "14:00", "place": "台北", "text": text}
        )
    for m, rows in by_month.items():
        store.write("conference", m, pd.DataFrame(rows))


# 2026 年證交所休市日曆（tests/fixtures/raw/twse_holidaySchedule.json，官方 OpenAPI）：示範資料也依同一份日曆
DEMO_HOLIDAYS_2026: list[tuple[str, str]] = [
    ("2026-01-01", "中華民國開國紀念日"),
    ("2026-01-02", "國曆新年開始交易日"),
    ("2026-02-11", "農曆春節前最後交易日"),
    ("2026-02-12", "市場無交易，僅辦理結算交割作業"),
    ("2026-02-13", "市場無交易，僅辦理結算交割作業"),
    ("2026-02-15", "農曆除夕及春節"),
    ("2026-02-16", "農曆除夕及春節"),
    ("2026-02-17", "農曆除夕及春節"),
    ("2026-02-18", "農曆除夕及春節"),
    ("2026-02-19", "農曆除夕及春節"),
    ("2026-02-20", "農曆除夕及春節"),
    ("2026-02-23", "農曆春節後開始交易日"),
    ("2026-02-27", "和平紀念日"),
    ("2026-02-28", "和平紀念日"),
    ("2026-04-03", "兒童節及民族掃墓節"),
    ("2026-04-04", "兒童節及民族掃墓節"),
    ("2026-04-05", "兒童節及民族掃墓節"),
    ("2026-04-06", "兒童節及民族掃墓節"),
    ("2026-05-01", "勞動節"),
    ("2026-06-19", "端午節"),
    ("2026-09-25", "中秋節"),
    ("2026-09-28", "孔子誕辰紀念日/ 教師節"),
    ("2026-10-09", "國慶日"),
    ("2026-10-10", "國慶日"),
    ("2026-10-25", "臺灣光復暨金門古寧頭大捷紀念日"),
    ("2026-10-26", "臺灣光復暨金門古寧頭大捷紀念日"),
    ("2026-12-25", "行憲紀念日"),
]


def _demo_calendar() -> TradingCalendar:
    df = pd.DataFrame([{"date": d, "name": n, "description": ""} for d, n in DEMO_HOLIDAYS_2026])
    return TradingCalendar.from_frames([df])


def _trading_days(end: date, n: int) -> list[date]:
    cal = _demo_calendar()
    out: list[date] = []
    d = end
    while len(out) < n:
        if cal.is_trading_day(d):
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
            dself = int(dnet * 0.6)

            fb, fs = _gross(vol, fnet, 0.08)
            tb, ts = _gross(vol, tnet, 0.01)
            sb_, ss_ = _gross(vol, dself, 0.02)
            hb, hs = _gross(vol, dnet - dself, 0.015)
            rows.setdefault(f"{market}_insti", {}).setdefault(iso, []).append(
                {
                    "date": iso,
                    "code": code,
                    "name": name,
                    "foreign_buy": fb,
                    "foreign_sell": fs,
                    "foreign_net": fnet,
                    "trust_buy": tb,
                    "trust_sell": ts,
                    "trust_net": tnet,
                    "dealer_net": dnet,
                    "dealer_self_buy": sb_,
                    "dealer_self_sell": ss_,
                    "dealer_self_net": dself,
                    "dealer_hedge_buy": hb,
                    "dealer_hedge_sell": hs,
                    "dealer_hedge_net": dnet - dself,
                    "foreign_dealer_buy": 0,
                    "foreign_dealer_sell": 0,
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
    store.write(
        "twse_holidays",
        date(2026, 1, 1),
        pd.DataFrame([{"date": d, "name": n, "description": ""} for d, n in DEMO_HOLIDAYS_2026]),
    )
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
    _advanced(store, dates, rng, paths)
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
    _demo_conferences(store, end)
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


def _advanced(store: DataStore, dates: list[date], rng: np.random.Generator, paths: dict[str, np.ndarray]) -> None:
    """示範用進階資料：借券、外資持股、當沖、集保、期貨、匯率、美債、季財報、停券、內部人、注意／處置。"""
    fx, y10 = 31.5, 4.2
    whale = {c: 50 + rng.normal(0, 5) for c, *_ in DEMO_STOCKS}
    fut: list[dict[str, object]] = []
    oi: list[dict[str, object]] = []
    fxs: list[dict[str, object]] = []
    ust: list[dict[str, object]] = []
    for i, d in enumerate(dates):
        iso = d.isoformat()
        for market in ("twse", "tpex"):
            recs = [(c, n) for c, n, m, _, _ in DEMO_STOCKS if m == market]
            store.write(
                f"{market}_sbl",
                d,
                pd.DataFrame(
                    [
                        {
                            "date": iso,
                            "code": c,
                            "name": n,
                            "sbl_balance": int(5e6 + 1e6 * np.sin(i / 15 + k)),
                            "sbl_sell": int(abs(2e5 * np.sin(i / 7 + k))),
                        }
                        for k, (c, n) in enumerate(recs)
                    ]
                ),
            )
            store.write(
                f"{market}_qfii",
                d,
                pd.DataFrame(
                    [
                        {"date": iso, "code": c, "name": n, "foreign_pct": round(40 + 10 * np.sin(i / 40 + k), 2)}
                        for k, (c, n) in enumerate(recs)
                    ]
                ),
            )
            store.write(
                f"{market}_daytrade",
                d,
                pd.DataFrame(
                    [{"date": iso, "code": c, "name": n, "dt_volume": int(abs(rng.normal(2e6, 1e6)))} for c, n in recs]
                ),
            )
        if d.weekday() == 4:
            rows = []
            for c, *_ in DEMO_STOCKS:
                whale[c] += rng.normal(0, 0.4)
                rows.extend(_tdcc_rows(iso, c, whale[c]))
            store.write("tdcc_holders", d, pd.DataFrame(rows))
        for contract, scale in (("TXF", 1), ("MXF", 4), ("TMF", 20)):
            for party in ("自營商", "投信", "外資及陸資"):
                long_oi = int(abs(rng.normal(20000, 3000)) * scale / 4)
                short_oi = int(abs(rng.normal(30000 if party == "外資及陸資" else 15000, 3000)) * scale / 4)
                fut.append(
                    {
                        "date": iso,
                        "contract": contract,
                        "party": party,
                        "long_oi": long_oi,
                        "short_oi": short_oi,
                        "net_oi": long_oi - short_oi,
                    }
                )
        for contract in ("TX", "MTX", "TMF"):
            oi.append({"date": iso, "contract": contract, "total_oi": int(abs(rng.normal(80000, 5000)))})
        fx *= 1 + rng.normal(0, 0.002)
        y10 += rng.normal(0, 0.02)
        fxs.append({"date": iso, "usd_twd": round(fx, 3)})
        ust.append({"date": iso, "y10": round(y10, 2)})
    for name, rows_, keys in (
        ("taifex_insti", fut, ["date", "contract", "party"]),
        ("taifex_oi", oi, ["date", "contract"]),
        ("fx_usdtwd", fxs, ["date"]),
    ):
        df = pd.DataFrame(rows_)
        for key, part in df.groupby(pd.to_datetime(df["date"]).dt.to_period("M")):
            store.upsert(name, key.to_timestamp().date(), part.reset_index(drop=True), keys)
    store.write("ust_10y", date(dates[-1].year, 1, 1), pd.DataFrame(ust))
    # 季財報（YTD 累計）
    last = dates[-1]
    for y in (last.year - 1, last.year):
        for q in (1, 2, 3, 4):
            if (y, q) > (last.year, 2):
                break
            rows = []
            for c, n, m, _, base in DEMO_STOCKS:
                rev_q = base * 3e4
                gm = 0.3 + 0.02 * (y - last.year) + rng.normal(0, 0.01)
                rows.append(
                    {
                        "code": c,
                        "name": n,
                        "market": m,
                        "year": y,
                        "quarter": q,
                        "revenue": rev_q * q,
                        "gross_profit": rev_q * gm * q,
                        "ni_parent": rev_q * 0.1 * q,
                        "eps": 2.0 * q,
                        "equity_parent": base * 2e5,
                    }
                )
            store.write("financials", date(y, q * 3, 1), pd.DataFrame(rows))
    iso = last.isoformat()
    store.write(
        "twse_short_halt",
        last,
        pd.DataFrame(
            [
                {
                    "code": "2412",
                    "name": "中華電",
                    "last_cover_date": (last + timedelta(days=12)).isoformat(),
                    "end": (last + timedelta(days=17)).isoformat(),
                    "reason": "股東常會",
                }
            ]
        ),
    )
    store.write(
        "twse_exright_notice",
        last,
        pd.DataFrame(
            [
                {
                    "date": (last + timedelta(days=20)).isoformat(),
                    "code": "2412",
                    "name": "中華電",
                    "kind": "息",
                    "cash_dividend": 4.7,
                }
            ]
        ),
    )
    store.write(
        "twse_insider",
        last,
        pd.DataFrame(
            [
                {
                    "report_date": iso,
                    "code": "2317",
                    "name": "鴻海",
                    "holder_type": "董事",
                    "holder": "示範",
                    "method": "一般交易",
                    "shares": 500000,
                    "start": iso,
                    "end": (last + timedelta(days=30)).isoformat(),
                }
            ]
        ),
    )
    att = pd.DataFrame(
        [
            {"date": dates[-k].isoformat(), "code": "6182", "name": "合晶", "count": 3 - k, "reason": "示範：漲幅異常"}
            for k in (1, 2)
        ]
    )
    store.write("tpex_attention", last.replace(day=1), att)
    store.write(
        "tpex_disposition",
        last.replace(day=1),
        pd.DataFrame(
            [
                {
                    "announce_date": dates[-3].isoformat(),
                    "code": "3105",
                    "name": "穩懋",
                    "count": 1,
                    "start": dates[-2].isoformat(),
                    "end": (last + timedelta(days=8)).isoformat(),
                    "reason": "連續3個營業日",
                    "measure": "處置",
                    "interval_minutes": 5,
                    "detail": "示範：約每五分鐘撮合一次",
                }
            ]
        ),
    )
