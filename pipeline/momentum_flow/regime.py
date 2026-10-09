"""動能環境與研究（2026-10-09 使用者要求：為什麼輸 0050、什麼時候適合做動能、槓桿幅度與歷史回撤）。

全部預先登錄（params.PARAMS["regime"]，看結果之前固定，不依結果調參），時點一律 t 日收盤可得、t+1 起生效：

- 動能因子（mom）：每個檢查日 R，股票池內 RS ≥ 90 且 20 日均成交金額 ≥ 5,000 萬的股票等權買進持有到下一個 R
  （R+1 開盤進場、還原價、不扣成本）。對照組 ew_liq＝同一流動性門檻的全部股票，同樣機制。因子超額＝mom − ew_liq。
- 主要條件（合計 0–3 分 → 順風 3、中性 2、逆風 0–1）：
  F1 大盤狀態機＝狀態 1；F2 動能因子近 126 日累積超額 > 0（因子動能，Ehsani & Linnainmaa 2022）；
  F3 加權指數 60 日實現波動 ≤ 自身歷史第 80 百分位（高波動時動能容易崩，Daniel & Moskowitz 2016；Barroso & Santa-Clara 2015）。
- 參考條件（不進分數，用來解釋）：F4 加權指數 12 個月報酬 > 0（Cooper, Gutierrez & Hameed 2004）；
  F5 股票池收在 60 日線上的比例 > 50%；F6 0050 近 63 日報酬勝過等權股票池（權值股領漲）。
- 長期回測：2018-01 起；2023-06 前沒有注意名單 → K5 以「不在處置、漲停 < 2」代理（標示）。
  變體：不控制曝險、狀態機（規格）、狀態機＋動能環境（取兩者較低的曝險上限）。
- 報酬分解（每日、算術、精確相加）：流程 − 0050 ＝ 選股（持股 − 等權）× 投入比例 ＋ 權值股效應（等權 − 0050）× 投入比例
  － 現金拖累（1 − 投入比例）× 0050。
- 條件統計：以月（相鄰兩個 R）為單位，不重疊；y＝a＋b·條件，Newey-West t（lag 3）；全期、前段（≤ 2021）、後段分開。
- 槓桿：每個 R 重設倍數 L（月內不再調整、隨價格漂移），不足的部分以融資年利率計息；整戶維持率 < 130% 記一次追繳，
  當天以收盤價強制還清融資（扣手續費與證交稅），月內改回 1 倍。重設與強制還款都計交易成本。
"""

from __future__ import annotations

import itertools
import math
from dataclasses import replace
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import stats
from pipeline.momentum_flow import backtest as bt
from pipeline.momentum_flow.checklist import PASS, Panels, tri
from pipeline.momentum_flow.data import FlowData
from pipeline.momentum_flow.params import PARAMS
from pipeline.momentum_flow.web_out import review_dates

FLAG_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6"]
FLAG_LABELS = {
    "F1": "大盤狀態 1",
    "F2": "動能因子 6 個月超額 > 0",
    "F3": "大盤波動不在高檔",
    "F4": "大盤 12 個月報酬 > 0",
    "F5": "過半股票在 60 日線上",
    "F6": "權值股領漲（0050 勝等權）",
}
PRIMARY = ["F1", "F2", "F3"]
REGIME_LABELS = {3: "順風", 2: "中性", 1: "逆風", 0: "逆風"}


def _rp(params: dict[str, Any] | None = None) -> dict[str, Any]:
    return dict((params or PARAMS)["regime"])


def _r(v: float | None, d: int = 4) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), d)


# ---------------------------------------------------------------- 面板與序列
def k5_proxy_panels(fd: FlowData, P: Panels, params: dict[str, Any] | None = None) -> Panels:
    """長期研究用：注意名單開始之前（lists_from 之前），K5 改以「不在處置、20 日漲停 < 2」代理；之後與規格相同。"""
    p = params or PARAMS
    if not fd.lists_from:
        return P
    before = np.asarray(fd.dates) < fd.lists_from
    with np.errstate(invalid="ignore"):
        proxy = tri(~fd.in_disposition & (P.limit_count < p["k5_limit_up_max"]), np.isfinite(P.limit_count))
    k = P.k.copy()
    k[4, before] = proxy[before]
    passed = (P.level > 0) & np.all(k == PASS, axis=0)
    return replace(P, k=k, passed=passed)


