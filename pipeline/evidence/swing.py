"""波段策略（2026-10-01 新增、2026-10-02 第二輪改版；`config/swing.yml`、`config/evidence.yml swing_gates`、
docs/swing/HYPOTHESIS.md、TRIALS.md）。

新增檔案；入口只做最小掛入（`run_and_write` 把結果併入 strategies.json、CLI `python -m pipeline swing`）。
沿用評估引擎（進出場、成本、跌停鎖死、同日等權基準、首次觸發去重、日曆時間法）；
第二輪統一口徑：
- 兩種超額並列：毛超額＝毛報酬 − 等權毛報酬（選股能力）、扣成本超額＝淨報酬 − 等權毛報酬（可交易性）。
- 持有 40 日為主、20 日並列（10 日只顯示）。
- 三段固定日期切分：開發 2017-01～2021-12、驗證 2022-01～2024-10、最終測試 2024-11 至今（上一輪已查看兩次，非全新樣本）。
- 校正後 t：集中進場（進場日 ÷ 期間交易日 < 25%）用日曆時間法；其餘取日曆、NW、區塊的最小值。
- 進場延後 1、3 日；參數 ±20%；九項上線門檻；組合層 10 檔等權、槽位滿了就跳過，含兩條共用規則
  （加權指數在 240 日線下不開新倉；20 日乖離 > 20% 不進場；不計入參數）。
- 前瞻驗證：合併日（forward_since）之後的訊號自動記錄，滿 forward_days 個交易日後在策略頁顯示與回測對照。

時間點：所有條件只用訊號日 T（含）以前已公布的資料；`tests/pipeline/test_swing.py` 以截斷測試鎖定每一套。
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.evidence import audit, engine, stats, verdict
from pipeline.evidence import indicators as ind

log = logging.getLogger(__name__)

SEGMENTS = ("dev", "val", "test")
SEG_LABEL = {"dev": "開發", "val": "驗證", "test": "最終測試"}
PERTURB_MULTS = (0.8, 1.2)


def cfg() -> dict[str, Any]:
    return config.load("swing")


def gates_cfg(c: dict[str, Any] | None = None) -> dict[str, Any]:
    return dict((c or config.load("evidence")).get("swing_gates") or {})


# ------------------------------------------------------------------ 訊號
def value20(ev: Any) -> np.ndarray:
    """訊號日（含）20 日平均成交值（元）。"""
    return pd.DataFrame(np.nan_to_num(ev.value, nan=0.0)).rolling(20, min_periods=20).mean().to_numpy()


def realized_vol(close: np.ndarray, n: int) -> np.ndarray:
    """近 n 日日報酬的標準差（還原收盤；需滿 n 日）。"""
    with np.errstate(invalid="ignore", divide="ignore"):
        r = close[1:] / close[:-1] - 1
    r = np.vstack([np.full((1, close.shape[1]), np.nan), r])
    return pd.DataFrame(r).rolling(n, min_periods=n).std(ddof=1).to_numpy()


def base_mask(
    base: str, ev: Any, f: dict[str, Any], params: dict[str, Any], flow: str = "trust"
) -> tuple[np.ndarray, np.ndarray]:
    """基礎事件 (T, C) 與「可計算」遮罩。只用訊號日（含）以前的資料。flow（inst_pullback 的固定定義，不是參數）：
    trust＝投信 20 日累計淨買超；both＝投信＋外資合計。"""
    T = len(ev.dates)
    with np.errstate(invalid="ignore", divide="ignore"):
        if base == "rev_high12":
            m = ind.revenue_event(f["rev"], "high12", T, ev.codes)
            return m, np.isfinite(f["rev_yoy"])
        if base == "high52":
            h = f["h52"]
            return ind.cross_up(h, 0.95), np.isfinite(h)
        if base == "rs90":
            rs = f["rs_pct"]
            return ind.cross_up(rs, 90.0), np.isfinite(rs)
        if base == "rev_confirm":
            # A 事件後漂移：營收創 12 個月新高的生效日（10 日當天或之後第一個交易日）當天收盤上漲、量 ≥ vol_ratio × 前 20 日均量
            ev12 = ind.revenue_event(f["rev"], "high12", T, ev.codes)
            up = ind.ret(ev.close, 1) > 0
            big = f["vol_ratio"] >= float(params.get("vol_ratio", 1.5))
            return ev12 & up & big, np.isfinite(f["rev_yoy"]) & np.isfinite(f["vol_ratio"])
        if base == "squeeze_breakout":
            # B 趨勢延續：RS 高、20 日波動 < 60 日波動（整理收斂，固定條件）、收盤突破前 20 日最高收盤且量 ≥ vol_ratio
            b20, level = ind.breakout(ev.close, 20)
            v20, v60 = realized_vol(ev.close, 20), realized_vol(ev.close, 60)
            squeeze = v20 < v60
            big = f["vol_ratio"] >= float(params.get("vol_ratio", 1.5))
            avail = np.isfinite(level) & np.isfinite(v60) & np.isfinite(f["vol_ratio"]) & np.isfinite(f["rs_pct"])
            return b20 & squeeze & big, avail
        if base == "inst_pullback":
            # C 法人持續建倉：投信 20 日累計淨買超 ≥ trust_ratio × 前 20 日均量、RS 高；回檔不破支撐：
            # 收盤 ≤ 20 日線 × 1.02、收盤 ≥ 60 日線、收盤 ≤ 前 20 日最高收盤 × 0.95（固定條件，首次成立日）
            ma20, ma60 = ind.ma(ev.close, 20), ind.ma(ev.close, 60)
            hi20 = ind.shift(ind.rolling(ev.close, 20, "max"), 1)
            net20 = f["trust20"] + f["foreign20"] if flow == "both" else f["trust20"]
            buying = net20 >= float(params.get("trust_ratio", 1.0))
            pull = (ev.close <= ma20 * 1.02) & (ev.close >= ma60) & (ev.close <= hi20 * 0.95)
            avail = np.isfinite(net20) & np.isfinite(ma60) & np.isfinite(hi20) & np.isfinite(f["rs_pct"])
            cond = buying & pull & (f["rs_pct"] >= float(params.get("rs_min", 70)))
            return ind.first_true(cond & avail, avail), avail
    raise ValueError(base)


def signal_mask(
    spec: dict[str, Any], ev: Any, f: dict[str, Any], uni: np.ndarray, mk: engine.Market, params: dict[str, Any]
) -> np.ndarray:
    """(T, C)：訊號日在 universe 內且全部條件成立。只用 T 日（含）以前的資料（截斷測試保證）。"""
    m, _ = base_mask(str(spec["base"]), ev, f, params, str(spec.get("flow", "trust")))
    m = m & uni
    with np.errstate(invalid="ignore"):
        if "rs_min" in params and spec["base"] != "inst_pullback":
            m &= f["rs_pct"] >= float(params["rs_min"])
        if "bias_max" in params:
            m &= f["bias20"] <= float(params["bias_max"])
        if "value_min" in params:
            m &= value20(ev) >= float(params["value_min"])
        for flt in spec.get("filters") or []:
            if flt == "foreign5_pos":
                m &= ind.chip_ratio(f["foreign"], f["avgv"], 5) > 0
            elif flt == "regime_up":
                m &= np.asarray(mk.regime_up)[:, None]
            else:
                raise ValueError(flt)
    return m


def common_rule_mask(ev: Any, f: dict[str, Any], mk: engine.Market, g: dict[str, Any]) -> np.ndarray:
    """共用、不可調的組合層規則（不計入參數）：加權指數在 240 日線下不開新倉；20 日乖離 > 20% 不進場。"""
    rules = g.get("common_rules") or {}
    with np.errstate(invalid="ignore"):
        ok = f["bias20"] <= float(rules.get("bias_max", 0.20))
    ok = ok & np.asarray(mk.regime_up)[:, None]
    return np.asarray(ok)


def period_start(spec: dict[str, Any], ev: Any, f: dict[str, Any], uni: np.ndarray, c: dict[str, Any]) -> str | None:
    _, avail = base_mask(str(spec["base"]), ev, f, dict(spec.get("params") or {}), str(spec.get("flow", "trust")))
    ok = (avail & uni).any(axis=1)
    if not ok.any():
        return None
    first = ev.dates[int(np.argmax(ok))]
    if spec["base"] in ("high52", "rs90", "squeeze_breakout"):
        first = max(first, str(c["price_start"]))
    return first


def segments(start: str, end: str, g: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """固定日期的三段（evidence.yml swing_gates）：開發、驗證、最終測試；與訊號期間取交集。"""
    stop = (pd.Timestamp(end) + pd.Timedelta(days=1)).date().isoformat()
    out = {}
    for k in SEGMENTS:
        lo, hi = g[k]
        lo = max(str(lo), start)
        hi = stop if hi is None else min(str(hi), stop)
        out[k] = (lo, hi)
    return out


def shift_mask(mask: np.ndarray, d: int) -> np.ndarray:
    """訊號列往後移 d 個交易日（進場延後 d 日）。"""
    if d <= 0:
        return mask
    out = np.zeros_like(mask, dtype=bool)
    out[d:] = mask[:-d]
    return out


# ------------------------------------------------------------------ 評估
def market_for(ev: Any, uni: np.ndarray, c: dict[str, Any], holds: list[int]) -> engine.Market:
    """含擾動持有天數的市場資料（±20% 的 hold 也要有預先計算的出場）。"""
    c2 = dict(c)
    c2["horizons"] = sorted({*(int(h) for h in c["horizons"]), *holds})
    c2["horizons_ref"] = []
    return engine.market(ev, uni, c2)


def events(mk: engine.Market, mask: np.ndarray, uni: np.ndarray, start: str, hold: int) -> pd.DataFrame:
    dates = np.asarray(mk.dates)
    m = mask & (dates >= start)[:, None]
    t, cc = engine.events_from_mask(m, uni)
    return engine.dedupe(engine.annotate(engine.evaluate(mk, t, cc, hold), mk))


def seg_stats(d: pd.DataFrame, seg: tuple[str, str], hold: int, c: dict[str, Any], mk: engine.Market) -> dict[str, Any]:
    part = d[(d["date"] >= seg[0]) & (d["date"] < seg[1])]
    b = stats.brief(part, c)
    dates = np.asarray(mk.dates)
    pdays = int(((dates >= seg[0]) & (dates < seg[1])).sum())
    ct = audit.corrected_t(part, hold, period_days=pdays) if len(part) else {}
    pm, months = audit.per_month(part, seg[0], seg[1]) if len(part) else (0.0, 0)
    dist = event_dist(part)
    return {
        **b,
        **{k: ct.get(k) for k in ("t_corr", "t_nw", "t_block", "t_corr_method", "concentration")},
        "per_month": pm,
        "months": months,
        "period": list(seg),
        "win": dist.get("win"),
        "payoff": dist.get("payoff"),
    }


def event_dist(d: pd.DataFrame) -> dict[str, Any]:
    """事件層級：勝率、賺賠比、平均獲利與虧損、最大不利波動分布、連續虧損分布（依訊號日排序）。"""
    if d.empty:
        return {}
    net = d.sort_values(["date", "c"])["net"].to_numpy()
    wins, losses = net[net > 0], net[net <= 0]
    streaks: list[int] = []
    run = 0
    for v in net:
        if v <= 0:
            run += 1
        else:
            if run:
                streaks.append(run)
            run = 0
    if run:
        streaks.append(run)
    s = np.asarray(streaks) if streaks else np.zeros(1)
    mae = d["mae"].to_numpy()
    return {
        "win": stats.pct(float((net > 0).mean())),
        "avg_win": stats.pct(float(wins.mean())) if wins.size else None,
        "avg_loss": stats.pct(float(losses.mean())) if losses.size else None,
        "payoff": round(float(wins.mean() / -losses.mean()), 2)
        if wins.size and losses.size and losses.mean() < 0
        else None,
        "loss_streak": {"max": int(s.max()), "p50": float(np.percentile(s, 50)), "p90": float(np.percentile(s, 90))},
        "mae_p50": stats.pct(float(np.percentile(mae, 50))),
        "mae_p90": stats.pct(float(np.percentile(mae, 10))),
        "mae_worst": stats.pct(float(mae.min())),
    }


def simulate_portfolio(
    mk: engine.Market, d: pd.DataFrame, value: np.ndarray, k: int, start: int, allowed: np.ndarray | None = None
) -> dict[str, Any]:
    """組合層（第二輪）：k 檔等權、槽位滿了就跳過（不排隊）、固定持有日出場；allowed[t, c]（共用規則）為 False 的訊號不開新倉。
    回傳逐日權益、實際成交筆數（週轉率用）與跳過筆數。"""
    T = len(mk.dates)
    fee, tax, slip = mk.fee, mk.tax, float(getattr(mk, "slip", 0.0))
    by_entry: dict[int, list[tuple[float, int, int, float, float]]] = {}
    skipped_rule = 0
    for t, e, c, x in d[["t", "e", "c", "x"]].itertuples(index=False):
        if e < start or x >= T:
            continue
        if allowed is not None and not allowed[int(t), int(c)]:
            skipped_rule += 1
            continue
        entry, px = mk.open[int(e), int(c)], mk.open[int(x), int(c)]
        if not (np.isfinite(entry) and np.isfinite(px)):
            continue
        v = value[int(e) - 1, int(c)] if e >= 1 and np.isfinite(value[int(e) - 1, int(c)]) else 0.0
        by_entry.setdefault(int(e), []).append((-float(v), int(c), int(x), float(entry), float(px)))
    cash, prev_eq = 1.0, 1.0
    pos: dict[int, list[float]] = {}
    eq = np.ones(T - start)
    executed = skipped_full = 0
    for day in range(start, T):
        for c in [c for c, p in pos.items() if int(p[1]) == day]:
            shares, _, px, _ = pos.pop(c)
            cash += shares * px * (1 - slip) * (1 - fee - tax)
        free = k - len(pos)
        for _, c, x, entry, px in sorted(by_entry.get(day, [])):
            if c in pos or x <= day:
                continue
            if free <= 0:
                skipped_full += 1
                continue
            alloc = min(prev_eq / k, cash)
            if alloc <= 0:
                skipped_full += 1
                continue
            shares = alloc / (entry * (1 + slip) * (1 + fee))
            cash -= alloc
            pos[c] = [shares, x, px, entry]
            free -= 1
            executed += 1
        value_now = cash
        for c, p in pos.items():
            cl = mk.close[day, c]
            if np.isfinite(cl):
                p[3] = cl
            value_now += p[0] * p[3]
        eq[day - start] = value_now
        prev_eq = value_now
    return {"equity": eq, "executed": executed, "skipped_full": skipped_full, "skipped_rule": skipped_rule}


def perf(v: np.ndarray) -> dict[str, Any]:
    """年化報酬（幾何）、年化波動、Sharpe（無風險 0）、最大回撤與回撤期間（最長、交易日）。"""
    v = np.asarray(v, dtype=float)
    ok = np.isfinite(v)
    v = v[ok]
    if v.size < 20:
        return {"days": int(v.size)}
    r = v[1:] / v[:-1] - 1
    years = v.size / 252
    ann = float(v[-1] / v[0]) ** (1 / years) - 1
    vol = float(r.std(ddof=1) * np.sqrt(252))
    dd = v / np.maximum.accumulate(v) - 1
    peak, run, best = -np.inf, 0, 0
    for x in v:
        if x >= peak:
            peak, run = x, 0
        else:
            run += 1
            best = max(best, run)
    return {
        "days": int(v.size),
        "ann_return": stats.pct(ann),
        "vol_ann": stats.pct(vol),
        "sharpe": round(float(r.mean() * 252) / vol, 2) if vol > 0 else None,
        "mdd": stats.pct(float(dd.min())),
        "dd_days": int(best),
        "total": stats.pct(float(v[-1] / v[0]) - 1),
    }


def portfolio(
    mk: engine.Market, ev: Any, d: pd.DataFrame, k: int, start: str, allowed: np.ndarray | None
) -> dict[str, Any]:
    """組合層：k 檔等權、含共用規則；與同期等權基準、0050 含息比較；週轉率＝實際成交筆數 ÷ 年 ÷ 槽位。"""
    if d.empty:
        return {}
    s0 = max(1, int(np.searchsorted(np.asarray(ev.dates), start)))
    sim = simulate_portfolio(mk, d, ev.value, k, s0, allowed)
    eq = sim["equity"]
    dates = ev.dates[s0:]
    years = max(len(dates) / 252, 1e-9)
    p = perf(eq)
    ew = mk.ew_level[s0:]
    pe = perf(ew / ew[0])
    out: dict[str, Any] = {
        **p,
        "slots": k,
        "executed": sim["executed"],
        "skipped_full": sim["skipped_full"],
        "skipped_rule": sim["skipped_rule"],
        "turnover": round(sim["executed"] / years / k, 1),
        "trades_per_year": round(sim["executed"] / years, 1),
        "bench_ew": pe,
        "ann_vs_ew": None
        if p.get("ann_return") is None or pe.get("ann_return") is None
        else round(p["ann_return"] - pe["ann_return"], 2),
        "mdd_ratio_ew": None if not p.get("mdd") or not pe.get("mdd") else round(float(p["mdd"]) / float(pe["mdd"]), 2),
        "equity_weekly": _weekly(eq, dates),
    }
    etf = (getattr(ev, "etf", {}) or {}).get("0050")
    if etf is not None:
        s = etf["close"][s0:]
        if np.isfinite(s).sum() > 20:
            first = s[np.isfinite(s)][0]
            p50 = perf(np.where(np.isfinite(s), s / first, np.nan))
            out["bench_0050"] = p50
            out["ann_vs_0050"] = (
                None
                if p.get("ann_return") is None or p50.get("ann_return") is None
                else round(p["ann_return"] - p50["ann_return"], 2)
            )
    return out


def _weekly(eq: np.ndarray, dates: list[str]) -> dict[str, list[Any]]:
    w = pd.Series(eq, index=pd.to_datetime(dates)).resample("W-FRI").last().dropna()
    return {"dates": [x.date().isoformat() for x in w.index], "equity": [round(float(v), 4) for v in w.to_numpy()]}


def evaluate_spec(
    spec: dict[str, Any],
    ev: Any,
    f: dict[str, Any],
    uni: np.ndarray,
    mk: engine.Market,
    c: dict[str, Any],
    g: dict[str, Any],
    *,
    params: dict[str, Any] | None = None,
    hold: int | None = None,
    with_test: bool = False,
    perturb: bool = True,
    delays: bool = True,
) -> dict[str, Any]:
    """一套策略：各段統計（最終測試段只在 with_test 時計算）、40 與 20 日、延後、擾動、分布、組合。"""
    params = dict(params or spec.get("params") or {})
    hold = int(hold or spec["hold"])
    other = 20 if hold == 40 else 40
    start = period_start(spec, ev, f, uni, c)
    if start is None:
        return {"id": spec["id"], "error": "沒有資料"}
    end = ev.dates[-1]
    segs = segments(start, end, g)
    mask = signal_mask(spec, ev, f, uni, mk, params)
    d = events(mk, mask, uni, start, hold)
    d_other = events(mk, mask, uni, start, other) if other in mk.horizons else pd.DataFrame()
    scope_end = end if with_test else segs["test"][0]
    scope = d[d["date"] < (scope_end if not with_test else "9999")]
    out: dict[str, Any] = {
        "id": spec["id"],
        "label": spec["label"],
        "subtitle": spec["subtitle"],
        "base": spec["base"],
        "hold": hold,
        "params": params,
        "signal_start": start,
        "signal_end": end,
        "segments": {},
        "with_test": with_test,
    }
    for key in SEGMENTS:
        if key == "test" and not with_test:
            continue
        out["segments"][key] = seg_stats(d, segs[key], hold, c, mk)
    full_seg = (start, (pd.Timestamp(scope_end) + pd.Timedelta(days=1)).date().isoformat() if with_test else scope_end)
    out["full"] = seg_stats(scope, full_seg, hold, c, mk)
    out["full"]["per_month"] = audit.per_month(scope, start, scope_end)[0]
    if len(d_other):
        so = d_other[d_other["date"] < (scope_end if not with_test else "9999")]
        out["other"] = {"hold": other, **seg_stats(so, full_seg, other, c, mk)}
    out["full"]["bench"] = stats.bench_stats(scope, c)
    if "other" in out and len(d_other):
        out["other"]["bench"] = stats.bench_stats(
            d_other[d_other["date"] < (scope_end if not with_test else "9999")], c
        )
    out["years"] = {str(y): stats.brief(part, c) for y, part in scope.groupby("year")}
    out["dist"] = event_dist(scope)
    allowed = common_rule_mask(ev, f, mk, g)
    out["portfolio"] = portfolio(mk, ev, scope, int(g.get("portfolio_slots", 10)), start, allowed)
    if delays:
        out["delays"] = []
        for dd in [int(x) for x in g.get("delay_days", [1, 3])]:
            de = events(mk, shift_mask(mask, dd), uni, start, hold)
            de = de[de["date"] < (scope_end if not with_test else "9999")]
            out["delays"].append({"delay": dd, **stats.brief(de, c)})
    if perturb:
        out["perturb"] = perturbation(spec, ev, f, uni, mk, c, g, params, hold, start, segs["test"][0])
    out["mask"] = mask
    out["events"] = d
    return out


def perturbation(
    spec: dict[str, Any],
    ev: Any,
    f: dict[str, Any],
    uni: np.ndarray,
    mk: engine.Market,
    c: dict[str, Any],
    g: dict[str, Any],
    params: dict[str, Any],
    hold: int,
    start: str,
    stop: str,
) -> list[dict[str, Any]]:
    """每個參數（含持有天數）各 ×0.8、×1.2，其餘不變；只看開發＋驗證段的扣成本超額。"""
    pct = float(g.get("perturb_pct", 0.2))
    rows = []
    for name in [*params, "hold"]:
        for mult in (1 - pct, 1 + pct):
            p2, h2 = dict(params), hold
            if name == "hold":
                h2 = round(hold * mult)
            else:
                p2[name] = float(params[name]) * mult
            if h2 not in mk.horizons:
                rows.append({"param": name, "mult": mult, "note": f"持有 {h2} 日沒有預先計算"})
                continue
            d = events(mk, signal_mask(spec, ev, f, uni, mk, p2), uni, start, h2)
            d = d[d["date"] < stop]
            rows.append({"param": name, "mult": mult, "value": h2 if name == "hold" else p2[name], **stats.brief(d, c)})
    return rows


# ------------------------------------------------------------------ 門檻（第五節，九項）
def _pos(v: float | None) -> bool:
    return v is not None and v > 0


def gates(r: dict[str, Any], g: dict[str, Any]) -> dict[str, Any]:
    segs, full, other = r["segments"], r["full"], r.get("other") or {}
    dev, val, test = segs.get("dev") or {}, segs.get("val") or {}, segs.get("test") or {}
    years = [v.get("mean_excess") for v in r.get("years", {}).values() if v.get("n")]
    pos = sum(1 for v in years if v is not None and v > 0)
    base = full.get("mean_excess")
    delays = r.get("delays") or []
    keep = float(g.get("delay_keep_ratio", 0.5))
    delay_ok = (
        bool(delays)
        and base is not None
        and base > 0
        and all((x.get("mean_excess") or -1e9) >= base * keep for x in delays)
    )
    dist = r.get("dist") or {}
    win, payoff = dist.get("win"), dist.get("payoff")
    wp_ok = any(
        win is not None and payoff is not None and win >= float(w) and payoff >= float(p)
        for w, p in g.get("win_payoff", [[50, 1.5], [55, 1.2]])
    )
    port = r.get("portfolio") or {}
    bench = port.get("bench_ew") or {}
    port_ok = (
        port.get("ann_return") is not None
        and bench.get("ann_return") is not None
        and port["ann_return"] > bench["ann_return"]
        and port.get("mdd") is not None
        and bench.get("mdd") is not None
        and abs(port["mdd"]) <= abs(bench["mdd"]) * float(g.get("portfolio_mdd_ratio", 1.2))
    )
    checks = {
        "net_40_20": _pos(base) and _pos(other.get("mean_excess")),
        "t_corrected": full.get("t_corr") is not None and full["t_corr"] >= float(g.get("t_corr_min", 3)),
        "segments": _pos(dev.get("mean_excess"))
        and _pos(val.get("mean_excess"))
        and _pos(test.get("mean_excess"))
        and test["mean_excess"] >= dev["mean_excess"] * float(g.get("test_vs_dev_min", 0.5)),
        "years": bool(years) and pos / len(years) >= float(g.get("year_pass_ratio", 0.7)) - 1e-9,
        "perturb": bool(r.get("perturb"))
        and all((p.get("mean_excess") or 0) > 0 for p in r["perturb"] if "mean_excess" in p),
        "delays": delay_ok,
        "per_month": (full.get("per_month") or 0) >= float(g.get("per_month_min", 10)),
        "win_payoff": wp_ok,
        "portfolio": port_ok,
    }
    labels = {
        "net_40_20": f"40 與 20 日扣成本超額皆 > 0：{base}% / {other.get('mean_excess')}%",
        "t_corrected": f"校正後 t ≥ {g.get('t_corr_min', 3)}：{full.get('t_corr')}（{full.get('t_corr_method', '')}）",
        "segments": f"三段皆 > 0 且測試 ≥ 開發 50%：{dev.get('mean_excess')}% / {val.get('mean_excess')}% / {test.get('mean_excess')}%",
        "years": f"逐年至少 {g.get('year_pass_ratio', 0.7):.0%} 為正：{pos}/{len(years)}",
        "perturb": "參數 ±20% 皆 > 0："
        + "、".join(
            f"{p['param']}×{p['mult']:.1f} {p.get('mean_excess')}%"
            for p in r.get("perturb") or []
            if "mean_excess" in p
        ),
        "delays": f"延後 1、3 日 ≥ 原本 {keep:.0%}："
        + "、".join(f"+{x['delay']} 日 {x.get('mean_excess')}%" for x in delays),
        "per_month": f"每月觸發 ≥ {g.get('per_month_min', 10)}：{full.get('per_month')}（進場日 {((full.get('concentration') or {}).get('dates'))} 個、最集中 5% 的日子承載 {((full.get('concentration') or {}).get('top5pct_share'))}）",
        "win_payoff": f"勝率 ≥ 50% 且賺賠比 ≥ 1.5，或 ≥ 55% 且 ≥ 1.2：{win}% / {payoff}",
        "portfolio": f"10 檔組合年化 > 等權基準、最大回撤 ≤ 基準 ×{g.get('portfolio_mdd_ratio', 1.2)}：{port.get('ann_return')}% vs {bench.get('ann_return')}%，回撤 {port.get('mdd')}% vs {bench.get('mdd')}%",
    }
    return {"checks": checks, "labels": labels, "passed": all(checks.values())}


# ------------------------------------------------------------------ 前瞻驗證
def forward(
    mk: engine.Market,
    d: pd.DataFrame,
    since: str,
    days: int,
    c: dict[str, Any],
    backtest: float | None,
    signals: int | None = None,
) -> dict[str, Any]:
    """合併日之後的訊號：已出場者（去重事件表只含已出場）的扣成本超額與回測對照；未滿 days 個交易日只顯示累積中。
    signals＝合併日起首次觸發的訊號數（含尚未出場者）。"""
    dates = np.asarray(mk.dates)
    elapsed = int((dates >= since).sum())
    done = d[d["date"] >= since]
    b = stats.brief(done, c) if len(done) else {"n": 0}
    return {
        "since": since,
        "elapsed_days": elapsed,
        "required_days": days,
        "ready": elapsed >= days,
        "signals": len(done) if signals is None else int(signals),
        "completed": len(done),
        "mean_excess": b.get("mean_excess"),
        "t": b.get("t"),
        "backtest_mean_excess": backtest,
    }


# ------------------------------------------------------------------ 策略庫掛入
def build(res: dict[str, Any], f: dict[str, Any] | None = None, *, with_test: bool = True) -> dict[str, Any]:
    """所有波段策略 → 策略庫項目（與 strategies.json 的 StrategyItem 同形狀）＋訊號追蹤用的每日首次觸發＋相關矩陣。"""
    ctx = res["_ctx"]
    ev, uni, c = ctx["ev"], ctx["uni"], ctx["cfg"]
    sw = cfg()
    g = gates_cfg(c)
    if f is None:
        f = ind.build_features(ev, uni, c["indicators"])
    holds = sorted(
        {int(s["hold"]) for s in sw["strategies"]}
        | {20, 40}
        | {round(int(s["hold"]) * m) for s in sw["strategies"] for m in PERTURB_MULTS}
    )
    mk = market_for(ev, uni, c, holds)
    T = len(ev.dates)
    last = T - 1
    items: list[dict[str, Any]] = []
    signals: dict[str, dict[str, list[str]]] = {}
    details: dict[str, Any] = {}
    series: dict[str, pd.Series] = {}
    for spec in sw["strategies"]:
        r = evaluate_spec(spec, ev, f, uni, mk, c, g, with_test=with_test)
        if "error" in r:
            items.append(
                {
                    "id": spec["id"],
                    "test": spec["id"],
                    "label": spec["label"],
                    "subtitle": spec["subtitle"],
                    "kind": "swing",
                    "verdict": verdict.FEW,
                    "enabled": False,
                    "reasons": [r["error"]],
                }
            )
            continue
        hold = int(r["hold"])
        gt: dict[str, Any] = gates(r, g) if with_test else {"checks": {}, "labels": {}, "passed": False}
        registered = bool(spec.get("enabled", True))
        reasons = [gt["labels"][k] for k, ok in gt["checks"].items() if not ok]
        if not registered:
            reasons.insert(0, "註冊清單停用")
        mask = engine.first_triggers(r["mask"], uni, hold)
        d = r["events"]
        full = r["full"]
        since = str(g.get("forward_since", ev.dates[-1]))
        n_fwd = int(mask[np.asarray(ev.dates) >= since].sum())
        fwd = forward(mk, d, since, int(g.get("forward_days", 60)), c, full.get("mean_excess"), signals=n_fwd)
        item: dict[str, Any] = {
            "id": spec["id"],
            "test": spec["id"],
            "kind": "swing",
            "label": spec["label"],
            "subtitle": spec["subtitle"],
            "family": spec.get("family"),
            "mechanism": spec.get("mechanism"),
            "verdict": verdict.VALID if gt["passed"] else verdict.INVALID,
            "gates_passed": gt["passed"],
            "enabled": registered and gt["passed"],
            "registered": registered,
            "reasons": reasons,
            "env": None,
            "param": "、".join(f"{k}={v:g}" for k, v in r["params"].items()) + f"、hold={hold}",
            "definition": spec["subtitle"],
            "signal_start": r["signal_start"],
            "signal_end": r["signal_end"],
            "n": full.get("n"),
            "t": full.get("t"),
            "t_nw": full.get("t_nw"),
            "t_corr": full.get("t_corr"),
            "mean_excess": full.get("mean_excess"),
            "mean_gross_excess": full.get("mean_gross_excess"),
            "per_month": full.get("per_month"),
            "win": full.get("win"),
            "payoff": full.get("payoff"),
            "h": {
                str(hold): {
                    "n": full.get("n"),
                    "mean_excess": full.get("mean_excess"),
                    "mean_gross_excess": full.get("mean_gross_excess"),
                    "t": full.get("t"),
                    "bench": full.get("bench"),
                },
                **(
                    {
                        str(r["other"]["hold"]): {
                            "n": r["other"].get("n"),
                            "mean_excess": r["other"].get("mean_excess"),
                            "mean_gross_excess": r["other"].get("mean_gross_excess"),
                            "t": r["other"].get("t"),
                            "bench": r["other"].get("bench"),
                        }
                    }
                    if r.get("other")
                    else {}
                ),
            },
            "years": {y: v.get("mean_excess") for y, v in r["years"].items()},
            "health": _health(d, c, hold, T, full.get("mean_excess")),
            "today": [
                {"code": ev.codes[i], "name": ev.names.get(ev.codes[i], ev.codes[i]), "basis": []}
                for i in np.nonzero(mask[last])[0]
            ],
            "exit": {"rule": "fixed", "param": str(hold), "label": f"固定 {hold} 日", "stats": {}, "alternatives": []},
            "forward": fwd,
            "swing": {
                "hold": hold,
                "params": r["params"],
                "segments": r["segments"],
                "split": {k: list(v) for k, v in segments(r["signal_start"], r["signal_end"], g).items()},
                "gates": gt,
                "perturb": r.get("perturb"),
                "delays": r.get("delays"),
                "dist": r["dist"],
                "portfolio": {k: v for k, v in r["portfolio"].items() if k != "equity_weekly"},
                "full": full,
                "other": r.get("other"),
                "forward": fwd,
                "test_note": "最終測試段 2024-11 起上一輪已查看兩次，非全新樣本",
            },
        }
        split_date = str(((c.get("grading") or {}).get("valid") or {}).get("split_date", "2022-01-01"))
        item["split2022"] = {
            "date": split_date,
            "pre": stats.brief(d[d["date"] < split_date], c),
            "post": stats.brief(d[d["date"] >= split_date], c),
        }
        item["today_note"] = None if item["today"] else f"{ev.dates[last]} 收盤後沒有股票首次同時符合全部條件。"
        if r["portfolio"].get("equity_weekly"):
            w = r["portfolio"]["equity_weekly"]
            item["curve"] = {"dates": w["dates"], "equity": w["equity"], "bench": [], "etf": {}}
        signals[spec["id"]] = {
            ev.dates[t]: [ev.codes[i] for i in np.nonzero(mask[t])[0]]
            for t in range(max(0, T - 250), T)
            if mask[t].any()
        }
        details[spec["id"]] = dict(item["swing"])
        series[spec["id"]] = audit.daily_series(mk, d)
        items.append(item)
        log.info(
            "swing %s：%s；%s", spec["id"], "通過" if gt["passed"] else "未通過", "；".join(reasons) or "九項門檻全過"
        )
    corr = audit.correlation(series) if len(series) > 1 else {"pairs": [], "matrix": {}}
    for it in items:
        if it.get("swing"):
            it["swing"]["correlation"] = {
                k: v for k, v in (corr.get("matrix", {}).get(it["id"]) or {}).items() if k != it["id"]
            }
    return {"strategies": items, "_signals": signals, "details": details, "correlation": corr}


def _health(d: pd.DataFrame, c: dict[str, Any], hold: int, T: int, long_m: float | None) -> dict[str, Any]:
    cut = T - 1 - hold - int(c.get("recent_days", 60))
    rec = stats.brief(d[d["t"] >= cut], c) if len(d) else {"n": 0}
    rm, n = rec.get("mean_excess"), int(rec.get("n") or 0)
    if n < 20 or rm is None:
        status = "資料累積中"
    elif rm < 0 and (long_m or 0) > 0:
        status = "近期轉弱"
    elif long_m and rm < long_m / 2:
        status = "近期低於長期"
    else:
        status = "與長期一致"
    return {"status": status, "recent": rm, "recent_n": n, "recent_t": rec.get("t"), "since": None, "long": long_m}


# ------------------------------------------------------------------ 報告
def _f(v: Any, digits: int = 2, sign: bool = True) -> str:
    return audit._f(v, digits, sign)


def markdown(lib: dict[str, Any]) -> str:
    lines = []
    for s in lib["strategies"]:
        sw = s.get("swing")
        if not sw:
            lines += [f"### {s['label']}：{'；'.join(s.get('reasons') or [])}", ""]
            continue
        lines += [
            f"### {s['label']}（{s['subtitle']}）",
            "",
            f"參數：{s['param']}；訊號期間 {s['signal_start']}～{s['signal_end']}；九項門檻 {'全過' if sw['gates'].get('passed') else '未全過'}",
            "",
        ]
        lines += [
            "| 段 | 期間 | 樣本 | 每月 | 毛超額 % | 扣成本超額 % | t | NW | 區塊 | 校正後 t | 勝率 % | 賺賠比 |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        rows = [(SEG_LABEL[k], sw["segments"][k]) for k in SEGMENTS if sw["segments"].get(k)] + [("全樣本", sw["full"])]
        if sw.get("other"):
            rows.append((f"全樣本（{sw['other']['hold']} 日）", sw["other"]))
        for name, x in rows:
            lines.append(
                f"| {name} | {x['period'][0]}～{x['period'][1]} | {x.get('n', 0)} | {x.get('per_month')} | {_f(x.get('mean_gross_excess'))} | {_f(x.get('mean_excess'))} | "
                f"{_f(x.get('t'), sign=False)} | {_f(x.get('t_nw'), sign=False)} | {_f(x.get('t_block'), sign=False)} | **{_f(x.get('t_corr'), sign=False)}** | {_f(x.get('win'), 1, False)} | {x.get('payoff')} |"
            )
        lines += ["", "門檻：", ""]
        for k, ok in sw["gates"]["checks"].items():
            lines.append(f"- {'✅' if ok else '❌'} {sw['gates']['labels'][k]}")
        lines += [
            "",
            "參數 ±20%（開發＋驗證段）："
            + "；".join(
                f"{p['param']}×{p['mult']:.1f}（{p.get('value')}）{_f(p.get('mean_excess'))}（n {p.get('n', 0)}）"
                for p in sw.get("perturb") or []
            ),
            "",
        ]
        lines.append(
            "進場延後："
            + "；".join(
                f"+{x['delay']} 日 {_f(x.get('mean_excess'))}（n {x.get('n', 0)}、t {_f(x.get('t'), sign=False)}）"
                for x in sw.get("delays") or []
            )
        )
        d, p = sw["dist"], sw["portfolio"]
        lines.append(
            f"事件：勝率 {_f(d.get('win'), 1, False)}%、平均賺 {_f(d.get('avg_win'))}%／賠 {_f(d.get('avg_loss'))}%、賺賠比 {d.get('payoff')}、"
            f"連續虧損最長 {d.get('loss_streak', {}).get('max')} 筆（中位數 {d.get('loss_streak', {}).get('p50')}、p90 {d.get('loss_streak', {}).get('p90')}）、MAE 中位數 {_f(d.get('mae_p50'))}%、最差 10% {_f(d.get('mae_p90'))}%、最差 {_f(d.get('mae_worst'))}%。"
        )
        be, b50 = p.get("bench_ew") or {}, p.get("bench_0050") or {}
        lines.append(
            f"{p.get('slots')} 檔組合（含共用規則）：年化 {_f(p.get('ann_return'), 1)}%（等權基準 {_f(be.get('ann_return'), 1)}%、0050 含息 {_f(b50.get('ann_return'), 1)}%）、波動 {_f(p.get('vol_ann'), 1, False)}%、Sharpe {p.get('sharpe')}、"
            f"最大回撤 {_f(p.get('mdd'), 1)}%（基準 {_f(be.get('mdd'), 1)}%，比值 {p.get('mdd_ratio_ew')}）、回撤期間 {p.get('dd_days')} 日、實際成交 {p.get('executed')} 筆（槽位滿跳過 {p.get('skipped_full')}、共用規則擋下 {p.get('skipped_rule')}）、週轉率每槽 {p.get('turnover')} 次／年。"
        )
        lines.append("逐年：" + "、".join(f"{y} {_f(v)}" for y, v in s.get("years", {}).items()))
        if sw.get("correlation"):
            lines.append("與其他新策略的相關：" + "、".join(f"{k} {v}" for k, v in sw["correlation"].items()))
        lines.append("")
    return "\n".join(lines) + "\n"
