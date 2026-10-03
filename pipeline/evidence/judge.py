"""判定卡與分級（2026-10-03 改版；config/evidence.yml judge，METHODOLOGY §11.4）。

對策略庫每一套（一般策略與波段策略同一套口徑）以**判定持有期 40 日**重算：

- 判定卡 (b) 訊號檢定：40 日扣成本超額（相對同日等權）、校正後 t、去重樣本數——訊號是否優於同池隨機選股。
- 判定卡 (a) 機會成本：40 日扣成本超額（相對 0050 含息）、校正後 t、超額勝率；5 檔組合 vs 同期 0050 的年化報酬、
  Sharpe、最大回撤——與「持有 0050 不動」相比。
- 分級（預先指定、寫死在 config，不依結果調整）：有效／訊號顯著・未勝 0050／觀察中／無效；樣本不足最高觀察中。
- 5 檔組合：預先指定的排序（同日觸發多於空位時依訊號日成交值由大到小）＋ 200 次隨機排序模擬（固定種子）。
- 出場規則：只用 2021-12-31 以前的訊號選規則，2022 起另列樣本外（exits.compare_split）；不影響分級。
- 組合回測、槓桿風險、逐年表一律用固定 40 日出場（與判定同一個持有期；出場規則比較只是參考）。
- 累積超額曲線：同一組 40 日去重事件，觀察窗 120 日，峰值在窗邊界時標示。
- 健康度：近 60 個交易日（已出場）vs 長期，相對同日等權。
- 多重檢定：已測試的策略 × 變體總數 M 與 t ≥ 3.0 的理由。

t 一律為「校正後 t」（audit.corrected_t：日曆時間法、Newey-West、不重疊區塊取絕對值最小）。
"""

from __future__ import annotations

import logging
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import audit, curve, engine, exits, stats
from pipeline.evidence.engine import Market
from pipeline.evidence.strategies import bench_compare, curve_stats, weekly_bench_lines

log = logging.getLogger(__name__)

VALID, SIG_ONLY, WATCH, INVALID = "valid", "sig_only", "watch", "invalid"
LABELS = {VALID: "有效", SIG_ONLY: "訊號顯著・未勝 0050", WATCH: "觀察中", INVALID: "無效"}
ORDER = {VALID: 0, SIG_ONLY: 1, WATCH: 2, INVALID: 3}
NOTE_FEW = "樣本不足"
NOTE_FORWARD = "待前瞻驗證"

DEFAULTS: dict[str, Any] = {
    "horizon": 40,
    "slots": 5,
    "grade": {"sig_t_min": 3.0, "opp_t_min": 2.0, "watch_t_min": 2.0, "min_years": 3, "min_events": 300},
    "random": {"n": 200, "seed": 20261003},
    "exits_train_end": "2021-12-31",
    "trigger_window": 40,
    "recent_days": 60,
    "max_listed": 15,
    "multi_test": {"swing_trials": 11, "judge_horizons_used": 2},
}

BENCH_TEXT = {
    "ew": (
        "相對同日等權：同一進場日、同一持有期間，股票池內全部可進場股票的平均報酬（基準不扣成本）。"
        "檢定訊號是否優於在同一個股票池隨機選股。"
    ),
    "0050": (
        "相對 0050（含息）：同一期間持有 0050 不動的報酬，代表不做選股的機會成本；"
        "0050 受台積電等少數權值股影響大，權值股領漲的年份選股策略不易勝過。"
    ),
}


def jcfg(c: dict[str, Any]) -> dict[str, Any]:
    j = dict(DEFAULTS)
    user = dict(c.get("judge") or {})
    for k, v in user.items():
        j[k] = {**DEFAULTS[k], **v} if isinstance(DEFAULTS.get(k), dict) and isinstance(v, dict) else v
    return j