def ew_daily(close: np.ndarray, member: np.ndarray) -> np.ndarray:
    """前一日成員等權的每日報酬（收盤到收盤，每日再平衡）。第 0 天＝0。"""
    with np.errstate(invalid="ignore", divide="ignore"):
        r = close[1:] / close[:-1] - 1
    r = np.where(member[:-1] & np.isfinite(r), r, np.nan)
    cnt = np.isfinite(r).sum(axis=1)
    daily = np.where(cnt > 0, np.nansum(r, axis=1) / np.maximum(cnt, 1), 0.0)
    return np.concatenate([[0.0], daily])


def basket_daily(fd: FlowData, select: np.ndarray, reviews: list[int]) -> tuple[np.ndarray, list[int]]:
    """每個 R 選 select[R] 的股票等權、R+1 開盤進場、持有到下一個 R（買進持有，月內不再平衡）。

    回傳每日報酬（第一個 R 之前為 NaN）與每期檔數。停牌（價格缺）當天報酬視為 0。"""
    T = fd.T
    out = np.full(T, np.nan)
    counts: list[int] = []
    if reviews:
        out[reviews[0]] = 0.0
    for i, r in enumerate(reviews):
        end = reviews[i + 1] if i + 1 < len(reviews) else T - 1
        idx = np.flatnonzero(select[r])
        counts.append(int(idx.size))
        if end <= r:
            continue
        if idx.size == 0:
            out[r + 1 : end + 1] = 0.0
            continue
        v = np.full(idx.size, 1.0 / idx.size)
        for t in range(r + 1, end + 1):
            with np.errstate(invalid="ignore", divide="ignore"):
                g = fd.close[t, idx] / (fd.open[t, idx] if t == r + 1 else fd.close[t - 1, idx])
            g = np.where(np.isfinite(g) & (g > 0), g, 1.0)
            prev = v.sum()
            v = v * g
            out[t] = v.sum() / prev - 1 if prev > 0 else 0.0
    return out, counts


def etf_daily(fd: FlowData, code: str = bt.BENCH_CODE) -> np.ndarray:
    etf = (getattr(fd.ev, "etf", None) or {}).get(code)
    if etf is None:
        return np.full(fd.T, np.nan)
    c = pd.Series(etf["close"]).ffill().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        r = c[1:] / c[:-1] - 1
    return np.concatenate([[np.nan], r])


def _roll_log_sum(r: np.ndarray, n: int) -> np.ndarray:
    lr = pd.Series(np.log1p(r))
    return lr.rolling(n, min_periods=n).sum().to_numpy()


def _flag(cond: np.ndarray, avail: np.ndarray) -> np.ndarray:
    """1＝符合、0＝不符合、-1＝資料不足。"""
    return np.where(avail, cond.astype(np.int8), np.int8(-1)).astype(np.int8)


def compute_flags(
    fd: FlowData, P: Panels, eff: np.ndarray, series: dict[str, np.ndarray], params: dict[str, Any] | None = None
) -> dict[str, Any]:
    """每個交易日 t 的 F1–F6（只用 t 日以前的資料）、原始數值與主要條件的合計分數。"""
    rp = _rp(params)
    tx = pd.Series(np.asarray(fd.taiex, dtype=float))
    tr = tx.pct_change(fill_method=None)
    vol = (tr.rolling(int(rp["vol_days"])).std() * math.sqrt(252)).to_numpy()
    vol_thr = pd.Series(vol).expanding(min_periods=int(rp["vol_min_obs"])).quantile(float(rp["vol_pct"])).to_numpy()
    ret_up = (tx / tx.shift(int(rp["up_days"])) - 1).to_numpy()
    prem = series["mom"] - series["ew_liq"]
    trend = _roll_log_sum(series["mom"], int(rp["trend_days"])) - _roll_log_sum(series["ew_liq"], int(rp["trend_days"]))
    ma = pd.DataFrame(fd.close).rolling(int(rp["breadth_ma"])).mean().to_numpy()
    valid = fd.universe & np.isfinite(ma) & np.isfinite(fd.close)
    with np.errstate(invalid="ignore"):
        above = (fd.close > ma) & valid
    n_valid = valid.sum(axis=1)
    breadth = np.where(n_valid > 0, above.sum(axis=1) / np.maximum(n_valid, 1), np.nan)
    lead = _roll_log_sum(series["b0050"], int(rp["lead_days"])) - _roll_log_sum(series["ew"], int(rp["lead_days"]))
    eff = np.asarray(eff)
    with np.errstate(invalid="ignore"):
        flags = {
            "F1": _flag(eff == 1, eff > 0),
            "F2": _flag(trend > 0, np.isfinite(trend)),
            "F3": _flag(vol <= vol_thr, np.isfinite(vol) & np.isfinite(vol_thr)),
            "F4": _flag(ret_up > 0, np.isfinite(ret_up)),
            "F5": _flag(breadth > float(rp["breadth_min"]), np.isfinite(breadth)),
            "F6": _flag(lead > 0, np.isfinite(lead)),
        }
    prim = np.stack([flags[k] for k in PRIMARY])
    score = np.where(np.all(prim >= 0, axis=0), prim.clip(0).sum(axis=0), -1).astype(np.int8)
    values = {
        "F1": eff.astype(float),
        "F2": trend,
        "F3": vol,
        "F3_thr": vol_thr,
        "F4": ret_up,
        "F5": breadth,
        "F6": lead,
        "prem": prem,
    }
    return {"flags": flags, "score": score, "values": values}


