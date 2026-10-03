"""審查 2026-10-01（AUDIT.md 第 6～12 項）：校正後 t、多重檢定、訊號相關矩陣、分組穩定性、流動性、每月觸發數。

新增檔案，不改評估引擎的判定；由 `python -m pipeline audit --data-dir data --out <dir>` 執行，
輸出 audit.json（精簡清單用）與 AUDIT 表格（Markdown）。所有數字都用修正後的引擎（成本、基準）重算。

- **校正後 t**（第 6 項）：日曆時間法已把同一進場日的多檔平均成一個觀測（處理同日相關）；持有 N 日的相鄰日期仍重疊，
  所以另算 (a) Newey-West t（落後＝N）與 (b) 不重疊區塊 t（把日曆時間序列依進場列每 N 日切成一個區塊、區塊平均後算 t）。
  校正後 t＝min(a, b)（取較保守者）。
- **多重檢定**（第 7 項）：已測的假說數 N＝總表項目＋變體＋參數格；Bonferroni 5%（雙尾）對應的 t 門檻＝Φ⁻¹(1 − 0.025/N)。
- **相關矩陣**（第 8 項）：每個訊號的「每日持倉超額」序列（當天所有持有中事件的日報酬平均 − 同日等權指數日報酬），
  兩兩在共同有持倉的日子算 Pearson 相關（至少 120 個交易日）。
- **分組穩定性**（第 11 項）：逐年、大盤 240 日線上／下、大小型股（訊號日 20 日平均成交值在 universe 內的三分位）、上市／上櫃。
- **流動性**（第 12 項）：訊號日 20 日平均成交值 < 5,000 萬／5,000 萬～1 億／≥ 1 億 三組。
- **每月觸發數**：去重事件數 ÷ 訊號期間月數。
"""

from __future__ import annotations

import logging
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import engine, stats, verdict
from pipeline.evidence.run import EventRunner

log = logging.getLogger(__name__)

LIQ_EDGES = (5e7, 1e8)  # 5,000 萬、1 億