# ------------------------------------------------------------------ 組合模擬
class Book:
    """固定出場的交易表 → 同時持有 k 檔的組合（每檔 1/k 權益）逐日權益。規則與 strategies.simulate 相同：
    每天開盤先出場（扣賣出手續費、證交稅、滑價）再進場；同一天的訊號依 keys 由小到大填入空位，滿了當天其餘略過、
    不排隊；已持有的股票不重複進場；每筆投入＝前一日收盤權益 ÷ k（現金不足以剩餘現金為限）；收盤以還原收盤計值。"""

    def __init__(self, mk: Market, trades: pd.DataFrame, value: np.ndarray, start: int):
        T = len(mk.dates)
        e = trades["e"].to_numpy(dtype=np.int64)
        x = trades["x"].to_numpy(dtype=np.int64)
        px = trades["px"].to_numpy(dtype=float)
        entry = trades["entry"].to_numpy(dtype=float)
        keep = (e >= start) & np.isfinite(px) & np.isfinite(entry) & (x < T)
        self.e, self.c, self.x = e[keep], trades["c"].to_numpy(dtype=np.int64)[keep], x[keep]
        self.entry, self.px = entry[keep], px[keep]
        v = np.zeros(self.e.size)
        ok = self.e >= 1
        vv = value[np.maximum(self.e - 1, 0), self.c]
        v[ok & np.isfinite(vv)] = vv[ok & np.isfinite(vv)]
        self.v = v  # 訊號日（進場前一日）成交值
        self.start, self.T = start, T
        self.close = mk.close
        self.fee, self.tax, self.slip = mk.fee, mk.tax, float(getattr(mk, "slip", 0.0))
        self.by_day: dict[int, np.ndarray] = {}
        if self.e.size:
            order = np.argsort(self.e, kind="stable")
            days, first = np.unique(self.e[order], return_index=True)
            bounds = [*first[1:], order.size]
            for d, a, b in zip(days, first, bounds, strict=True):
                self.by_day[int(d)] = order[a:b]

    def spec_keys(self) -> np.ndarray:
        """預先指定的排序：訊號日成交值由大到小；同值依股票索引。回傳每筆交易的排序鍵（越小越先）。"""
        if not self.e.size:
            return np.zeros(0)
        rank = np.empty(self.e.size)
        rank[np.lexsort((self.c, -self.v))] = np.arange(self.e.size)
        return rank

    def run(self, k: int, keys: np.ndarray) -> np.ndarray:
        cash, prev_eq = 1.0, 1.0
        pos: dict[int, list[float]] = {}  # c → [股數, 出場列, 出場價, 最後收盤]
        eq = np.ones(self.T - self.start)
        sell = (1 - self.slip) * (1 - self.fee - self.tax)
        buy = (1 + self.slip) * (1 + self.fee)
        for d in range(self.start, self.T):
            if pos:
                for c in [c for c, p in pos.items() if int(p[1]) == d]:
                    shares, _, px, _ = pos.pop(c)
                    cash += shares * px * sell
            idx = self.by_day.get(d)
            if idx is not None:
                free = k - len(pos)
                for j in idx[np.argsort(keys[idx], kind="stable")]:
                    if free <= 0:
                        break
                    c, x = int(self.c[j]), int(self.x[j])
                    if c in pos or x <= d:
                        continue
                    alloc = min(prev_eq / k, cash)
                    if alloc <= 0:
                        break
                    cash -= alloc
                    pos[c] = [alloc / (self.entry[j] * buy), x, float(self.px[j]), float(self.entry[j])]
                    free -= 1
            value_now = cash
            for c, p in pos.items():
                cl = self.close[d, c]
                if cl == cl:  # 有收盤（非 NaN）
                    p[3] = float(cl)
                value_now += p[0] * p[3]
            eq[d - self.start] = value_now
            prev_eq = value_now
        return eq


def cagr_mdd(eq: np.ndarray) -> tuple[float | None, float | None]:
    """與 strategies.perf 同一個公式：年化＝(末 ÷ 首)^(252 ÷ 天數) − 1；最大回撤＝min(權益 ÷ 累積高點 − 1)。"""
    v = np.asarray(eq, dtype=float)
    v = v[np.isfinite(v)]
    if v.size < 20 or v[0] <= 0:
        return None, None
    ann = float(v[-1] / v[0]) ** (252 / v.size) - 1
    mdd = float((v / np.maximum.accumulate(v) - 1).min())
    return ann, mdd


def max_adverse(eq: np.ndarray, window: int, dates: list[str] | None = None) -> dict[str, Any]:
    """組合層最大不利波動：從任一交易日起 window 個交易日內，權益相對起點的最大跌幅（取全期間最差者，%）。
    與最大回撤（從歷史高點起算、不限期間）互補：這是「持有一個判定持有期」內最壞的帳面損失。"""
    v = np.asarray(eq, dtype=float)
    if v.size < 2:
        return {"value": None, "window": window}
    fmin = pd.Series(v[::-1]).rolling(window + 1, min_periods=1).min().to_numpy()[::-1]
    with np.errstate(invalid="ignore", divide="ignore"):
        r = fmin / v - 1
    i = int(np.nanargmin(r))
    return {
        "value": stats.pct(float(r[i])),
        "window": window,
        "start": dates[i] if dates else None,
    }