def regime_caps(score: np.ndarray, state_caps: np.ndarray, params: dict[str, Any] | None = None) -> np.ndarray:
    """狀態機＋動能環境：兩者較低的曝險上限；環境資料不足時只用狀態機。"""
    caps_map = {int(k): float(v) for k, v in _rp(params)["caps"].items()}
    rc = np.array([caps_map.get(int(s), np.nan) if s >= 0 else np.nan for s in score])
    return np.where(np.isfinite(rc), np.minimum(state_caps, rc), state_caps)


# ---------------------------------------------------------------- 統計工具
def nw_ols_t(y: np.ndarray, x: np.ndarray, lags: int) -> float | None:
    """y＝a＋b·x 的 b 之 Newey-West（Bartlett）t 值；x 為 0／1。樣本太少或某組少於 2 筆回 None。"""
    ok = np.isfinite(y) & np.isfinite(x)
    y, x = y[ok], x[ok]
    n = y.size
    if n < 6 or (x == 1).sum() < 2 or (x == 0).sum() < 2:
        return None
    X = np.column_stack([np.ones(n), x])
    xtx_inv = np.linalg.inv(X.T @ X)
    beta = xtx_inv @ X.T @ y
    e = y - X @ beta
    xe = X * e[:, None]
    S = xe.T @ xe
    for k in range(1, min(lags, n - 1) + 1):
        w = 1 - k / (lags + 1)
        g = xe[k:].T @ xe[:-k]
        S += w * (g + g.T)
    V = xtx_inv @ S @ xtx_inv
    se = math.sqrt(V[1, 1]) if V[1, 1] > 0 else 0.0
    return float(beta[1] / se) if se > 0 else None


def perf(nav: np.ndarray, dates: list[str], bench: np.ndarray | None = None, lags: int = 3) -> dict[str, Any]:
    """年化報酬、年化波動、最大回撤、Calmar、Sharpe（無風險利率 0）、最差月、最長水下天數、月超額（相對 bench）與 NW t。"""
    nav = np.asarray(nav, dtype=float)
    if nav.size < 2 or not np.isfinite(nav[0]) or nav[0] <= 0:
        return {}
    years = nav.size / 252
    end = nav[-1]
    cagr = (end / nav[0]) ** (1 / years) - 1 if end > 0 else -1.0
    with np.errstate(invalid="ignore", divide="ignore"):
        d = nav[1:] / nav[:-1] - 1
    d = d[np.isfinite(d)]
    vol = float(np.std(d, ddof=1) * math.sqrt(252)) if d.size > 2 else None
    peak = np.maximum.accumulate(nav)
    dd = nav / peak - 1
    mdd = float(dd.min())
    under, longest = 0, 0
    for x in dd:
        under = under + 1 if x < 0 else 0
        longest = max(longest, under)
    me = [i for i in range(len(dates) - 1) if dates[i][:7] != dates[i + 1][:7]] + [len(dates) - 1]
    m_nav = nav[me]
    m_ret = m_nav[1:] / m_nav[:-1] - 1
    out: dict[str, Any] = {
        "cagr": _r(cagr),
        "vol": _r(vol),
        "mdd": _r(mdd),
        "calmar": _r(cagr / abs(mdd), 2) if mdd < 0 else None,
        "sharpe": _r(float(np.mean(d) / np.std(d, ddof=1) * math.sqrt(252)), 2)
        if d.size > 2 and np.std(d) > 0
        else None,
        "worst_month": _r(float(m_ret.min())) if m_ret.size else None,
        "underwater_days": int(longest),
        "final": round(float(end)),
    }
    if bench is not None and np.isfinite(bench).all():
        m_b = np.asarray(bench, dtype=float)[me]
        exc = m_ret - (m_b[1:] / m_b[:-1] - 1)
        out["excess_mean"] = _r(float(exc.mean())) if exc.size else None
        out["excess_t"] = _r(stats.newey_west_t(exc, lags), 2) if exc.size >= 6 else None
        b_cagr = (m_b[-1] / m_b[0]) ** (1 / years) - 1
        out["bench_cagr"] = _r(b_cagr)
    return out


