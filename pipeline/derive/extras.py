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


def _light(lid: str, label: str, state: str, value: str, basis: str) -> dict[str, Any]:
    return {"id": lid, "label": label, "state": state, "value": value, "basis": basis}


def futures_net_oi(ti: pd.DataFrame) -> pd.Series:
    """外資台指期淨未平倉（大台約當口數 = 大台 + 小台/4 + 微台/20）。"""
    if ti.empty:
        return pd.Series(dtype=float)
    f = ti[ti["party"] == "外資及陸資"]
    w = {"TXF": 1.0, "MXF": 0.25, "TMF": 0.05}
    f = f.assign(eq=[n * w.get(c, 0) for n, c in zip(f["net_oi"], f["contract"], strict=True)])
    return f.groupby("date")["eq"].sum().sort_index()


def retail_ratio(ti: pd.DataFrame, oi: pd.DataFrame, fut_contract: str, oi_contract: str) -> pd.Series:
    """散戶多空比 = (散戶多 − 散戶空) ÷ 全市場未平倉；散戶多 = 全市場 − 法人多、散戶空 = 全市場 − 法人空。"""
    if ti.empty or oi.empty:
        return pd.Series(dtype=float)
    inst = ti[ti["contract"] == fut_contract].groupby("date")[["long_oi", "short_oi"]].sum()
    total = oi[oi["contract"] == oi_contract].set_index("date")["total_oi"]
    df = inst.join(total, how="inner")
    df = df[df["total_oi"] > 0]
    long_r = df["total_oi"] - df["long_oi"]
    short_r = df["total_oi"] - df["short_oi"]
    return ((long_r - short_r) / df["total_oi"] * 100).sort_index()