def random_selection(book: Book, k: int, n: int, seed: int) -> dict[str, Any]:
    """同一天觸發多於空位時改用隨機順序（每次重抽），其餘規則相同；固定種子可重現。回傳年化與最大回撤的分位數。"""
    rng = np.random.default_rng(seed)
    cg, md = [], []
    for _ in range(n):
        a, m = cagr_mdd(book.run(k, rng.random(book.e.size)))
        if a is not None and m is not None:
            cg.append(a)
            md.append(m)

    def q(xs: list[float]) -> dict[str, float | None]:
        if not xs:
            return {"p5": None, "p50": None, "p95": None}
        p5, p50, p95 = np.percentile(np.asarray(xs), [5, 50, 95])
        return {"p5": stats.pct(float(p5)), "p50": stats.pct(float(p50)), "p95": stats.pct(float(p95))}

    return {"n": n, "runs": len(cg), "seed": seed, "slots": k, "cagr": q(cg), "mdd": q(md)}


# ------------------------------------------------------------------ 判定卡
def judge_card(d: pd.DataFrame, H: int, period_days: int, compare: dict[str, Any], slots: int = 5) -> dict[str, Any]:
    sig = audit.corrected_t(d, H, "exc_mkt", period_days=period_days) if len(d) else {}
    opp = audit.corrected_t(d, H, "exc_0050", period_days=period_days) if len(d) else {}
    x0050 = d["exc_0050"].to_numpy(dtype=float) if len(d) else np.zeros(0)
    fin = np.isfinite(x0050)
    port, bench = compare.get("strategy") or {}, compare.get("0050") or {}

    def parts(ct: dict[str, Any]) -> dict[str, Any]:
        return {"calendar": ct.get("t"), "nw": ct.get("t_nw"), "nw_lag": ct.get("nw_lag"), "block": ct.get("t_block")}

    def p3(p: dict[str, Any]) -> dict[str, Any]:
        return {"cagr": p.get("ann_return"), "sharpe": p.get("sharpe"), "mdd": p.get("mdd"), "vol": p.get("vol_ann")}

    return {
        "horizon": H,
        "t_name": audit.T_CORR_NAME,
        "sig": {
            "bench": "ew",
            "excess": sig.get("mean_excess"),
            "t": sig.get("t_corr"),
            "n": len(d),
            "dates": sig.get("dates", 0),
            "t_parts": parts(sig),
        },
        "opp": {
            "bench": "0050",
            "excess": opp.get("mean_excess"),
            "t": opp.get("t_corr"),
            "win": stats.pct(float((x0050[fin] > 0).mean())) if fin.any() else None,
            "n": int(fin.sum()),
            "t_parts": parts(opp),
            "slots": slots,
            "period": compare.get("period"),
            "port": p3(port),
            "bench_port": p3(bench),
        },
    }


def grade(
    card: dict[str, Any], span_years: float | None, n: int, g: dict[str, Any], forward_ready: bool = False
) -> dict[str, Any]:
    """預先指定的分級（config/evidence.yml judge.grade）：
    有效＝(b) t ≥ 3.0 且 (a) 相對 0050 超額 > 0、t ≥ 2.0、5 檔組合 Sharpe ≥ 同期 0050 Sharpe；
    訊號顯著・未勝 0050＝只有 (b) t ≥ 3.0；觀察中＝2.0 ≤ (b) t < 3.0；其餘無效。
    樣本期間 < 3 年或去重樣本 < 300 筆：最高觀察中，附註「樣本不足」。有效且前瞻驗證未完成：附註「待前瞻驗證」。"""
    sig, opp = card.get("sig") or {}, card.get("opp") or {}
    st, ot = sig.get("t"), opp.get("t")
    ps, bs = (opp.get("port") or {}).get("sharpe"), (opp.get("bench_port") or {}).get("sharpe")
    s_min, o_min, w_min = float(g["sig_t_min"]), float(g["opp_t_min"]), float(g["watch_t_min"])
    checks = {
        "sig_t": st is not None and float(st) >= s_min,
        "opp_excess": opp.get("excess") is not None and float(opp["excess"]) > 0,
        "opp_t": ot is not None and float(ot) >= o_min,
        "sharpe": ps is not None and bs is not None and float(ps) >= float(bs),
    }
    few_years = span_years is None or span_years < float(g["min_years"])
    few_n = n < int(g["min_events"])
    checks["sample"] = not (few_years or few_n)
    if checks["sig_t"] and checks["opp_excess"] and checks["opp_t"] and checks["sharpe"]:
        gid = VALID
    elif checks["sig_t"]:
        gid = SIG_ONLY
    elif st is not None and float(st) >= w_min:
        gid = WATCH
    else:
        gid = INVALID
    notes: list[str] = []
    if not checks["sample"]:
        notes.append(NOTE_FEW)
        if gid in (VALID, SIG_ONLY):
            gid = WATCH
    if gid == VALID and not forward_ready:
        notes.append(NOTE_FORWARD)

    def tt(v: Any) -> str:
        return "—" if v is None else audit._f(v, 2, False)

    def pc(v: Any) -> str:
        return "—" if v is None else audit._f(v, 2, True) + "%"

    labels = {
        "sig_t": f"訊號檢定 t {tt(st)}（門檻 ≥ {s_min:g}）",
        "opp_excess": f"相對 0050 超額 {pc(opp.get('excess'))}（門檻 > 0）",
        "opp_t": f"相對 0050 t {tt(ot)}（門檻 ≥ {o_min:g}）",
        "sharpe": f"5 檔組合 Sharpe {ps if ps is not None else '—'} vs 0050 {bs if bs is not None else '—'}（門檻 ≥ 0050）",
        "sample": (
            f"樣本 {span_years if span_years is not None else '—'} 年、{n} 筆"
            f"（門檻 ≥ {g['min_years']} 年且 ≥ {g['min_events']} 筆）"
        ),
    }
    return {
        "id": gid,
        "label": LABELS[gid],
        "notes": notes,
        "checks": checks,
        "reasons": [labels[k] for k, ok in checks.items() if not ok],
        "rule": grade_rule_text(g),
    }