def _split_idx(dates: list[str], split: str) -> int:
    for i, d in enumerate(dates):
        if d >= split:
            return i
    return len(dates)


def periods_perf(nav: np.ndarray, dates: list[str], bench: np.ndarray, split: str, lags: int) -> dict[str, Any]:
    k = _split_idx(dates, split)
    out = {"full": perf(nav, dates, bench, lags)}
    if 60 < k < len(dates) - 60:
        out["first"] = perf(nav[: k + 1], dates[: k + 1], bench[: k + 1], lags)
        out["second"] = perf(nav[k:], dates[k:], bench[k:], lags)
    return out


# ---------------------------------------------------------------- 報酬分解
def attribution(nav: np.ndarray, cash: np.ndarray, r_ew: np.ndarray, r_b: np.ndarray, dates: list[str], lags: int):
    """流程 − 0050 的每日算術分解（精確相加），年化（× 252）與月合計的 NW t。"""
    nav = np.asarray(nav, dtype=float)
    w = 1 - np.asarray(cash, dtype=float) / nav  # 收盤投入比例
    r_f = nav[1:] / nav[:-1] - 1
    wp = np.clip(w[:-1], 0, None)
    r_ew1, r_b1 = np.nan_to_num(r_ew[1:]), np.nan_to_num(r_b[1:])
    with np.errstate(invalid="ignore", divide="ignore"):
        r_h = np.where(wp > 0.02, r_f / np.where(wp > 0.02, wp, 1), 0.0)
    sel = np.where(wp > 0.02, wp * (r_h - r_ew1), r_f - wp * r_ew1)  # 投入極少時，殘差歸到選股（數值上很小）
    size = wp * (r_ew1 - r_b1)
    cash_c = -(1 - wp) * r_b1
    total = r_f - r_b1
    parts = {"selection": sel, "size": size, "cash": cash_c, "total": total}
    months = [d[:7] for d in dates[1:]]
    out: dict[str, Any] = {"invested": _r(float(np.mean(wp)), 3)}
    for k, x in parts.items():
        m = pd.Series(x).groupby(months).sum().to_numpy()
        out[k] = {
            "annual": _r(float(np.mean(x) * 252)),
            "t": _r(stats.newey_west_t(m, lags), 2) if m.size >= 6 else None,
        }
    out["check"] = _r(float(np.mean(sel + size + cash_c - total) * 252), 8)  # 應為 0
    return out


# ---------------------------------------------------------------- 條件統計（月）
def month_returns(r: np.ndarray, reviews: list[int]) -> np.ndarray:
    """相鄰兩個 R 之間（R 收盤 → 下一個 R 收盤）的複利報酬。"""
    out = []
    for a, b in itertools.pairwise(reviews):
        seg = r[a + 1 : b + 1]
        out.append(float(np.prod(1 + np.nan_to_num(seg))) - 1 if seg.size else np.nan)
    return np.asarray(out)