def market_env(ds: Any, p: Any, taiex: pd.Series) -> dict[str, Any]:
    env = config.thresholds()["market_env"]
    temp = config.thresholds()["market_temperature"]
    lights = []
    # 1) 外資台指期淨未平倉
    net = futures_net_oi(ds.table("taifex_insti"))
    if len(net):
        v = float(net.iloc[-1])
        st = (
            "green"
            if v >= env["futures_net_oi"]["bullish_above"]
            else "red"
            if v <= env["futures_net_oi"]["bearish_below"]
            else "yellow"
        )
        lights.append(
            _light(
                "futures",
                "外資台指期淨未平倉",
                st,
                f"{v:,.0f} 口（{net.index[-1]}）",
                f"大台約當口數（大台 + 小台/4 + 微台/20）；≥ {env['futures_net_oi']['bullish_above']:,} 偏多、≤ {env['futures_net_oi']['bearish_below']:,} 偏空",
            )
        )
    else:
        lights.append(_light("futures", "外資台指期淨未平倉", "gray", "資料源待處理", "期交所三大法人期貨資料尚未取得"))
    # 2) 台幣匯率趨勢
    fx = ds.table("fx")
    if not fx.empty and len(fx) > 20:
        s = fx.drop_duplicates("date").set_index("date")["usd_twd"].sort_index().dropna()
        chg = float(s.iloc[-1] / s.iloc[-21] - 1) * 100
        c = env["usd_twd_change_20d_pct"]
        st = "green" if chg <= c["inflow_below"] else "red" if chg >= c["outflow_above"] else "yellow"
        lights.append(
            _light(
                "fx",
                "台幣匯率趨勢",
                st,
                f"USD/TWD {s.iloc[-1]:.3f}（20 日 {chg:+.2f}%）",
                f"美元兌台幣 20 日變化；≤ {c['inflow_below']}%（台幣升值、資金流入）偏多、≥ +{c['outflow_above']}% 偏空",
            )
        )
    else:
        lights.append(_light("fx", "台幣匯率趨勢", "gray", "資料源待處理", "期交所每日匯率資料不足 20 日"))
    # 3) 大盤與年線
    ma = taiex.rolling(240, min_periods=240).mean()
    if taiex.notna().any() and ma.notna().any():
        gap = float(taiex.iloc[-1] / ma.iloc[-1] - 1) * 100
        band = env["index_vs_ma240_pct"]["neutral_band"]
        st = "green" if gap > band else "red" if gap < -band else "yellow"
        lights.append(
            _light("ma240", "大盤與年線", st, f"{gap:+.1f}%", f"加權指數相對 240 日均線；±{band}% 內視為年線附近")
        )
    else:
        lights.append(_light("ma240", "大盤與年線", "gray", "歷史不足 240 日", "回補完成後顯示"))
    # 4) M1B／M2
    money = ds.table("cbc_money") if hasattr(ds, "table") else pd.DataFrame()
    if not money.empty:
        r = money.sort_values("ym").iloc[-1]
        gap = float(r["m1b_yoy"] - r["m2_yoy"])
        st = "green" if gap > env["m1b_m2_gap"]["bullish_above"] else "red"
        lights.append(
            _light(
                "m1b",
                "M1B／M2 年增率",
                st,
                f"M1B {r['m1b_yoy']:.2f}%、M2 {r['m2_yoy']:.2f}%（{r['ym']}）",
                "M1B 年增率高於 M2（黃金交叉）視為資金動能偏多",
            )
        )
    else:
        lights.append(_light("m1b", "M1B／M2 年增率", "gray", "資料源待處理", "央行貨幣總計數（選配資料）"))
    # 5) 美國 10 年期殖利率
    ust = ds.table("ust")
    if not ust.empty and len(ust) > 20:
        s = ust.drop_duplicates("date").set_index("date")["y10"].sort_index().dropna()
        bp = float(s.iloc[-1] - s.iloc[-21]) * 100
        c = env["us10y_change_20d_bp"]
        st = "red" if bp >= c["tightening_above"] else "green" if bp <= c["easing_below"] else "yellow"
        lights.append(
            _light(
                "ust",
                "美國 10 年期殖利率",
                st,
                f"{s.iloc[-1]:.2f}%（20 日 {bp:+.0f}bp）",
                f"20 日變化 ≥ +{c['tightening_above']}bp 偏緊、≤ {c['easing_below']}bp 偏鬆",
            )
        )
    else:
        lights.append(_light("ust", "美國 10 年期殖利率", "gray", "資料源待處理", "美國財政部 Par Yield Curve"))
    score = sum({"green": 1, "red": -1}.get(li["state"], 0) for li in lights)
    known = sum(1 for li in lights if li["state"] != "gray")
    summary = f"{sum(li['state'] == 'green' for li in lights)} 綠 {sum(li['state'] == 'yellow' for li in lights)} 黃 {sum(li['state'] == 'red' for li in lights)} 紅"
    # ---- 市場溫度
    tl = []
    rr = retail_ratio(ds.table("taifex_insti"), ds.table("taifex_oi"), "MXF", "MTX")
    rr_tmf = retail_ratio(ds.table("taifex_insti"), ds.table("taifex_oi"), "TMF", "TMF")
    if len(rr):
        v = float(rr.iloc[-1])
        c = temp["retail_ratio_pct"]
        st = "red" if v >= c["hot_above"] else "green" if v <= c["cold_below"] else "yellow"
        extra = f"；微台 {float(rr_tmf.iloc[-1]):+.1f}%" if len(rr_tmf) else ""
        tl.append(
            _light(
                "retail",
                "散戶多空比（小台）",
                st,
                f"{v:+.1f}%{extra}",
                f"(散戶多 − 散戶空) ÷ 全市場未平倉；≥ +{c['hot_above']}% 過熱、≤ {c['cold_below']}% 過冷（反向參考）",
            )
        )
    else:
        tl.append(_light("retail", "散戶多空比（小台）", "gray", "資料源待處理", "期交所未平倉資料"))
    mt = ds.margin_total
    if not mt.empty:
        amt = mt[mt["item"].astype(str).str.contains("金額|融資金")].groupby("date")["balance"].sum().sort_index()
        if len(amt) > 5:
            chg = float(amt.iloc[-1] / amt.iloc[-6] - 1) * 100
            c = temp["margin_change_5d_pct"]
            st = "red" if chg >= c["hot_above"] else "green" if chg <= c["cold_below"] else "yellow"
            tl.append(
                _light(
                    "margin",
                    "大盤融資餘額變化",
                    st,
                    f"5 日 {chg:+.2f}%（{amt.iloc[-1] / 1e5:,.0f} 億）",
                    f"上市＋上櫃融資金額 5 日變化；≥ +{c['hot_above']}% 過熱、≤ {c['cold_below']}% 降溫",
                )
            )
    value = p.value.sum(axis=1)
    if len(value) > 20:
        ratio = float(value.iloc[-1] / value.iloc[-21:-1].mean())
        c = temp["volume_vs_ma20"]
        st = "red" if ratio >= c["hot_above"] else "green" if ratio <= c["cold_below"] else "yellow"
        tl.append(
            _light(
                "volume",
                "成交量相對 20 日平均",
                st,
                f"{ratio:.2f} 倍（{value.iloc[-1] / 1e8:,.0f} 億）",
                f"上市＋上櫃成交金額 ÷ 前 20 日平均；≥ {c['hot_above']} 過熱、≤ {c['cold_below']} 冷清",
            )
        )
    retail_series = [{"date": d, "mtx": clean(v, 2), "tmf": clean(rr_tmf.get(d), 2)} for d, v in rr.iloc[-60:].items()]
    return {
        "env": {"summary": summary, "score": score, "known": known, "lights": lights},
        "temperature": {"lights": tl, "retail": retail_series},
    }