def grade_rule_text(g: dict[str, Any]) -> str:
    return (
        f"有效＝訊號檢定 t ≥ {g['sig_t_min']:g}，且相對 0050 超額 > 0、t ≥ {g['opp_t_min']:g}、5 檔組合 Sharpe ≥ 同期 0050；"
        f"訊號顯著・未勝 0050＝只有訊號檢定 t ≥ {g['sig_t_min']:g}；觀察中＝{g['watch_t_min']:g} ≤ 訊號檢定 t < {g['sig_t_min']:g}；"
        f"其餘無效。樣本期間 < {g['min_years']} 年或去重樣本 < {g['min_events']} 筆最高觀察中（附註樣本不足）。"
        "門檻在評估前寫死，不依結果調整。"
    )


# ------------------------------------------------------------------ 其他區塊
def yearly_table(port: dict[str, Any], bench: dict[str, Any]) -> list[dict[str, Any]]:
    """逐年：5 檔組合｜0050｜差額（百分點）；第一年與最後一年為部分年度（自訊號起點、至資料最後一天）。"""
    py, by = port.get("yearly") or {}, bench.get("yearly") or {}
    out = []
    for y in sorted(set(py) | set(by)):
        p, b = py.get(y), by.get(y)
        out.append({"year": y, "port": p, "bench": b, "diff": None if p is None or b is None else round(p - b, 3)})
    return out


def event_yearly(d: pd.DataFrame, c: dict[str, Any]) -> list[dict[str, Any]]:
    """事件研究區的逐年訊號超額（相對同日等權、扣成本，日曆時間法平均）。"""
    out = []
    for y, part in d.groupby("year"):
        b = stats.brief(part, c)
        out.append({"year": str(y), "excess": b.get("mean_excess"), "n": b.get("n", 0)})
    return out


def trade_stats(trades: pd.DataFrame, mk: Market) -> dict[str, Any]:
    d = engine.dedupe(trades)
    if d.empty:
        return {"n": 0}
    locked_any = np.array(
        [bool(mk.locked[int(e) : int(x) + 1, int(ci)].any()) for e, x, ci in d[["e", "x", "c"]].itertuples(index=False)]
    )
    mae = -d["mae"].to_numpy() * 100
    dd = engine.annotate(d, mk)
    return {
        "n": len(d),
        "mean_net": stats.pct(float(d["net"].mean())),
        "win": stats.pct(float((d["net"] > 0).mean())),
        "hold": round(float(d["hold"].mean()), 1),
        "mae_p50": round(float(np.percentile(mae, 50)), 2),
        "mae_p90": round(float(np.percentile(mae, 90)), 2),
        "mae_p99": round(float(np.percentile(mae, 99)), 2),
        "lock_rate": round(float(locked_any.mean()) * 100, 2) if locked_any.size else None,
        "yearly": {
            str(y): {
                "n": len(p),
                "mean_net": stats.pct(float(p["net"].mean())),
                "exc_idx": stats.pct(float(p["exc_idx"].mean())),
                "win": stats.pct(float((p["net"] > 0).mean())),
            }
            for y, p in dd.groupby("year")
        },
    }