def condition_table(
    flags: dict[str, np.ndarray],
    score: np.ndarray,
    reviews: list[int],
    dates: list[str],
    ys: dict[str, np.ndarray],
    split: str,
    lags: int,
) -> list[dict[str, Any]]:
    """每個條件：符合／不符合月份的平均、差、NW t、勝率；全期、前段、後段。另加合計分數（順風 vs 其他）。"""
    starts = reviews[:-1]
    m_dates = [dates[r] for r in starts]
    k = _split_idx(m_dates, split)
    segs = {"full": slice(0, len(starts)), "first": slice(0, k), "second": slice(k, len(starts))}
    rows: list[dict[str, Any]] = []
    items = [(f, flags[f]) for f in FLAG_KEYS]
    items.append(("S3", np.where(score >= 0, (score == 3).astype(np.int8), np.int8(-1))))
    for key, fl in items:
        x_all = np.array([fl[r] for r in starts], dtype=float)
        x_all[x_all < 0] = np.nan
        row: dict[str, Any] = {
            "k": key,
            "label": FLAG_LABELS.get(key, "順風（F1–F3 全符合）"),
            "primary": key in PRIMARY or key == "S3",
        }
        for name, sl in segs.items():
            x = x_all[sl]
            cell: dict[str, Any] = {}
            for yk, y_all in ys.items():
                y = y_all[sl]
                ok = np.isfinite(x) & np.isfinite(y)
                on, off = y[ok & (x == 1)], y[ok & (x == 0)]
                cell[yk] = {
                    "on": _r(float(on.mean())) if on.size else None,
                    "off": _r(float(off.mean())) if off.size else None,
                    "n_on": int(on.size),
                    "n_off": int(off.size),
                    "hit_on": _r(float((on > 0).mean()), 3) if on.size else None,
                    "hit_off": _r(float((off > 0).mean()), 3) if off.size else None,
                    "diff": _r(float(on.mean() - off.mean())) if on.size and off.size else None,
                    "t": _r(nw_ols_t(y[ok], x[ok], lags), 2),
                }
            row[name] = cell
        rows.append(row)
    # 合計分數三個層級的平均（全期）
    sc = np.array([score[r] for r in starts], dtype=float)
    levels = []
    for lv, lab in ((3, "順風"), (2, "中性"), (1, "逆風")):
        sel = (sc == lv) if lv > 1 else (sc >= 0) & (sc <= 1)
        cell = {"label": lab, "n": int(sel.sum())}
        for yk, y in ys.items():
            v = y[sel & np.isfinite(y)]
            cell[yk] = _r(float(v.mean())) if v.size else None
            cell[yk + "_hit"] = _r(float((v > 0).mean()), 3) if v.size else None
        levels.append(cell)
    rows.append({"k": "levels", "levels": levels})
    return rows


# ---------------------------------------------------------------- 槓桿疊加
def lever(
    nav: np.ndarray,
    cash: np.ndarray,
    rebal: list[int],
    L_at: dict[int, float],
    fee: float,
    tax: float,
    rate: float,
    maintenance: float,
) -> dict[str, Any]:
    """把整個流程帳戶放大 L 倍：每個重設日 k＝L × 權益 ÷ 流程權益，月內部位隨價格漂移、融資固定計息。

    權益＝k × 流程權益 ＋ C；C 為重設時的現金差額（L > 1 為負＝融資）。整戶維持率＝部位 ÷ 融資 < maintenance 時
    記一次追繳，以當天收盤強制還清融資（扣成本），之後到下一個重設日都是 1 倍。權益 ≤ 0 視為斷頭歸零。"""
    nav = np.asarray(nav, dtype=float)
    cash = np.asarray(cash, dtype=float)
    pos_f = nav - cash
    n = nav.size
    out = np.zeros(n)
    rebal_set = set(rebal)
    E = nav[0]
    L0 = L_at.get(0, 1.0)
    k = L0 * E / nav[0]
    C = E - k * nav[0]
    costs = interest = 0.0
    calls: list[int] = []
    gross = np.full(n, np.nan)  # 總曝險＝部位 ÷ 權益
    out[0] = E
    gross[0] = k * pos_f[0] / E
    dead = False
    for t in range(1, n):
        if dead:
            out[t] = 0.0
            continue
        total_cash = k * cash[t] + C
        loan = max(-total_cash, 0.0)
        if loan > 0:
            it = loan * rate / 252
            C -= it
            interest += it
        E = k * nav[t] + C
        if E <= 0:
            dead = True
            out[t] = 0.0
            continue
        loan = max(-(k * cash[t] + C), 0.0)
        if loan > 0 and k * pos_f[t] / loan < maintenance:
            calls.append(t)
            c = loan * (fee + tax)
            costs += c
            E -= c
            k, C = E / nav[t], 0.0
        if t in rebal_set and t in L_at:
            L = L_at[t]
            k_new = L * E / nav[t]
            trade = abs(k_new - k) * pos_f[t]
            c = trade * fee + (trade * tax if k_new < k else 0.0)
            costs += c
            E -= c
            k, C = k_new, E - k_new * nav[t]
        out[t] = E
        gross[t] = k * pos_f[t] / E if E > 0 else np.nan
    return {"nav": out, "calls": calls, "costs": costs, "interest": interest, "dead": dead, "gross": gross}


