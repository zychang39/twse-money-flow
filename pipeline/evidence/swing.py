"""波段策略（2026-10-01 新增；`config/swing.yml`、docs/swing/HYPOTHESIS.md、TRIALS.md）。

新增檔案；入口只做最小掛入（`run_and_write` 把結果併入 strategies.json、CLI `python -m pipeline swing`）。
沿用評估引擎（進出場、成本、跌停鎖死、同日等權基準、首次觸發去重、日曆時間法）；
新增：三段切分（開發／驗證／最終測試）、校正後 t、參數 ±20% 擾動、上線門檻、組合層指標（Sharpe、最大回撤、
勝率、賺賠比、週轉率、回撤與連續虧損分布）。

時間點：所有條件只用訊號日 T（含）以前已公布的資料；`tests/pipeline/test_swing.py` 以截斷測試鎖定。
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.evidence import audit, engine, stats, verdict
from pipeline.evidence import indicators as ind
from pipeline.evidence.strategies import perf, simulate

log = logging.getLogger(__name__)

SEGMENTS = ("dev", "val", "test")
SEG_LABEL = {"dev": "開發", "val": "驗證", "test": "最終測試"}


def cfg() -> dict[str, Any]:
    return config.load("swing")


# ------------------------------------------------------------------ 訊號
def value20(ev: Any) -> np.ndarray:
    """訊號日（含）20 日平均成交值（元）。"""
    return pd.DataFrame(np.nan_to_num(ev.value, nan=0.0)).rolling(20, min_periods=20).mean().to_numpy()


def base_mask(base: str, ev: Any, f: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    """基礎事件 (T, C) 與「可計算」遮罩。"""
    T = len(ev.dates)
    if base == "rev_high12":
        m = ind.revenue_event(f["rev"], "high12", T, ev.codes)
        return m, np.isfinite(f["rev_yoy"])
    if base == "high52":
        h = f["h52"]
        return ind.cross_up(h, 0.95), np.isfinite(h)
    if base == "rs90":
        rs = f["rs_pct"]
        return ind.cross_up(rs, 90.0), np.isfinite(rs)
    raise ValueError(base)


def signal_mask(
    spec: dict[str, Any], ev: Any, f: dict[str, Any], uni: np.ndarray, mk: engine.Market, params: dict[str, Any]
) -> np.ndarray:
    """(T, C)：訊號日在 universe 內且全部條件成立。只用 T 日（含）以前的資料（截斷測試保證）。"""
    m, _ = base_mask(str(spec["base"]), ev, f)
    m = m & uni
    with np.errstate(invalid="ignore"):
        if "rs_min" in params:
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


def period_start(spec: dict[str, Any], ev: Any, f: dict[str, Any], uni: np.ndarray, c: dict[str, Any]) -> str | None:
    _, avail = base_mask(str(spec["base"]), ev, f)
    ok = (avail & uni).any(axis=1)
    if not ok.any():
        return None
    first = ev.dates[int(np.argmax(ok))]
    if spec["base"] in ("high52", "rs90"):
        first = max(first, str(c["price_start"]))
    return first


def segments(start: str, end: str, split: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """依訊號期間的日曆時間切三段：[start, d1) 開發、[d1, d2) 驗證、[d2, end] 最終測試。"""
    s, e = pd.Timestamp(start), pd.Timestamp(end)
    d1 = (s + (e - s) * float(split["dev"])).date().isoformat()
    d2 = (s + (e - s) * (float(split["dev"]) + float(split["val"]))).date().isoformat()
    stop = (e + pd.Timedelta(days=1)).date().isoformat()
    return {"dev": (start, d1), "val": (d1, d2), "test": (d2, stop)}


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


def seg_stats(d: pd.DataFrame, seg: tuple[str, str], hold: int, c: dict[str, Any]) -> dict[str, Any]:
    part = d[(d["date"] >= seg[0]) & (d["date"] < seg[1])]
    b = stats.brief(part, c)
    ct = audit.corrected_t(part, hold) if len(part) else {}
    pm, months = audit.per_month(part, seg[0], seg[1]) if len(part) else (0.0, 0)
    return {
        **b,
        "t_corr": ct.get("t_corr"),
        "t_nw": ct.get("t_nw"),
        "t_block": ct.get("t_block"),
        "per_month": pm,
        "months": months,
        "period": list(seg),
    }


def event_dist(d: pd.DataFrame) -> dict[str, Any]:
    """事件層級：勝率、賺賠比、連續虧損分布（依訊號日排序）。"""
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
    return {
        "win": stats.pct(float((net > 0).mean())),
        "avg_win": stats.pct(float(wins.mean())) if wins.size else None,
        "avg_loss": stats.pct(float(losses.mean())) if losses.size else None,
        "payoff": round(float(wins.mean() / -losses.mean()), 2)
        if wins.size and losses.size and losses.mean() < 0
        else None,
        "loss_streak": {"max": int(s.max()), "p50": float(np.percentile(s, 50)), "p90": float(np.percentile(s, 90))},
        "mae_p50": stats.pct(float(np.percentile(d["mae"], 50))),
        "mae_p90": stats.pct(float(np.percentile(d["mae"], 10))),
    }


def portfolio(mk: engine.Market, ev: Any, d: pd.DataFrame, k: int, start: str) -> dict[str, Any]:
    """k 檔組合（固定持有日出場）：Sharpe、最大回撤、回撤分布、週轉率（每年每個槽位的來回次數）。"""
    if d.empty:
        return {}
    trades = d.assign(entry=mk.open[d["e"].to_numpy(), d["c"].to_numpy()], px=np.nan)
    px = np.where(
        d["x"].to_numpy() < len(mk.dates),
        mk.open[np.minimum(d["x"].to_numpy(), len(mk.dates) - 1), d["c"].to_numpy()],
        np.nan,
    )
    trades["px"] = px
    s0 = max(1, int(np.searchsorted(np.asarray(ev.dates), start)))
    eq = simulate(mk, trades, ev.value, k, s0)
    dates = ev.dates[s0:]
    p = perf(eq, dates)
    dd = eq / np.maximum.accumulate(eq) - 1
    # 回撤分布：每次從高點到重新創高之間的最深回撤
    troughs: list[float] = []
    cur = 0.0
    for v in dd:
        if v < 0:
            cur = min(cur, v)
        elif cur < 0:
            troughs.append(cur)
            cur = 0.0
    if cur < 0:
        troughs.append(cur)
    tr = np.asarray(troughs) if troughs else np.zeros(1)
    years = max(len(dates) / 252, 1e-9)
    return {
        **p,
        "dd_dist": {
            "episodes": len(troughs),
            "p50": stats.pct(float(np.percentile(tr, 50))),
            "p90": stats.pct(float(np.percentile(tr, 10))),
            "worst": stats.pct(float(tr.min())),
        },
        "turnover": round(len(d) / years / k, 1),
        "trades_per_year": round(len(d) / years, 1),
        "equity_weekly": _weekly(eq, dates),
    }


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
    sw: dict[str, Any],
    *,
    params: dict[str, Any] | None = None,
    hold: int | None = None,
    with_test: bool = False,
    perturb: bool = True,
) -> dict[str, Any]:
    """一套策略：各段統計（最終測試段只在 with_test 時計算）、全樣本校正後 t、逐年、擾動、分布、組合。"""
    params = dict(params or spec.get("params") or {})
    hold = int(hold or spec["hold"])
    start = period_start(spec, ev, f, uni, c)
    if start is None:
        return {"id": spec["id"], "error": "沒有資料"}
    end = ev.dates[-1]
    segs = segments(start, end, sw["split"])
    mask = signal_mask(spec, ev, f, uni, mk, params)
    d = events(mk, mask, uni, start, hold)
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
    }
    for key in SEGMENTS:
        if key == "test" and not with_test:
            continue
        out["segments"][key] = seg_stats(d, segs[key], hold, c)
    dv = d[d["date"] < segs["test"][0]]  # 開發＋驗證（不含最終測試）
    scope = d if with_test else dv
    ct = audit.corrected_t(scope, hold) if len(scope) else {}
    out["full"] = {
        **stats.brief(scope, c),
        **ct,
        "per_month": audit.per_month(scope, start, segs["test"][0] if not with_test else end)[0],
    }
    out["years"] = {str(y): stats.brief(part, c) for y, part in scope.groupby("year")}
    out["dist"] = event_dist(scope)
    out["portfolio"] = portfolio(mk, ev, scope, int(sw.get("slots", 5)), start)
    if perturb:
        out["perturb"] = perturbation(spec, ev, f, uni, mk, c, sw, params, hold, start, segs["test"][0])
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
    sw: dict[str, Any],
    params: dict[str, Any],
    hold: int,
    start: str,
    stop: str,
) -> list[dict[str, Any]]:
    """每個參數（含持有天數）各 ×0.8、×1.2，其餘不變；只看開發＋驗證段的平均超額。"""
    pct = float(sw["gates"]["perturb_pct"])
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
            b = stats.brief(d, c)
            rows.append({"param": name, "mult": mult, "value": h2 if name == "hold" else p2[name], **b})
    return rows


# ------------------------------------------------------------------ 門檻
def best_existing(ctx: dict[str, Any], mk: engine.Market, hold: int, seg: tuple[str, str]) -> dict[str, Any]:
    """修正後現有訊號在同一段、同一持有天數的最佳平均超額（事件型、universe 內、去重）。"""
    uni, c = ctx["uni"], ctx["cfg"]
    best: dict[str, Any] = {"id": None, "mean_excess": None}
    verdicts = {row["id"]: row.get("verdict") for row in ctx.get("rows", [])}
    for tid, keep in ctx["tests"].items():
        if verdicts.get(tid) in (verdict.LIMITED, verdict.FEW):  # 樣本範圍受限、樣本不足的指標不當比較基準
            continue
        d = events(mk, keep["mask"], uni, str(keep["start"]), hold)
        d = d[(d["date"] >= seg[0]) & (d["date"] < seg[1])]
        if len(d) < 30:
            continue
        b = stats.brief(d, c)
        m = b.get("mean_excess")
        if m is not None and (best["mean_excess"] is None or m > best["mean_excess"]):
            best = {"id": tid, "mean_excess": m, "t": b.get("t"), "n": b.get("n")}
    return best


def gates(r: dict[str, Any], sw: dict[str, Any], best: dict[str, Any]) -> dict[str, Any]:
    g = sw["gates"]
    test, dev = r["segments"].get("test") or {}, r["segments"].get("dev") or {}
    full = r.get("full") or {}
    years = [v.get("mean_excess") for v in r.get("years", {}).values() if v.get("n")]
    pos = sum(1 for v in years if v is not None and v > 0)
    checks = {
        "test_beats_best": (
            test.get("mean_excess") is not None
            and best.get("mean_excess") is not None
            and test["mean_excess"] > best["mean_excess"]
        ),
        "t_corrected": full.get("t_corr") is not None and full["t_corr"] > float(g["t_corrected_min"]),
        "test_vs_dev": (
            test.get("mean_excess") is not None
            and dev.get("mean_excess") is not None
            and dev["mean_excess"] > 0
            and test["mean_excess"] >= dev["mean_excess"] * float(g["test_vs_dev_min"])
        ),
        "perturb_positive": bool(r.get("perturb"))
        and all((p.get("mean_excess") or 0) > 0 for p in r["perturb"] if "mean_excess" in p),
        "years": bool(years) and pos / len(years) >= float(g["year_pass_ratio"]) - 1e-9,
        "per_month": (full.get("per_month") or 0) >= float(g["per_month_min"]),
    }
    labels = {  # 「條件：實際值」；通過與否由 checks 決定
        "test_beats_best": f"測試段超額須 > 現有最佳：{test.get('mean_excess')}% vs {best.get('mean_excess')}%（{best.get('id')}）",
        "t_corrected": f"校正後 t 須 > {g['t_corrected_min']}：{full.get('t_corr')}",
        "test_vs_dev": f"測試段須 ≥ 開發段 × {g['test_vs_dev_min']}：{test.get('mean_excess')}% vs {dev.get('mean_excess')}%",
        "perturb_positive": "參數 ±20% 後超額須仍 > 0："
        + "、".join(
            f"{p['param']}×{p['mult']:.1f} {p.get('mean_excess')}%"
            for p in r.get("perturb") or []
            if "mean_excess" in p
        ),
        "years": f"逐年至少 {g['year_pass_ratio']:.0%} 年為正：{pos}/{len(years)}",
        "per_month": f"每月觸發須 ≥ {g['per_month_min']}：{full.get('per_month')}",
    }
    return {"checks": checks, "labels": labels, "passed": all(checks.values()), "best_existing": best}


# ------------------------------------------------------------------ 策略庫掛入
def build(res: dict[str, Any], f: dict[str, Any] | None = None, *, with_test: bool = True) -> dict[str, Any]:
    """所有波段策略 → 策略庫項目（與 strategies.json 的 StrategyItem 同形狀）＋訊號追蹤用的每日首次觸發。"""
    ctx = res["_ctx"]
    ev, uni, c = ctx["ev"], ctx["uni"], ctx["cfg"]
    sw = cfg()
    if f is None:
        f = ind.build_features(ev, uni, c["indicators"])
    holds = sorted(
        {int(s["hold"]) for s in sw["strategies"]}
        | {round(int(s["hold"]) * m) for s in sw["strategies"] for m in (0.8, 1.2)}
    )
    mk = market_for(ev, uni, c, holds)
    T = len(ev.dates)
    last = T - 1
    items: list[dict[str, Any]] = []
    signals: dict[str, dict[str, list[str]]] = {}
    details: dict[str, Any] = {}
    for spec in sw["strategies"]:
        r = evaluate_spec(spec, ev, f, uni, mk, c, sw, with_test=with_test)
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
        segs = segments(r["signal_start"], r["signal_end"], sw["split"])
        best = best_existing({**ctx, "rows": res["rows"]}, mk, hold, segs["test"]) if with_test else {}
        g: dict[str, Any] = (
            gates(r, sw, best) if with_test else {"checks": {}, "labels": {}, "passed": False, "best_existing": {}}
        )
        registered = bool(spec.get("enabled", True))
        enabled = registered and g["passed"]
        reasons = [g["labels"][k] for k, ok in g["checks"].items() if not ok]
        if not registered:
            reasons.insert(0, "註冊清單停用")
        mask = engine.first_triggers(r["mask"], uni, hold)
        d = r["events"]
        full = r["full"]
        item: dict[str, Any] = {
            "id": spec["id"],
            "test": spec["id"],
            "kind": "swing",
            "label": spec["label"],
            "subtitle": spec["subtitle"],
            "family": spec.get("family"),
            "verdict": verdict.VALID if g["passed"] else verdict.INVALID,
            "enabled": enabled,
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
            "h": {str(hold): {"n": full.get("n"), "mean_excess": full.get("mean_excess"), "t": full.get("t")}},
            "years": {y: v.get("mean_excess") for y, v in r["years"].items()},
            "health": _health(d, c, hold, T, full.get("mean_excess")),
            "today": [
                {"code": ev.codes[i], "name": ev.names.get(ev.codes[i], ev.codes[i]), "basis": []}
                for i in np.nonzero(mask[last])[0]
            ],
            "exit": {"rule": "fixed", "param": str(hold), "label": f"固定 {hold} 日", "stats": {}, "alternatives": []},
            "swing": {
                "hold": hold,
                "params": r["params"],
                "segments": r["segments"],
                "split": {k: list(v) for k, v in segs.items()},
                "gates": g,
                "perturb": r.get("perturb"),
                "dist": r["dist"],
                "portfolio": {k: v for k, v in r["portfolio"].items() if k != "equity_weekly"},
                "full": full,
            },
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
        details[spec["id"]] = {k: v for k, v in item["swing"].items()}
        items.append(item)
        log.info(
            "swing %s：%s；%s", spec["id"], "通過" if g["passed"] else "未通過", "；".join(reasons) or "全部門檻通過"
        )
    return {"strategies": items, "_signals": signals, "details": details}


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
            f"參數：{s['param']}；訊號期間 {s['signal_start']}～{s['signal_end']}；判定 **{s['verdict']}**（上架 {s['enabled']}）",
            "",
        ]
        lines += [
            "| 段 | 期間 | 樣本 | 每月觸發 | 平均超額 % | t | 校正後 t | 勝率 % |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for k in SEGMENTS:
            g = sw["segments"].get(k)
            if not g:
                continue
            lines.append(
                f"| {SEG_LABEL[k]} | {g['period'][0]}～{g['period'][1]} | {g.get('n', 0)} | {g.get('per_month')} | {_f(g.get('mean_excess'))} | {_f(g.get('t'), sign=False)} | {_f(g.get('t_corr'), sign=False)} | {_f(g.get('win'), 1, False)} |"
            )
        full = sw["full"]
        lines.append(
            f"| 全樣本 | — | {full.get('n', 0)} | {full.get('per_month')} | {_f(full.get('mean_excess'))} | {_f(full.get('t'), sign=False)} | {_f(full.get('t_corr'), sign=False)} | {_f(full.get('win'), 1, False)} |"
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
        d, p = sw["dist"], sw["portfolio"]
        lines.append(
            f"事件：勝率 {_f(d.get('win'), 1, False)}%、平均賺 {_f(d.get('avg_win'))}%／賠 {_f(d.get('avg_loss'))}%、賺賠比 {d.get('payoff')}、"
            f"連續虧損最長 {d.get('loss_streak', {}).get('max')} 筆（中位數 {d.get('loss_streak', {}).get('p50')}、p90 {d.get('loss_streak', {}).get('p90')}）、MAE 中位數 {_f(d.get('mae_p50'))}%、最差 10% {_f(d.get('mae_p90'))}%。"
        )
        lines.append(
            f"5 檔組合：年化 {_f(p.get('ann_return'), 1)}%、Sharpe {p.get('sharpe')}、最大回撤 {_f(p.get('mdd'), 1)}%、回撤天數 {p.get('dd_days')}、"
            f"回撤分布（{(p.get('dd_dist') or {}).get('episodes')} 次）中位數 {_f((p.get('dd_dist') or {}).get('p50'), 1)}%、最深 10% {_f((p.get('dd_dist') or {}).get('p90'), 1)}%、"
            f"週轉率 {p.get('turnover')} 次／年／槽（每年 {p.get('trades_per_year')} 筆）。"
        )
        lines.append("逐年：" + "、".join(f"{y} {_f(v)}" for y, v in s.get("years", {}).items()))
        lines.append("")
    return "\n".join(lines) + "\n"