def universe_text(u: dict[str, Any]) -> str:
    return (
        "上市櫃普通股（4 碼、非 0 開頭；排除 ETF、ETN、存託憑證、受益證券）；訊號日需同時符合："
        f"上市櫃滿 {u.get('min_listed_days', 120)} 個交易日、{u.get('avg_value_days', 20)} 日平均成交值 ≥ "
        f"{float(u.get('min_avg_value', 5e7)) / 1e4:,.0f} 萬元、收盤價（未還原）≥ {u.get('min_close', 10)} 元、"
        "不在處置期間、不是全額交割或管理股票。股票池逐日以當時的行情建立，含期間內下市的股票（下市以最後收盤出場）。"
    )


def sample_global(ev: Any, uni: np.ndarray, c: dict[str, Any]) -> dict[str, Any]:
    """實際查證股票池是否含下市股票：期間內曾進入股票池、但資料最後一個月已沒有收盤價的檔數，與其中名列官方終止上市櫃者。"""
    rows = np.asarray(ev.dates) >= str(c["price_start"])
    ever = uni[rows].any(axis=0)
    tail = max(0, len(ev.dates) - 21)
    alive = np.isfinite(ev.raw_close[tail:]).any(axis=0)
    dd = getattr(ev, "delist_date", {}) or {}
    stopped = ever & ~alive
    official = int(sum(1 for i in np.nonzero(ever)[0] if ev.codes[i] in dd))
    return {
        "includes_delisted": bool(stopped.any() or official > 0),
        "universe_stocks": int(ever.sum()),
        "stopped_stocks": int(stopped.sum()),
        "official_delisted": official,
        "universe_text": universe_text(c.get("universe") or {}),
        "revenue_timing": (
            "月營收生效日＝次月 10 日（法定公布期限；歷史資料沒有各公司實際公布日）。訊號日＝生效日當天或之後第一個交易日"
            "（10 日遇休市順延，與期限遇假日順延到次一上班日一致；不會提早到 10 日之前），進場＝訊號日的下一個交易日開盤。"
        ),
    }


def recent_triggers(
    mask: np.ndarray, uni: np.ndarray, dates: list[str], codes: list[str], window: int
) -> dict[str, str]:
    """近 window 個交易日內（含今天）條件成立的股票 → 最近一次成立日（個股頁「策略訊號」用）。"""
    T = len(dates)
    out: dict[str, str] = {}
    m = mask & uni
    for t in range(max(0, T - window), T):
        for i in np.nonzero(m[t])[0]:
            out[codes[i]] = dates[t]
    return out


def multi_test(tests: list[Any], j: dict[str, Any]) -> dict[str, Any]:
    """已測試的策略 × 變體總數 M＝(指標的主結果＋變體＋參數格 ＋ 波段策略嘗試次數) × 用過的判定持有期數。"""
    mt = j["multi_test"]
    ind = audit.hypotheses(tests)
    sw = int(mt.get("swing_trials", 0))
    hz = max(1, int(mt.get("judge_horizons_used", 1)))
    M = (ind + sw) * hz
    t_min = float(j["grade"]["sig_t_min"])
    p3 = 2 * (1 - NormalDist().cdf(t_min))
    p2 = 2 * (1 - NormalDist().cdf(2.0))
    bonf = audit.bonferroni_t(M)
    reason = (
        f"已測試 {M} 個策略 × 變體（指標 {ind} 個：主結果、變體與參數格；波段策略嘗試 {sw} 次；判定持有期先後用過 "
        f"{hz} 種，乘 {hz}）。以 t ≥ 2 為門檻（雙尾 p ≈ {p2 * 100:.1f}%）時，即使全部無效也預期約 {M * p2:.0f} 個偶然達標；"
        f"t ≥ {t_min:g} 對應雙尾 p ≈ {p3 * 100:.2f}%，預期偶然達標約 {M * p3:.1f} 個。"
        f"Bonferroni 校正（5%、假設 {M} 個檢定彼此獨立）的門檻為 t ≥ {bonf}；這些變體高度相關，獨立假設偏保守。"
        f"t ≥ {t_min:g} 也是 Harvey、Liu、Zhu（2016）對新因子建議的門檻。"
    )
    return {
        "M": M,
        "parts": {"indicators": ind, "swing_trials": sw, "horizons": hz},
        "t_min": t_min,
        "p_two_sided": round(p3, 5),
        "expected_false_t2": round(M * p2, 1),
        "expected_false": round(M * p3, 2),
        "bonferroni_t": bonf,
        "reason": reason,
    }