def worst_window(nav: np.ndarray, n: int) -> float | None:
    """任意連續 n 個交易日的最差報酬。"""
    nav = np.asarray(nav, dtype=float)
    if nav.size <= n:
        return None
    with np.errstate(invalid="ignore", divide="ignore"):
        r = nav[n:] / nav[:-n] - 1
    r = r[np.isfinite(r)]
    return float(r.min()) if r.size else None


def idle_in_etf(nav: np.ndarray, cash: np.ndarray, r_b: np.ndarray, fee: float, etf_tax: float) -> np.ndarray:
    """對照：流程的閒置現金每天收盤改持有 0050（還原、含息），隔天起承擔 0050 漲跌；調整部位扣手續費，
    賣出 0050 另扣 ETF 證交稅。回傳合併帳戶淨值（起點同流程）。"""
    nav = np.asarray(nav, dtype=float)
    w_cash = np.asarray(cash, dtype=float) / nav
    out = np.empty(nav.size)
    out[0] = nav[0]
    for t in range(1, nav.size):
        r_f = nav[t] / nav[t - 1] - 1
        rb = float(np.nan_to_num(r_b[t]))
        drift = w_cash[t - 1] * (1 + rb) / (1 + r_f + w_cash[t - 1] * rb) if (1 + r_f + w_cash[t - 1] * rb) > 0 else 0
        change = w_cash[t] - drift  # 收盤時 0050 部位（佔權益）要調整的量
        cost = abs(change) * fee + (max(-change, 0.0) * etf_tax)
        out[t] = out[t - 1] * (1 + r_f + w_cash[t - 1] * rb) * (1 - cost)
    return out


