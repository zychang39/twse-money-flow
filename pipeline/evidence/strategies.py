"""策略庫（M2；METHODOLOGY §11）：把判定為「有效」或「環境依賴」的指標包成內建策略。

每個策略：條件（config/strategies.yml）、出場規則（§10.10 各規則選定參數中相對指數最高者）、多期間報表、逐年報酬、
策略健康度（近 60 日 vs 長期）、環境條件與今日狀態、今日新觸發、樣本範圍；另外預先模擬同時持有 K 檔的組合
（K＝1、3、5、10），提供槓桿計算需要的歷史最大回撤、年化報酬與波動、最大不利波動分布、跌停鎖死發生率。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.evidence import engine, exits, stats, verdict
from pipeline.evidence.engine import Market

ENV_STATE = {"regime": "regime_up", "trend": "trend_up", "quarter_end": "quarter_end"}


def best_exit(detail: dict[str, Any]) -> dict[str, Any] | None:
    """各出場規則的選定參數中，相對指數（exc_idx）最高者；同分取 MAE 較小者。"""
    rules = [r for r in (detail.get("exits") or {}).get("rules", []) if r.get("chosen") and r.get("n")]
    rules = [r for r in rules if r.get("exc_idx") is not None]
    if not rules:
        return None
    return max(rules, key=lambda r: (r["exc_idx"], r.get("mae") or -999))


def simulate(mk: Market, trades: pd.DataFrame, value: np.ndarray, k: int, start: int) -> np.ndarray:
    """同時持有 k 檔的組合（每檔 1/k 的權益）逐日權益（從 start 列起，起始 1.0）。

    - 每天開盤先出場（依出場規則的出場列與出場價，扣賣出手續費與證交稅），再進場：當天進場的訊號依前一日成交值由大到小
      填入空位；已持有的股票不重複進場。每筆投入＝前一日收盤權益 ÷ k（現金不足時以剩餘現金為限），扣買進手續費。
    - 收盤以還原收盤價計值（當天無收盤沿用最後一個收盤）。
    """
    T = len(mk.dates)
    fee, tax = mk.fee, mk.tax
    by_entry: dict[int, list[tuple[float, int, int, float, float]]] = {}
    for e, c, x, entry, px in trades[["e", "c", "x", "entry", "px"]].itertuples(index=False):
        if e < start or not np.isfinite(px) or not np.isfinite(entry) or x >= T:
            continue
        v = value[e - 1, c] if e >= 1 and np.isfinite(value[e - 1, c]) else 0.0
        by_entry.setdefault(int(e), []).append((-float(v), int(c), int(x), float(entry), float(px)))
    cash = 1.0
    pos: dict[int, list[float]] = {}  # c → [股數, 出場列, 出場價, 最後收盤]
    eq = np.ones(T - start)
    prev_eq = 1.0
    for d in range(start, T):
        for c in [c for c, p in pos.items() if int(p[1]) == d]:
            shares, _, px, _ = pos.pop(c)
            cash += shares * px * (1 - fee - tax)
        free = k - len(pos)
        for _, c, x, entry, px in sorted(by_entry.get(d, [])):
            if free <= 0:
                break
            if c in pos or x <= d:
                continue
            alloc = min(prev_eq / k, cash)
            if alloc <= 0:
                break
            shares = alloc / (entry * (1 + fee))
            cash -= alloc
            pos[c] = [shares, x, px, entry]
            free -= 1
        value_now = cash
        for c, p in pos.items():
            cl = mk.close[d, c]
            if np.isfinite(cl):
                p[3] = cl
            value_now += p[0] * p[3]
        eq[d - start] = value_now
        prev_eq = value_now
    return eq


def curve_stats(eq: np.ndarray, dates: list[str]) -> dict[str, Any]:
    if eq.size < 20:
        return {"days": int(eq.size)}
    r = eq[1:] / eq[:-1] - 1
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1
    years = eq.size / 252
    s = pd.Series(eq, index=pd.to_datetime(dates))
    ye = s.groupby(s.index.year).last()
    yearly = {}
    prev = 1.0
    for y, v in ye.items():
        yearly[str(y)] = stats.pct(v / prev - 1)
        prev = float(v)
    return {
        "days": int(eq.size),
        "ann_return": stats.pct(float(eq[-1]) ** (1 / years) - 1),
        "mu_ann": stats.pct(float(r.mean() * 252)),
        "vol_ann": stats.pct(float(r.std(ddof=1) * np.sqrt(252))),
        "mdd": stats.pct(float(dd.min())),
        "current_dd": stats.pct(float(dd[-1])),
        "yearly": yearly,
        "total": stats.pct(float(eq[-1]) - 1),
    }


def month_end_returns(values: np.ndarray, dates: list[str]) -> pd.Series:
    """每月最後一個交易日的值 → 月報酬（第一個月相對起始值）。"""
    s = pd.Series(values, index=pd.to_datetime(dates)).dropna()
    if s.empty:
        return pd.Series(dtype=float)
    me = s.groupby(s.index.to_period("M")).last()
    prev = pd.concat([pd.Series([s.iloc[0]]), me.iloc[:-1].reset_index(drop=True)], ignore_index=True)
    return pd.Series(me.to_numpy() / prev.to_numpy() - 1, index=me.index.astype(str))


def regress(y: np.ndarray, x: np.ndarray) -> dict[str, Any]:
    """v3 M2-3：月報酬 y ＝ α ＋ β x（OLS）。回傳 β、年化 α（月 α × 12）、α 的 t 值、R²、月數。"""
    ok = np.isfinite(y) & np.isfinite(x)
    y, x = y[ok], x[ok]
    n = int(y.size)
    if n < 6:
        return {"months": n}
    X = np.column_stack([np.ones(n), x])
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coef
    s2 = float(resid @ resid) / (n - 2)
    cov = s2 * np.linalg.inv(X.T @ X)
    se_a = float(np.sqrt(cov[0, 0]))
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return {
        "months": n,
        "beta": round(float(coef[1]), 3),
        "alpha_ann": stats.pct(float(coef[0]) * 12),
        "alpha_t": round(float(coef[0]) / se_a, 2) if se_a > 0 else None,
        "r2": round(1 - float(resid @ resid) / ss_tot, 3) if ss_tot > 0 else None,
    }


def drawdown_days(values: np.ndarray) -> int:
    """最長的回撤持續天數（交易日）：從前一個高點之後到重新創高（或資料結束）的最長區間。"""
    v = np.asarray(values, dtype=float)
    peak, run, best = -np.inf, 0, 0
    for x in v:
        if not np.isfinite(x):
            continue
        if x >= peak:
            peak, run = x, 0
        else:
            run += 1
            best = max(best, run)
    return best


def perf(values: np.ndarray, dates: list[str]) -> dict[str, Any]:
    """v3 M2-3 同一組指標（策略與各基準同期）：年化報酬（幾何）、年化波動、Sharpe（無風險利率以 0 計）、
    Calmar（年化報酬 ÷ |最大回撤|）、最大回撤、最長回撤天數、逐年報酬。"""
    v = np.asarray(values, dtype=float)
    ok = np.isfinite(v)
    if ok.sum() < 20:
        return {"days": int(ok.sum())}
    v, d = v[ok], [x for x, k in zip(dates, ok, strict=True) if k]
    r = v[1:] / v[:-1] - 1
    years = v.size / 252
    ann = float(v[-1] / v[0]) ** (1 / years) - 1
    vol = float(r.std(ddof=1) * np.sqrt(252))
    mdd = float((v / np.maximum.accumulate(v) - 1).min())
    s = pd.Series(v, index=pd.to_datetime(d))
    ye = s.groupby(s.index.year).last()
    yearly, prev = {}, float(v[0])
    for y, x in ye.items():
        yearly[str(y)] = stats.pct(float(x) / prev - 1)
        prev = float(x)
    return {
        "days": int(v.size),
        "ann_return": stats.pct(ann),
        "vol_ann": stats.pct(vol),
        "sharpe": round(float(r.mean() * 252) / vol, 2) if vol > 0 else None,
        "calmar": round(ann / abs(mdd), 2) if mdd < 0 else None,
        "mdd": stats.pct(mdd),
        "dd_days": drawdown_days(v),
        "total": stats.pct(float(v[-1] / v[0]) - 1),
        "yearly": yearly,
    }


def bench_compare(eq: np.ndarray, mk: Market, ev: Any, start: int) -> dict[str, Any]:
    """5 檔組合 vs (b) 加權報酬指數、(c) 0050、(d) 00631L 同期：月報酬對 (b) 迴歸，各自的績效指標與逐年報酬。"""
    dates = ev.dates[start:]
    series: dict[str, np.ndarray] = {"tr": mk.bench[start:]}
    for code in ("0050", "00631L"):
        s = (getattr(ev, "etf", {}) or {}).get(code)
        if s is not None:
            series[code] = s["close"][start:]
    out: dict[str, Any] = {"period": [dates[0], dates[-1]] if dates else None, "strategy": perf(eq, dates)}
    for k, v in series.items():
        out[k] = perf(v, dates)
    my = month_end_returns(eq, dates)
    mx = month_end_returns(series["tr"], dates).reindex(my.index)
    out["regression"] = regress(my.to_numpy(dtype=float), mx.to_numpy(dtype=float))
    return out


def basis_values(basis: list[Any], ev: Any, code: str, t: int) -> list[dict[str, Any]]:
    """v3 M5-5 觸發依據：該股在訊號日的各條件數值（名稱、數值、單位）。"""
    i = ev.codes.index(code)
    out = []
    for label, arr, unit, scale, digits in basis:
        v = arr[t, i]
        out.append({"label": label, "value": round(float(v) * scale, digits) if np.isfinite(v) else None, "unit": unit})
    return out


def today_note(item: dict[str, Any], ev: Any, mk: Market, last: int) -> str | None:
    """今日 0 檔時的原因（不留白）：環境條件不符、資料未更新（最新資料日早於預期交易日）、或沒有股票同時符合。"""
    if item.get("today"):
        return None
    env = item.get("env")
    if env and not env.get("today"):
        return f"今日大盤環境不符合（{env.get('label')}），而且今天沒有股票同時符合條件。"
    if item.get("verdict") == verdict.LIMITED:
        return "千張大戶資料只涵蓋部分股票（回補中），今天沒有涵蓋到的股票觸發。"
    return f"{ev.dates[last]} 收盤後沒有股票首次同時符合全部條件（同一檔持續符合不重複計入）。"


def health(row: dict[str, Any], min_recent: int) -> dict[str, Any]:
    """近 60 日（已完成）vs 長期的平均超額（相對同日全市場）。"""
    rec = row.get("recent") or {}
    long_m = row.get("mean_excess")
    rm = rec.get("mean_excess")
    n = int(rec.get("n") or 0)
    if n < min_recent or rm is None:
        status = "資料累積中"
    elif rm < 0 and (long_m or 0) > 0:
        status = "近期轉弱"
    elif long_m and rm < long_m / 2:
        status = "近期低於長期"
    else:
        status = "與長期一致"
    return {
        "status": status,
        "recent": rm,
        "recent_n": n,
        "recent_t": rec.get("t"),
        "since": rec.get("since"),
        "long": long_m,
    }


def build(res: dict[str, Any]) -> dict[str, Any]:
    ctx = res["_ctx"]
    ev, mk, uni, c = ctx["ev"], ctx["mk"], ctx["uni"], ctx["cfg"]
    sc = config.load("strategies")
    rows = {r["id"]: r for r in res["rows"]}
    details = res["details"]
    H = int(sc.get("horizon", c["primary_horizon"]))
    T = len(ev.dates)
    last = T - 1
    env_today = {k: bool(getattr(mk, v)[last]) for k, v in ENV_STATE.items()}
    out: list[dict[str, Any]] = []
    signals: dict[str, dict[str, list[str]]] = {}
    for s in sc["strategies"]:
        row = rows.get(s["test"])
        keep = ctx["tests"].get(s["test"])
        base: dict[str, Any] = {"id": s["id"], "test": s["test"], "label": s["label"], "subtitle": s["subtitle"]}
        if row is None or keep is None:
            out.append({**base, "verdict": verdict.FEW, "enabled": False, "reasons": ["沒有評估結果"]})
            continue
        v = row["verdict"]
        enabled = v in (verdict.VALID, verdict.ENV)
        env = None
        if v == verdict.ENV and isinstance(row.get("reasons"), list):
            env_info = (details.get(s["test"]) or {}).get("env")
            if env_info:
                on = env_today[env_info["dim"]] if env_info["side"] == "on" else not env_today[env_info["dim"]]
                env = {**env_info, "today": on}
        item: dict[str, Any] = {
            **base,
            "verdict": v,
            "enabled": enabled,
            "reasons": row.get("reasons", []),
            "env": env,
            "param": row.get("param"),
            "definition": row.get("definition"),
            "coverage": row.get("coverage"),
            "data_start": row.get("data_start"),
            "signal_start": row.get("signal_start"),
            "signal_end": row.get("signal_end"),
            "h": row.get("h"),
            "years": row.get("years"),
            "env_stats": row.get("env"),
            "t": row.get("t"),
            "t_nw": row.get("t_nw"),
            "mean_excess": row.get("mean_excess"),
            "n": row.get("n"),
            "note": row.get("note"),
            "health": health(row, int(sc["health"]["min_recent"])),
            "bench": row.get("bench"),
            "t_0050": row.get("t_0050"),
            "large_cap": row.get("large_cap"),
            "delist": row.get("delist"),
            "hindsight": row.get("hindsight"),
        }
        mask = keep["mask"]
        today_codes = [ev.codes[i] for i in np.nonzero(mask[last] & uni[last])[0]]
        item["today"] = [
            {
                "code": code,
                "name": ev.names.get(code, code),
                "basis": basis_values(keep.get("basis") or [], ev, code, last),
            }
            for code in today_codes
        ]
        item["today_note"] = today_note(item, ev, mk, last)
        if enabled:
            signals[s["id"]] = {
                ev.dates[t]: [ev.codes[i] for i in np.nonzero(mask[t] & uni[t])[0]]
                for t in range(max(0, T - 250), T)
                if (mask[t] & uni[t]).any()
            }
            item.update(_portfolio(ev, mk, uni, c, sc, keep, details.get(s["test"]) or {}, H))
        out.append(item)
    return {
        "date": ev.dates[last],
        "horizon": H,
        "env_today": env_today,
        "leverage": sc["leverage"],
        "slots": sc["slots"],
        "strategies": out,
        "_signals": signals,
    }


def _portfolio(
    ev: Any,
    mk: Market,
    uni: np.ndarray,
    c: dict[str, Any],
    sc: dict[str, Any],
    keep: dict[str, Any],
    detail: dict[str, Any],
    H: int,
) -> dict[str, Any]:
    """選用的出場規則 → 去重交易統計、MAE 分布、跌停鎖死發生率、K 檔組合的權益統計。"""
    best = best_exit(detail)
    start = str(keep["start"])
    m = keep["mask"] & (np.asarray(ev.dates) >= start)[:, None]
    t, cc = engine.events_from_mask(m, uni)
    cand = engine.evaluate(mk, t, cc, H)
    cand = cand[cand["status"] == "ok"]
    rule, param = (best["rule"], best["param"]) if best else ("fixed", str(H))
    trades = exits.run_one(mk, cand, ev, c, rule, param)
    trades = trades[trades["status"] == "ok"]
    d = engine.dedupe(trades)
    locked_any = np.array(
        [bool(mk.locked[int(e) : int(x) + 1, int(ci)].any()) for e, x, ci in d[["e", "x", "c"]].itertuples(index=False)]
    )
    mae = -d["mae"].to_numpy() * 100
    dd = engine.annotate(d, mk)
    yearly_trades = {
        str(y): {
            "n": len(p),
            "mean_net": stats.pct(float(p["net"].mean())),
            "exc_idx": stats.pct(float(p["exc_idx"].mean())),
            "win": stats.pct(float((p["net"] > 0).mean())),
        }
        for y, p in dd.groupby("year")
    }
    s_row = int(np.searchsorted(np.asarray(ev.dates), start))
    port = {}
    for k in sc["slots"]:
        eq = simulate(mk, trades, ev.value, int(k), max(s_row, 1))
        port[str(k)] = curve_stats(eq, ev.dates[max(s_row, 1) :])
    eq5 = simulate(mk, trades, ev.value, 5, max(s_row, 1))
    weekly = pd.Series(eq5, index=pd.to_datetime(ev.dates[max(s_row, 1) :])).resample("W-FRI").last().dropna()
    bench = (
        pd.Series(mk.bench[max(s_row, 1) :], index=pd.to_datetime(ev.dates[max(s_row, 1) :]))
        .resample("W-FRI")
        .last()
        .dropna()
    )
    s0 = max(s_row, 1)
    compare = bench_compare(eq5, mk, ev, s0)
    etf_w = {}
    for code in ("0050", "00631L"):
        src = (getattr(ev, "etf", {}) or {}).get(code)
        if src is not None:
            w = pd.Series(src["close"][s0:], index=pd.to_datetime(ev.dates[s0:])).resample("W-FRI").last()
            w = w.reindex(weekly.index).ffill()
            base = w.dropna().iloc[0] if w.notna().any() else np.nan
            etf_w[code] = [None if not np.isfinite(x) else round(float(x / base), 4) for x in w.to_numpy()]
    return {
        "compare": compare,
        "exit": {
            "rule": rule,
            "param": param,
            "label": (best or {}).get("label") or f"固定 {H} 日",
            "stats": {k: (best or {}).get(k) for k in ("n", "ev", "exc_idx", "win", "hold", "mae", "locked")},
            "alternatives": [r for r in (detail.get("exits") or {}).get("rules", []) if r.get("chosen")],
        },
        "trades": {
            "n": len(d),
            "mean_net": stats.pct(float(d["net"].mean())) if len(d) else None,
            "win": stats.pct(float((d["net"] > 0).mean())) if len(d) else None,
            "hold": round(float(d["hold"].mean()), 1) if len(d) else None,
            "mae_p50": round(float(np.percentile(mae, 50)), 2) if mae.size else None,
            "mae_p90": round(float(np.percentile(mae, 90)), 2) if mae.size else None,
            "mae_p99": round(float(np.percentile(mae, 99)), 2) if mae.size else None,
            "lock_rate": round(float(locked_any.mean()) * 100, 2) if locked_any.size else None,
            "yearly": yearly_trades,
        },
        "portfolio": port,
        "curve": {
            "dates": [x.date().isoformat() for x in weekly.index],
            "equity": [round(float(v), 4) for v in weekly.to_numpy()],
            "bench": [round(float(v / bench.iloc[0]), 4) for v in bench.reindex(weekly.index).ffill().to_numpy()]
            if len(bench)
            else [],
            # v3 M2：可疊加的基準線（每週、以期初為 1）；前端預設顯示策略與 0050
            "etf": etf_w,
        },
    }