# ------------------------------------------------------------------ 主流程
def evaluate_one(
    ctx: dict[str, Any], mask: np.ndarray, start: str, j: dict[str, Any], *, with_random: bool = True
) -> dict[str, Any]:
    """一套策略（訊號遮罩＋訊號起點）→ 判定卡、組合、隨機模擬、出場、曲線、逐年、健康度、槓桿、今日觸發。"""
    ev, mk, uni, c = ctx["ev"], ctx["mk"], ctx["uni"], ctx["cfg"]
    H = int(j["horizon"])
    dates = np.asarray(ev.dates)
    T = len(ev.dates)
    m = mask & (dates >= start)[:, None]
    t, cc = engine.events_from_mask(m, uni)
    raw = engine.annotate(engine.evaluate(mk, t, cc, H), mk)
    cand = raw[raw["status"] == "ok"]
    d = engine.dedupe(raw)
    pdays = int((dates >= start).sum())
    s0 = max(1, int(np.searchsorted(dates, start)))
    out: dict[str, Any] = {"n": len(d)}
    if cand.empty:
        out["card"] = judge_card(d, H, pdays, {})
        return out
    trades = exits.run_one(mk, cand, ev, c, "fixed", str(H))
    trades = trades[trades["status"] == "ok"]
    book = Book(mk, trades, ev.value, s0)
    spec = book.spec_keys()
    k5 = int(j["slots"])
    eq5 = book.run(k5, spec)
    compare = bench_compare(eq5, mk, ev, s0)
    out["compare"] = compare
    out["card"] = judge_card(d, H, pdays, compare, k5)
    sdates = ev.dates[s0:]
    win = int(j["horizon"])
    portfolio: dict[str, Any] = {}
    lev: dict[str, Any] = {}
    for k in ctx.get("slots") or [1, 3, 5, 10]:
        eqk = eq5 if int(k) == k5 else book.run(int(k), spec)
        cs = curve_stats(eqk, sdates)
        ma = max_adverse(eqk, win, sdates)
        cs["max_adverse"] = ma["value"]
        portfolio[str(k)] = cs
        lev[str(k)] = {"port_mdd": cs.get("mdd"), "port_max_adverse": ma["value"], "max_adverse_start": ma["start"]}
    out["portfolio"] = portfolio
    out["leverage"] = {
        "slots": k5,
        "window": win,
        "port_mdd": lev[str(k5)]["port_mdd"] if str(k5) in lev else None,
        "port_max_adverse": lev[str(k5)]["port_max_adverse"] if str(k5) in lev else None,
        "by_slots": lev,
    }
    rnd = j["random"]
    out["random"] = (
        random_selection(book, k5, int(rnd["n"]), int(rnd["seed"])) if with_random else {"n": 0, "skipped": True}
    )
    weekly = pd.Series(eq5, index=pd.to_datetime(sdates)).resample("W-FRI").last().dropna()
    wd = [x.date().isoformat() for x in weekly.index]
    out["equity"] = {
        "dates": wd,
        "equity": [round(float(v), 4) for v in weekly.to_numpy()],
        "slots": k5,
        **weekly_bench_lines(mk, ev, wd),
    }
    out["trades"] = trade_stats(trades, mk)
    out["exit_stats"] = exits.summarize_rule(trades)
    # 出場規則：只用 train_end 以前的訊號選；峰值日出場的 N＝樣本內累積超額曲線的峰值（不超過出場上限）
    train_end = str(j["exits_train_end"])
    tr = d[d["date"] <= train_end]
    peak = None
    if len(tr):
        tc = curve.curve(mk, tr, int(c["exits"]["max_days"]), 0, 0)
        peak = (tc.get("ew") or {}).get("peak")
    out["exits"] = exits.compare_split(
        mk,
        cand,
        ev,
        c,
        train_end,
        peak=peak,
        min_events=int(c["verdict"]["wf_min_events"]),
        fallback=("fixed", str(H)),
    )
    if peak:
        out["exits"]["peak_train"] = {"day": peak, "train_end": train_end}
    cv = c.get("curve") or {}
    out["curve_detail"] = curve.curve(
        mk, d, int(cv.get("days", 120)), int(c["stats"]["bootstrap"]), int(c["stats"]["seed"])
    )
    out["yearly"] = yearly_table(compare.get("strategy") or {}, compare.get("0050") or {})
    out["event_yearly"] = event_yearly(d, c)
    cut = max(0, T - 1 - H - int(j["recent_days"]))
    rec = stats.brief(d[d["t"] >= cut], c)
    out["health"] = {
        "recent60": {"excess": rec.get("mean_excess"), "n": int(rec.get("n") or 0), "since": ev.dates[cut]},
        "long": {"excess": out["card"]["sig"]["excess"]},
    }
    out["delisted_events"] = int(d["delisted"].sum()) if "delisted" in d.columns else 0
    out["delisted_stocks"] = int(
        sum(1 for i in np.unique(d["c"].to_numpy()) if ev.codes[int(i)] in (getattr(ev, "delist_date", {}) or {}))
    )
    out["triggers"] = recent_triggers(mask, uni, ev.dates, ev.codes, int(j["trigger_window"]))
    out["span_years"] = round((pd.Timestamp(ev.dates[-1]) - pd.Timestamp(start)).days / 365.25, 2)
    return out