def active_etf_section(ds: Any, p: Any) -> dict[str, Any]:
    """主動式 ETF 清單（由行情代號 00xxxA 判定）與跨檔加碼／減碼排行（需 etf_holdings）。"""
    from pipeline.derive import etf as etfmod

    changes = etfmod.holdings_changes(ds.table("etf_holdings"))
    close = {c: float(v) for c, v in p.close.iloc[-1].dropna().items()} if len(p.dates) else {}
    ranking: dict[str, Any] = {"date": str(changes["date"].max()) if not changes.empty else None}
    ranking.update(etfmod.ranking(changes, close))
    if changes.empty:
        ranking["status"] = (
            "資料源待處理：主動式 ETF 每日持股僅由各投信官網個別揭露（格式不一、部分有防爬機制），"
            "尚無集中、免費且可程式取得的官方來源；目前僅列出清單與成交資訊。"
        )
    return {"active_etfs": etfmod.active_etfs(p), "etf_ranking": ranking}


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
        **market_env(ds, p, taiex),
        **active_etf_section(ds, p),
    }
    write_json(out / "market.json", data)
    return data


def calendar_file(ds: Any, p: Any, out: Path) -> int:
    """行事曆：除權息、融券最後回補日、處置期間、月營收與財報期限、休市日、法說會。"""
    from datetime import date as _date
    from datetime import timedelta as _td

    last = _date.fromisoformat(p.dates[-1])
    lo, hi = (last - _td(days=14)).isoformat(), (last + _td(days=75)).isoformat()
    ev: list[dict[str, Any]] = []

    def add(d: Any, typ: str, text: str, code: str | None = None) -> None:
        if isinstance(d, str) and lo <= d <= hi:
            ev.append(
                {"date": d, "type": typ, "code": code, "name": p.names.get(code, code) if code else None, "text": text}
            )

    for _, r in ds.exright_notice.iterrows() if not ds.exright_notice.empty else []:
        cash = r.get("cash_dividend")
        add(
            r["date"],
            "除權息",
            f"除{r.get('kind', '')}" + (f"，現金股利 {cash:g} 元" if cash == cash and cash else ""),
            r["code"],
        )
    sh = ds.table("short_halt")
    for _, r in sh.iterrows() if not sh.empty else []:
        add(
            r.get("last_cover_date"),
            "融券回補",
            f"融券最後回補日（停券至 {r.get('end')}，{r.get('reason') or ''}）",
            r["code"],
        )
    for _, r in ds.disposition.dropna(subset=["start"]).iterrows() if not ds.disposition.empty else []:
        add(r["start"], "處置", f"處置開始（至 {r.get('end')}）", r["code"])
        add(r.get("end"), "處置", "處置最後一日", r["code"])
    conf = ds.table("conference")
    for _, r in conf.iterrows() if not conf.empty else []:
        when = str(r.get("time") or "").strip()
        add(r["date"], "法說會", f"{when + ' ' if when else ''}{str(r.get('text') or '')[:80]}", r["code"])
    d = last.replace(day=1)
    for _ in range(4):
        add(d.replace(day=10).isoformat(), "月營收", "上月營收公布期限（各公司陸續公布）")
        d = (d + _td(days=32)).replace(day=1)
    for q, md in config.thresholds()["backtest"]["financial_deadlines"].items():
        m, dd = (int(x) for x in str(md).split("-"))
        for y in (last.year, last.year + 1):
            add(_date(y, m, dd).isoformat(), "財報", f"{'年報' if q == 'Q4' else q + ' 季報'}申報期限")
    hol = ds.store.read("twse_holidays", _date(last.year, 1, 1))
    if hol is not None:
        for _, r in hol.iterrows():
            if "開始交易" not in str(r["name"]) and "最後交易" not in str(r["name"]):
                add(r["date"], "休市", str(r["name"]))
    ev.sort(key=lambda e: (e["date"], e["type"], e["code"] or ""))
    write_json(out / "calendar.json", {"date": p.dates[-1], "events": ev})
    return len(ev)


def build_extras(ds: Any, p: Any, mp: Any, sc: Any, fv: Any, out: Path) -> dict[str, Any]:
    report: dict[str, Any] = {}
    index_file(ds, p, out)
    market_file(ds, p, mp, out)
    report["calendar_events"] = calendar_file(ds, p, out)
    report.update(preset_backtests(ds, p, mp, sc, out))
    report.update(custom_panel(ds, p, mp, sc, out))
    return report