def block_t(cal: pd.Series, h: int) -> tuple[float | None, int]:
    """不重疊區塊 t：日曆時間序列（index＝進場列）依進場列 // h 分塊、每塊取平均，再算 t。"""
    if cal.empty:
        return None, 0
    blocks = cal.groupby(cal.index.to_numpy() // max(h, 1)).mean().to_numpy()
    _, _, t = stats.mean_t(blocks)
    return (None if t is None else round(float(t), 2)), int(blocks.size)


def concentration(df: pd.DataFrame, period_days: int | None) -> dict[str, Any]:
    """進場日集中程度：不重複進場日數、佔訊號期間交易日的比例、最集中的 5% 進場日承載的事件比例。"""
    if df.empty:
        return {"dates": 0, "ratio": None, "top5pct_share": None}
    counts = df.groupby("e").size().sort_values(ascending=False)
    k = max(1, int(np.ceil(len(counts) * 0.05)))
    return {
        "dates": len(counts),
        "ratio": None if not period_days else round(float(len(counts) / period_days), 4),
        "top5pct_share": round(float(counts.iloc[:k].sum() / counts.sum()), 4),
    }


T_CORR_NAME = "校正後 t"
T_CORR_METHOD = "min(日曆, NW, 區塊)"
T_CORR_TEXT = (
    "校正後 t＝日曆時間法 t、Newey-West t、不重疊區塊 t 三者中絕對值最小者（保留正負號）。"
    "日曆時間法：同一進場日的事件先平均成一個觀測；Newey-West：落後期數＝一個持有期內平均的進場日數"
    "（每天都有進場時＝持有日數）；不重疊區塊：依進場日每「持有日數」個交易日切一塊、區塊平均後算 t。"
)


def nw_lag(h: int, dates: int, period_days: int | None) -> int:
    """Newey-West 落後期數（觀測單位）：一個持有期（h 個交易日）內平均有幾個進場日＝ceil(h × 進場日數 ÷ 期間交易日數)，
    介於 1 與 h 之間；period_days 未知時＝h（視為每天都有進場）。日曆時間序列的相鄰觀測相隔不一定是 1 個交易日，
    落後期數要換算成「重疊的觀測數」，否則每月進場一次的策略會被過度校正（落後 40 個觀測＝40 個月）。"""
    if not period_days or dates <= 0:
        return max(1, int(h))
    return int(min(max(1, int(h)), max(1, int(np.ceil(h * dates / period_days)))))


def corrected_t(
    df: pd.DataFrame, h: int, col: str = "exc_mkt", period_days: int | None = None, ratio: float | None = None
) -> dict[str, Any]:
    """校正後 t（2026-10-03 全站統一，config/evidence.yml t_corr；ratio 參數保留相容、不再使用）：
    日曆時間法、Newey-West（落後＝nw_lag）、不重疊區塊三者中**絕對值最小**者（保留正負號）：正的 t 取最小、負的 t
    取最接近 0 的，兩個方向都不高估顯著性；不取最大值。舊版「集中進場只用日曆時間法」的例外取消（同一個名稱只有一種定義）。
    進場日集中程度（concentration）照常輸出供參考。"""
    cal = stats.calendar_series(df, col)
    x = cal.to_numpy()
    m, _, t = stats.mean_t(x)
    lag = nw_lag(h, int(x.size), period_days)
    nw = stats.newey_west_t(x, lag)
    bt, nb = block_t(cal, h)
    conc = concentration(df, period_days)
    cands = [float(v) for v in (t, nw, bt) if v is not None]
    tc = min(cands, key=abs) if cands else None
    return {
        "mean_excess": stats.pct(m),
        "t": None if t is None else round(float(t), 2),
        "t_nw": None if nw is None else round(float(nw), 2),
        "nw_lag": lag,
        "t_block": bt,
        "blocks": nb,
        "dates": int(x.size),
        "t_corr": None if tc is None else round(float(tc), 2),
        "t_corr_method": T_CORR_METHOD,
        "concentration": conc,
    }


def hypotheses(tests: list[Any]) -> int:
    """已測的假說數：每個項目的主結果＋變體（不含 main）＋參數格。"""
    n = 0
    for t in tests:
        n += 1
        n += max(0, len(t.variants) - 1)
        n += len(t.grid)
    return n


def bonferroni_t(n: int, alpha: float = 0.05) -> float:
    return round(NormalDist().inv_cdf(1 - alpha / 2 / max(n, 1)), 2)


def bonferroni_p(t: float | None, n: int) -> float | None:
    if t is None:
        return None
    p = 2 * (1 - NormalDist().cdf(abs(float(t))))
    return round(min(1.0, p * max(n, 1)), 4)


def daily_series(mk: engine.Market, d: pd.DataFrame) -> pd.Series:
    """每日持倉超額：當天所有持有中事件（進場列 e 到出場列 x）的收盤日報酬平均 − 同日等權指數日報酬。"""
    T = len(mk.dates)
    ff = pd.DataFrame(mk.close).ffill().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        r = np.vstack([np.full((1, ff.shape[1]), np.nan), ff[1:] / ff[:-1] - 1])
        ewr = np.concatenate([[np.nan], mk.ew_level[1:] / mk.ew_level[:-1] - 1])
    s = np.zeros(T)
    n = np.zeros(T)
    for e, x, c in d[["e", "x", "c"]].itertuples(index=False):
        a, b = int(e) + 1, min(int(x), T - 1)
        if b < a:
            continue
        seg = r[a : b + 1, int(c)]
        ok = np.isfinite(seg)
        s[a : b + 1] += np.where(ok, seg, 0.0)
        n[a : b + 1] += ok
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(n > 0, s / np.maximum(n, 1) - ewr, np.nan)
    return pd.Series(out)


def correlation(series: dict[str, pd.Series], min_days: int = 120) -> dict[str, Any]:
    ids = list(series)
    mat: dict[str, dict[str, float | None]] = {}
    pairs: list[dict[str, Any]] = []
    for i, a in enumerate(ids):
        mat[a] = {}
        for b in ids:
            both = pd.concat([series[a], series[b]], axis=1).dropna()
            if a == b:
                mat[a][b] = 1.0
                continue
            if len(both) < min_days:
                mat[a][b] = None
                continue
            v = float(np.corrcoef(both.iloc[:, 0], both.iloc[:, 1])[0, 1])
            mat[a][b] = round(v, 3)
            if ids.index(b) > i:
                pairs.append({"a": a, "b": b, "corr": round(v, 3), "days": len(both)})
    pairs.sort(key=lambda p: -abs(float(p["corr"])))
    return {"ids": ids, "matrix": mat, "pairs": pairs}


def _value20(ev: Any) -> np.ndarray:
    return pd.DataFrame(np.nan_to_num(ev.value, nan=0.0)).rolling(20, min_periods=20).mean().to_numpy()


def size_labels(ev: Any, uni: np.ndarray, v20: np.ndarray) -> np.ndarray:
    """(T, C) 0＝小型、1＝中型、2＝大型：訊號日 20 日平均成交值在當日 universe 內的三分位。"""
    v = np.where(uni & np.isfinite(v20), v20, np.nan)
    q1 = np.nanpercentile(v, 100 / 3, axis=1) if v.shape[1] else np.array([])
    q2 = np.nanpercentile(v, 200 / 3, axis=1)
    lab = np.full(v20.shape, -1, dtype=np.int8)
    lab[v20 < q1[:, None]] = 0
    lab[(v20 >= q1[:, None]) & (v20 < q2[:, None])] = 1
    lab[v20 >= q2[:, None]] = 2
    return lab


def splits(d: pd.DataFrame, ev: Any, cfg: dict[str, Any], lab: np.ndarray, v20: np.ndarray) -> dict[str, Any]:
    t, c = d["t"].to_numpy(), d["c"].to_numpy()
    out: dict[str, Any] = {}
    size = lab[t, c]
    out["size"] = {
        k: stats.brief(d[size == i], cfg) for i, k in enumerate(("小型（成交值後 1/3）", "中型", "大型（前 1/3）"))
    }
    mk_ = np.array([ev.markets.get(ev.codes[i], "") for i in c])
    out["market"] = {"上市": stats.brief(d[mk_ == "twse"], cfg), "上櫃": stats.brief(d[mk_ == "tpex"], cfg)}
    val = v20[t, c]
    out["liquidity"] = {
        "< 5,000 萬": stats.brief(d[val < LIQ_EDGES[0]], cfg),
        "5,000 萬～1 億": stats.brief(d[(val >= LIQ_EDGES[0]) & (val < LIQ_EDGES[1])], cfg),
        "≥ 1 億": stats.brief(d[val >= LIQ_EDGES[1]], cfg),
    }
    out["regime"] = {"年線上": stats.brief(d[d["regime_up"]], cfg), "年線下": stats.brief(d[~d["regime_up"]], cfg)}
    out["years"] = {str(y): stats.brief(part, cfg) for y, part in d.groupby("year")}
    return out


def per_month(d: pd.DataFrame, start: str, end: str) -> tuple[float, int]:
    months = max(1, (pd.Period(end[:7], "M") - pd.Period(start[:7], "M")).n + 1)
    return round(len(d) / months, 1), months


def run(res: dict[str, Any], *, only: list[str] | None = None, min_days: int = 120) -> dict[str, Any]:
    """對 evaluate() 的結果做審查統計（事件型指標的主結果、判定用持有天數）。"""
    ctx = res["_ctx"]
    ev, mk, uni, c = ctx["ev"], ctx["mk"], ctx["uni"], ctx["cfg"]
    H = int(c["primary_horizon"])
    r = EventRunner(ev, mk, uni, c)
    v20 = _value20(ev)
    lab = size_labels(ev, uni, v20)
    rows_by_id = {row["id"]: row for row in res["rows"]}
    n_hyp = hypotheses(ctx["catalog"]) if ctx.get("catalog") else len(res["rows"])
    t_bonf = bonferroni_t(n_hyp)
    out: dict[str, Any] = {
        "hypotheses": n_hyp,
        "t_bonferroni_5pct": t_bonf,
        "horizon": H,
        "tests": {},
        "costs": {"fee": mk.fee, "tax": mk.tax, "slippage": mk.slip, "benchmark_net_of_costs": mk.bench_costs},
    }
    series: dict[str, pd.Series] = {}
    for tid, keep in ctx["tests"].items():
        if only and tid not in only:
            continue
        row = rows_by_id.get(tid) or {}
        if row.get("kind") != "event":
            continue
        start = str(keep["start"])
        fr = r.frames(keep["mask"], start, [H])[H]
        d = engine.dedupe(fr)
        if d.empty:
            continue
        pdays = int((np.asarray(ev.dates) >= start).sum())
        ct = corrected_t(d, H, period_days=pdays)
        g = (row.get("h") or {}).get(str(H)) or {}
        ins = (
            (res["details"].get(tid) or {})
            .get("variants", {})
            .get("main", {})
            .get("horizons", {})
            .get(str(H), {})
            .get("groups", {})
            or {}
        ).get("ins")
        oos = res["details"].get(tid, {}).get("oos")
        pm, months = per_month(d, start, str(row.get("signal_end") or ev.dates[-1]))
        item = {
            "id": tid,
            "label": row.get("label"),
            "family": row.get("family"),
            "verdict": row.get("verdict"),
            "n": len(d),
            **ct,
            "p_bonferroni": bonferroni_p(ct["t_corr"], n_hyp),
            "passes_bonferroni": bool(
                ct["t_corr"] is not None and ct["t_corr"] >= t_bonf and (ct["mean_excess"] or 0) > 0
            ),
            "per_month": pm,
            "months": months,
            "ins": ins,
            "oos": oos,
            "h": {k: {kk: v.get(kk) for kk in ("n", "mean_excess", "t")} for k, v in (row.get("h") or {}).items()},
            "splits": splits(d, ev, c, lab, v20),
            "param": row.get("param"),
            "large_cap": row.get("large_cap"),
            "bench": g.get("bench"),
        }
        out["tests"][tid] = item
        series[tid] = daily_series(mk, d)
        log.info(
            "audit %s：t %s／NW %s／區塊 %s → 校正 %s；每月 %s 筆",
            tid,
            ct["t"],
            ct["t_nw"],
            ct["t_block"],
            ct["t_corr"],
            pm,
        )
    out["correlation"] = correlation(series, min_days)
    return out


# ------------------------------------------------------------------ Markdown
def _f(v: Any, digits: int = 2, sign: bool = True) -> str:
    if v is None:
        return "—"
    s = f"{float(v):+.{digits}f}" if sign else f"{float(v):.{digits}f}"
    return s.replace("-", "−")


def _brief(b: dict[str, Any] | None) -> str:
    if not b or not b.get("n"):
        return "—"
    return f"{_f(b.get('mean_excess'))}（t {_f(b.get('t'), sign=False)}，n {b['n']}）"


def markdown(a: dict[str, Any]) -> str:
    H = a["horizon"]
    lines = [
        f"假說數 {a['hypotheses']}（總表項目＋變體＋參數格）；Bonferroni 5%（雙尾）對應 t ≥ {a['t_bonferroni_5pct']}。",
        f"成本：手續費 {a['costs']['fee'] * 100:.4f}%×2、證交稅 {a['costs']['tax'] * 100:.1f}%、滑價 {a['costs']['slippage'] * 100:.1f}%×2；基準扣成本＝{a['costs']['benchmark_net_of_costs']}。",
        "",
        f"| 指標 | 判定 | 樣本 | {H} 日超額 % | t | NW t | 區塊 t | 校正後 t | Bonferroni p | 每月觸發 | 樣本內 | 樣本外 |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for t in a["tests"].values():
        ins, oos = t.get("ins") or {}, t.get("oos") or {}
        lines.append(
            f"| {t['label']} | {t['verdict']} | {t['n']} | {_f(t['mean_excess'])} | {_f(t['t'], sign=False)} | {_f(t['t_nw'], sign=False)} | "
            f"{_f(t['t_block'], sign=False)}（{t['blocks']} 塊） | **{_f(t['t_corr'], sign=False)}** | {_f(t['p_bonferroni'], 3, False)} | "
            f"{t['per_month']} | {_f(ins.get('mean_excess'))} | {_f(oos.get('mean_excess'))} |"
        )
    lines += ["", "### 分組穩定性（持有 10 日、相對同日等權、扣成本）", ""]
    lines += [
        "| 指標 | 年線上 | 年線下 | 小型 | 中型 | 大型 | 上市 | 上櫃 | 成交值 < 5,000 萬 | 5,000 萬～1 億 | ≥ 1 億 |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for t in a["tests"].values():
        s = t["splits"]
        sz, mk_, lq, rg = s["size"], s["market"], s["liquidity"], s["regime"]
        lines.append(
            f"| {t['label']} | {_brief(rg['年線上'])} | {_brief(rg['年線下'])} | "
            + " | ".join(_brief(v) for v in sz.values())
            + " | "
            + " | ".join(_brief(v) for v in mk_.values())
            + " | "
            + " | ".join(_brief(v) for v in lq.values())
            + " |"
        )
    lines += ["", "### 逐年（持有 10 日超額 %）", ""]
    years = sorted({y for t in a["tests"].values() for y in t["splits"]["years"]})
    lines.append("| 指標 | " + " | ".join(years) + " |")
    lines.append("|---|" + "---|" * len(years))
    for t in a["tests"].values():
        ys = t["splits"]["years"]
        lines.append(
            f"| {t['label']} | "
            + " | ".join(_f((ys.get(y) or {}).get("mean_excess")) if (ys.get(y) or {}).get("n") else "—" for y in years)
            + " |"
        )
    cm = a.get("correlation") or {}
    pairs = [p for p in cm.get("pairs", []) if abs(p["corr"]) >= 0.5]
    lines += ["", "### 訊號相關（每日持倉超額序列的 Pearson 相關；|r| ≥ 0.5 的配對）", ""]
    if pairs:
        lines += ["| 訊號 A | 訊號 B | 相關 | 共同天數 |", "|---|---|---|---|"]
        labels = {t["id"]: t["label"] for t in a["tests"].values()}
        for p in pairs:
            lines.append(
                f"| {labels.get(p['a'], p['a'])} | {labels.get(p['b'], p['b'])} | {_f(p['corr'], 3)} | {p['days']} |"
            )
    else:
        lines.append("沒有 |r| ≥ 0.5 的配對。")
    return "\n".join(lines) + "\n"


def usable(v: str) -> bool:
    return v in (verdict.VALID, verdict.ENV)