def curve_brief(cd: dict[str, Any] | None) -> dict[str, Any]:
    """strategies.json 用的累積超額曲線摘要（完整序列在 evidence/{id}.json 的 curve）。"""
    if not cd or not cd.get("n"):
        return {"days": None, "n": 0}
    out: dict[str, Any] = {"days": cd.get("days"), "n": cd.get("n")}
    for key in ("ew", "0050"):
        b = cd.get(key) or {}
        if not b:
            continue
        pk = b.get("peak")
        mean = b.get("mean") or []
        out[key] = {
            "peak": pk,
            "peak_value": mean[pk - 1] if pk else None,
            "peak_at_edge": bool(b.get("peak_at_edge")),
            "at40": mean[39] if len(mean) >= 40 else None,
            "at120": mean[119] if len(mean) >= 120 else None,
        }
    out["peak_at_edge"] = any(bool((out.get(k) or {}).get("peak_at_edge")) for k in ("ew", "0050"))
    return out


def selection_rule_text(j: dict[str, Any]) -> str:
    return (
        f"每天開盤先處理到期出場，再依序進場；同一天觸發的股票多於空位時，依訊號日成交值由大到小填入，{j['slots']} 檔滿了"
        "當天其餘訊號略過、不排隊；已持有的股票不重複進場；每檔投入前一日權益的 "
        f"1/{j['slots']}。固定持有 {j['horizon']} 個交易日、開盤出場（跌停鎖死或停牌順延到下一個可成交日）；"
        "成本：手續費 0.1425%、證交稅 0.3%、滑價 0.1%（買賣各一次）。排序規則在回測前指定，不依結果挑選。"
    )