def leverage_table(
    nav: np.ndarray,
    cash: np.ndarray,
    dates: list[str],
    rebal: list[int],
    score_at: dict[int, int],
    bench: np.ndarray,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    p = params or PARAMS
    rp = _rp(p)
    fee = float(p["fee_rate"]) * float(p["fee_discount"])
    tax = float(p["tax_rate"])
    rate, maint, lags = float(rp["financing_rate"]), float(rp["maintenance"]), int(rp["nw_lags"])
    rows: list[dict[str, Any]] = []

    def add(key: str, label: str, sched: dict[int, float]) -> None:
        res = lever(nav, cash, rebal, sched, fee, tax, rate, maint)
        pf = perf(res["nav"], dates, bench, lags) if not res["dead"] else {"cagr": -1.0, "mdd": -1.0}
        Ls = list(sched.values())
        rows.append(
            {
                "k": key,
                "label": label,
                **pf,
                "calls": len(res["calls"]),
                "call_dates": [dates[i] for i in res["calls"]][:12],
                "dead": res["dead"],
                "interest": round(res["interest"]),
                "lev_costs": round(res["costs"]),
                "avg_L": _r(float(np.mean(Ls)), 2) if Ls else None,
                "max_L": _r(float(np.max(Ls)), 2) if Ls else None,
                "gross_avg": _r(float(np.nanmean(res["gross"])), 2),
                "gross_max": _r(float(np.nanmax(res["gross"])), 2),
                "worst_12m": _r(worst_window(res["nav"], 252)),
            }
        )

    for L in rp["leverage"]:
        add(f"L{L}", f"{L:g} 倍", {0: float(L), **{r: float(L) for r in rebal}})
    lr = pd.Series(np.log(np.where(nav > 0, nav, np.nan))).diff()
    vol = (lr.rolling(int(rp["vol_lookback"])).std() * math.sqrt(252)).to_numpy()
    for lmax in rp["vol_lev_max"]:
        sched = {0: 1.0}
        for r in rebal:
            v = vol[r]
            sched[r] = (
                float(np.clip(float(rp["vol_target"]) / v, 0.0, float(lmax))) if np.isfinite(v) and v > 0 else 1.0
            )
        add(f"VT{lmax}", f"波動目標 {float(rp['vol_target']):.0%}（上限 {lmax:g} 倍）", sched)
    rl = {int(k): float(v) for k, v in rp["regime_leverage"].items()}
    sched = {0: 1.0}
    for r in rebal:
        s = score_at.get(r, -1)
        sched[r] = rl.get(s, 1.0) if s >= 0 else 1.0
    add("RL", f"依動能環境（順風 {rl[3]:g}／中性 {rl[2]:g}／逆風 {rl[1]:g} 倍）", sched)
    return rows


# ---------------------------------------------------------------- 整段
def research(fd: FlowData, P: Panels, eff: np.ndarray, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """長期研究：序列 → 條件 → 三個變體 → 報酬分解 → 條件統計 → 槓桿表；另回傳最新一天的動能環境（大盤分頁用）。"""
    p = params or PARAMS
    rp = _rp(p)
    lags = int(rp["nw_lags"])
    T = fd.T
    all_r = review_dates(fd.dates, int(p["review_day"]))
    PL = k5_proxy_panels(fd, P, p)
    liquid = fd.universe & (np.nan_to_num(P.value20) >= float(rp["factor_value_min"]))
    with np.errstate(invalid="ignore"):
        winners = liquid & (np.nan_to_num(P.rs, nan=-1) >= float(rp["factor_rs_min"]))
    first_r = [r for r in all_r if r >= 252]
    mom, mom_n = basket_daily(fd, winners, first_r)
    ew_liq, _ = basket_daily(fd, liquid, first_r)
    series = {"mom": mom, "ew_liq": ew_liq, "ew": ew_daily(fd.close, fd.universe), "b0050": etf_daily(fd)}
    fl = compute_flags(fd, P, eff, series, p)
    score = fl["score"]
    start = next((r for r in all_r if fd.dates[r] >= str(rp["long_start"]) and score[r] >= 0), all_r[0] if all_r else 1)
    end = T - 1
    dates = fd.dates[start : end + 1]
    state_caps = bt.caps_from_eff(eff, p)
    variants = {
        "always": ("不控制曝險", np.ones(T)),
        "state": ("狀態機（規格）", state_caps),
        "regime": ("狀態機＋動能環境", regime_caps(score, state_caps, p)),
    }
    cache: dict[int, list[dict[str, Any]]] = {}
    b = pd.Series(
        np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(series["b0050"][start + 1 : end + 1]))])
    ).to_numpy()
    bench = b * bt.INITIAL_CASH
    sims: dict[str, dict[str, Any]] = {}
    split = str(rp["split"])
    for key, (label, caps) in variants.items():
        sim = bt.Simulator(fd, PL, caps, start, end, p, rows_cache=cache)
        sim.run()
        nav, cash = np.asarray(sim.nav), np.asarray(sim.cash_hist)
        sims[key] = {
            "label": label,
            "nav": nav,
            "cash": cash,
            "perf": periods_perf(nav, dates, bench, split, lags),
            "trades": len(sim.trades),
            "invested": _r(float(np.mean(1 - cash / nav)), 3),
            "exposure": _r(float(np.mean(caps[start : end + 1])), 3),
        }
    ew_level = np.concatenate([[1.0], np.cumprod(1 + series["ew"][start + 1 : end + 1])]) * bt.INITIAL_CASH
    fee = float(p["fee_rate"]) * float(p["fee_discount"])
    idle = {
        key: periods_perf(
            idle_in_etf(
                sims[key]["nav"], sims[key]["cash"], series["b0050"][start : end + 1], fee, float(rp["etf_tax"])
            ),
            dates,
            bench,
            split,
            lags,
        )
        for key in ("state", "regime")
    }
    rev_w = [r for r in all_r if start <= r <= end]
    rel = [r - start for r in rev_w]
    # 條件統計的月份：長期窗口內相鄰兩個 R
    y_prem = month_returns(series["mom"], rev_w) - month_returns(series["ew_liq"], rev_w)
    nav_state = np.full(T, np.nan)
    nav_state[start : end + 1] = sims["state"]["nav"]
    with np.errstate(invalid="ignore", divide="ignore"):
        flow_daily = np.concatenate([[np.nan], nav_state[1:] / nav_state[:-1] - 1])
    y_flow = month_returns(flow_daily, rev_w)
    y_b = month_returns(series["b0050"], rev_w)
    y_size = month_returns(series["ew"], rev_w) - y_b
    ys = {"prem": y_prem, "flow": y_flow, "flow_x": y_flow - y_b, "size": y_size}
    cond = condition_table(fl["flags"], score, rev_w, fd.dates, ys, split, lags)
    attrib = {
        key: attribution(
            sims[key]["nav"],
            sims[key]["cash"],
            series["ew"][start : end + 1],
            series["b0050"][start : end + 1],
            dates,
            lags,
        )
        for key in ("state", "regime")
    }
    score_at = {r - start: int(score[r]) for r in rev_w}
    lev = {
        key: leverage_table(sims[key]["nav"], sims[key]["cash"], dates, rel, score_at, bench, p)
        for key in ("state", "regime")
    }
    # 長期曲線（每 5 天取一點，前端畫圖用）
    step = 5
    pick = list(range(0, len(dates), step))
    if pick[-1] != len(dates) - 1:
        pick.append(len(dates) - 1)
    curve = {
        "dates": [dates[i] for i in pick],
        "bench": [round(float(bench[i])) for i in pick],
        "ew": [round(float(ew_level[i])) for i in pick],
        **{k: [round(float(v["nav"][i])) for i in pick] for k, v in sims.items()},
    }
    # 年度：各變體、0050、等權，以及當年的平均環境
    years = sorted({d[:4] for d in dates})
    yearly = []
    for y in years:
        idx = [i for i, d in enumerate(dates) if d[:4] == y]
        i0, i1 = idx[0], idx[-1]
        base = i0 - 1 if i0 > 0 else i0
        row: dict[str, Any] = {"year": y}
        for k, v in sims.items():
            row[k] = _r(v["nav"][i1] / v["nav"][base] - 1)
        row["bench"] = _r(bench[i1] / bench[base] - 1)
        row["ew"] = _r(ew_level[i1] / ew_level[base] - 1)
        sc = score[start + i0 : start + i1 + 1]
        sc = sc[sc >= 0]
        row["tailwind"] = _r(float((sc == 3).mean()), 3) if sc.size else None
        yearly.append(row)
    k_split = _split_idx(dates, split)
    return {
        "period": [dates[0], dates[-1]],
        "split": split,
        "split_dates": [
            dates[0],
            dates[k_split - 1] if k_split > 0 else dates[0],
            dates[min(k_split, len(dates) - 1)],
            dates[-1],
        ],
        "variants": {
            k: {kk: v[kk] for kk in ("label", "perf", "trades", "invested", "exposure")} for k, v in sims.items()
        },
        "yearly": yearly,
        "curve": curve,
        "attribution": attrib,
        "idle_in_0050": idle,
        "bench_perf": periods_perf(bench, dates, bench, split, lags),
        "ew_perf": periods_perf(ew_level, dates, bench, split, lags),
        "conditions": cond,
        "months": int(len(rev_w) - 1),
        "leverage": lev,
        "factor": {
            "holdings_avg": _r(float(np.mean(mom_n)), 1) if mom_n else None,
            "perf": perf(
                np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(series["mom"][start + 1 : end + 1]))]), dates
            ),
            "ew_liq_perf": perf(
                np.concatenate([[1.0], np.cumprod(1 + np.nan_to_num(series["ew_liq"][start + 1 : end + 1]))]), dates
            ),
        },
        "params": {
            k: rp[k]
            for k in (
                "factor_rs_min",
                "trend_days",
                "vol_days",
                "vol_pct",
                "up_days",
                "breadth_ma",
                "lead_days",
                "split",
                "vol_target",
                "vol_lookback",
                "financing_rate",
                "maintenance",
            )
        },
        "_flags": fl,
        "_series": series,
    }