def annotate(
    lib: dict[str, Any], res: dict[str, Any], swing_masks: dict[str, tuple[np.ndarray, str]]
) -> dict[str, Any]:
    """對 strategies.json 每一套寫入 judge、grade、curve（摘要）、exits、selection、yearly、sample、health、leverage，
    並依新分級決定 enabled、grade_label、rank；回傳 evidence 細節檔要更新的曲線與今日觸發（不寫入 strategies.json）。"""
    ctx = res["_ctx"]
    ev, c = ctx["ev"], ctx["cfg"]
    j = jcfg(c)
    ctx = {**ctx, "slots": lib.get("slots") or [1, 3, 5, 10]}
    g = j["grade"]
    sample = sample_global(ev, ctx["uni"], c)
    curves: dict[str, Any] = {}
    triggers: dict[str, dict[str, str]] = {}
    results: dict[str, dict[str, Any]] = {}
    for s in lib["strategies"]:
        sid = s["id"]
        if s.get("kind") == "swing":
            mm = swing_masks.get(sid)
        else:
            keep = ctx["tests"].get(s.get("test"))
            mm = (keep["mask"], str(keep["start"])) if keep else None
        if mm is None:
            continue
        try:
            r = evaluate_one(ctx, mm[0], mm[1], j)
        except Exception:  # 單一策略失敗不影響其他策略；分級記為無效並註明
            log.exception("判定卡 %s 計算失敗", sid)
            continue
        results[sid] = r
        log.info(
            "判定卡 %s：等權 %s%%（t %s）、0050 %s%%（t %s）、n=%s",
            sid,
            r["card"]["sig"]["excess"],
            r["card"]["sig"]["t"],
            r["card"]["opp"]["excess"],
            r["card"]["opp"]["t"],
            r["n"],
        )
    counts = {k: 0 for k in LABELS}
    for s in lib["strategies"]:
        sid = s["id"]
        got = results.get(sid)
        if got is None:
            s["grade"] = {
                "id": INVALID,
                "label": LABELS[INVALID],
                "notes": ["沒有評估結果"],
                "checks": {},
                "reasons": [],
            }
            s["grade_label"], s["grade_reason"], s["enabled"], s["rank"] = LABELS[INVALID], "沒有評估結果", False, None
            counts[INVALID] += 1
            continue
        r = got
        fwd = s.get("forward") or {}
        gr = grade(
            r["card"], r.get("span_years"), int(r["n"]), g, bool(fwd.get("ready")) and _pos(fwd.get("mean_excess"))
        )
        if s.get("limited"):
            cov = (s.get("coverage") or {}).get("ratio")
            gr["notes"].append(f"涵蓋率 {float(cov) * 100:.0f}%" if cov is not None else "涵蓋不足")
        s["grade"] = gr
        s["judge"] = r["card"]
        s["curve"] = {**r.get("equity", {}), "excess": curve_brief(r.get("curve_detail"))}
        s["exits"] = r.get("exits")
        s["selection"] = {
            **(s.get("selection") or {}),
            "rule_text": selection_rule_text(j),
            "random": r.get("random"),
            "spec": {
                "cagr": (r["card"]["opp"]["port"] or {}).get("cagr"),
                "mdd": (r["card"]["opp"]["port"] or {}).get("mdd"),
            },
        }
        s["yearly"] = r.get("yearly", [])
        s["event"] = {"horizon": int(j["horizon"]), "yearly": r.get("event_yearly", [])}
        s["sample"] = {
            "includes_delisted": sample["includes_delisted"],
            "universe_text": sample["universe_text"],
            "delisted_stocks": r.get("delisted_stocks", 0),
            "delisted_events": r.get("delisted_events", 0),
        }
        s["health"] = {**(s.get("health") or {}), **r["health"]}
        s["leverage"] = r.get("leverage")
        # 舊欄位（前端第二階段前仍在用）：組合、交易統計、出場規則改為與判定同一個固定 40 日
        for k in ("compare", "portfolio", "trades"):
            if k in r:
                s[k] = r[k]
        es = r.get("exit_stats") or {}
        s["exit"] = {
            "rule": "fixed",
            "param": str(j["horizon"]),
            "label": f"固定 {j['horizon']} 日",
            "stats": {k: es.get(k) for k in ("n", "ev", "exc_idx", "win", "hold", "mae", "locked")},
            "alternatives": [],
        }
        s["t_corr"] = r["card"]["sig"]["t"]
        s.setdefault("excess_h", {})[str(j["horizon"])] = r["card"]["sig"]["excess"]
        curves[s.get("test") or sid] = r.get("curve_detail")
        triggers[sid] = r.get("triggers") or {}
    # 名額：非無效最多 max_listed 套（依分級、訊號檢定 t）；排名只排上架且非資料不足者
    alive = sorted(
        (s for s in lib["strategies"] if isinstance(s.get("grade"), dict) and s["grade"]["id"] != INVALID),
        key=lambda s: (ORDER[s["grade"]["id"]], -(s["judge"]["sig"]["t"] or -99)),
    )
    cap = int(j["max_listed"])
    over = {s["id"] for s in alive[cap:]}
    rank_i = 0
    for s in alive:
        registered = bool(s.get("registered", True))
        s["enabled"] = registered and s["id"] not in over
        if s["id"] in over:
            s["grade"]["notes"].append(f"超過 {cap} 套上限")
        if s["enabled"] and not s.get("limited"):
            rank_i += 1
            s["rank"] = rank_i
        else:
            s["rank"] = None
    for s in lib["strategies"]:
        gr = s.get("grade")
        if not isinstance(gr, dict):
            continue
        counts[gr["id"]] += 1
        if gr["id"] == INVALID:
            s["enabled"], s["rank"] = False, None
        s["grade_label"] = gr["label"]
        reason = ("未達：" + "；".join(gr["reasons"])) if gr["reasons"] else ""
        if not s.get("registered", True):
            reason = ("註冊清單停用" + ("；" + reason if reason else "")).strip()
        s["grade_reason"] = reason
    lib["multi_test"] = multi_test(ctx.get("catalog") or [], j)
    lib["judge_meta"] = {
        "horizon": int(j["horizon"]),
        "slots": int(j["slots"]),
        "t_name": audit.T_CORR_NAME,
        "t_text": audit.T_CORR_TEXT,
        "bench_text": BENCH_TEXT,
        "grade_rule": grade_rule_text(g),
        "grade_cfg": g,
        "labels": LABELS,
        "selection_rule": selection_rule_text(j),
        "random": j["random"],
        "exits_train_end": str(j["exits_train_end"]),
        "exit_note": (
            f"分級、組合回測、逐年表與槓桿風險一律用固定 {j['horizon']} 日出場（與判定同一個持有期）；"
            f"出場規則比較（最長持有 {c['exits']['max_days']} 日）以 {str(j['exits_train_end'])[:4]} 年底前的訊號選規則、"
            f"之後另列樣本外，只供參考、不影響分級。"
        ),
        "trigger_window": int(j["trigger_window"]),
        "sample": sample,
        "counts": counts,
    }
    log.info("新分級：%s", "、".join(f"{LABELS[k]} {v}" for k, v in counts.items()))
    return {"curves": curves, "triggers": triggers, "window": int(j["trigger_window"])}


def _pos(v: Any) -> bool:
    return v is not None and float(v) > 0