def current(fl: dict[str, Any], t: int, dates: list[str], params: dict[str, Any] | None = None) -> dict[str, Any]:
    """大盤分頁：t 日的 F1–F6、數值、合計分數與環境曝險上限；近一年各層級天數。"""
    rp = _rp(params)
    caps_map = {int(k): float(v) for k, v in rp["caps"].items()}
    vals = fl["values"]
    s = int(fl["score"][t])
    lo = max(0, t - 249)
    sc = fl["score"][lo : t + 1]
    rows = []
    for key in FLAG_KEYS:
        v = vals[key][t]
        rows.append(
            {
                "k": key,
                "label": FLAG_LABELS[key],
                "primary": key in PRIMARY,
                "res": int(fl["flags"][key][t]),
                "value": _r(float(v), 4) if np.isfinite(v) else None,
                "thr": _r(float(vals["F3_thr"][t]), 4) if key == "F3" and np.isfinite(vals["F3_thr"][t]) else None,
            }
        )
    since = None
    if s >= 0:
        i = t
        while i > 0 and fl["score"][i - 1] == s:
            i -= 1
        since = dates[i]
    return {
        "date": dates[t],
        "score": s if s >= 0 else None,
        "label": REGIME_LABELS.get(s) if s >= 0 else None,
        "cap": caps_map.get(s) if s >= 0 else None,
        "since": since,
        "flags": rows,
        "year": {
            "tailwind": int((sc == 3).sum()),
            "neutral": int((sc == 2).sum()),
            "headwind": int(((sc >= 0) & (sc <= 1)).sum()),
        },
        "history": [int(x) if x >= 0 else None for x in fl["score"][lo : t + 1]],
    }
