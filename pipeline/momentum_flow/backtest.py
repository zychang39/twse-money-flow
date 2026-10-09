"""流程回測與濾網效度（規格第九節）。

回測規則（全部依規格；與頁面「紀錄」分頁的說明一致）：
- 期間：與快照回補相同的窗口（最近 N 年）。初始資金 1,000,000 元，名額 N＝10。
- 決策在 t 日收盤後、於 t+1 日開盤執行。開盤相對前一日收盤 ≥ +9.5% 視為漲停（無法進場）、≤ −9.5% 視為跌停（無法出場），
  順延到下一個交易日再試（沒有官方漲跌停價，用替代門檻）；進場順延超過 5 個交易日取消（出場不取消）。
- 月度檢討（每個檢查日 R）：M1–M3 觸發者出場；單檔權重 > 20% 減碼回 1/N；依排序把空名額填到可用名額上限（每名額＝當時淨值 ÷ N），
  同一主族群最多 3 檔、合計 ≤ 35% 淨值。
- 每日：D1、D2 觸發者出場；eff 降級使可用名額減少時依 RS 由低到高出場；eff 升級不立即加碼，下一個 R 才補足。
- 執行價：未還原開盤價算整數股數；持股評價用還原收盤（含股利，視同再投入）；
  部位價值＝投入金額 × 還原收盤(t) ÷ 還原開盤(進場日)。
- 成本：手續費 0.1425% × 折扣（預設 0.28）進出雙邊；證交稅 0.3% 只在出場收；不計最低手續費。
- 基準：0050 還原（含息）；等權股票池＝前一日在股票池的股票等權、收盤到收盤（指標效度評估同一定義，不扣成本）。
- 下市或連續 20 個交易日沒有價格的持股：以最後一個有效收盤出場（含成本）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import stats
from pipeline.momentum_flow import candidates
from pipeline.momentum_flow.checklist import FAIL, K_LABELS, K_NAMES, PASS, Panels
from pipeline.momentum_flow.data import FlowData
from pipeline.momentum_flow.params import PARAMS
from pipeline.momentum_flow.web_out import review_dates

INITIAL_CASH = 1_000_000.0
BENCH_CODE = "0050"
PENDING_BUY_MAX_DAYS = 5
STALE_DAYS = 20
MIN_PERIODS = 30


@dataclass
class Position:
    code: str
    c: int
    units: float  # 投入金額 ÷ 進場日還原開盤
    cost: float  # 投入金額（不含手續費）
    entry: int  # 執行列
    group: str | None

    def value(self, close: float) -> float:
        return self.units * close


@dataclass
class Order:
    code: str
    c: int
    side: str  # "in" | "out"
    amount: float  # 進場：目標金額；出場：出場比例（0–1]
    why: str
    tries: int = 0


def _fin(x: float) -> bool:
    return bool(np.isfinite(x))


def caps_from_eff(eff: np.ndarray, params: dict[str, Any] | None = None) -> np.ndarray:
    """生效狀態 → 曝險上限（1／2／3 → 100／60／30%；0＝資料不足 → 0）。"""
    p = params or PARAMS
    out = np.zeros(len(eff), dtype=float)
    for st, cap in p["exposure"].items():
        out[np.asarray(eff) == int(st)] = float(cap)
    return out


class Simulator:
    """caps：每個交易日的曝險上限（0–1）；可用名額＝floor(名額 × caps[t])。狀態機是 caps_from_eff(eff)，
    研究用的變體（不控制、加動能環境）傳別的序列。rows_cache：同一組面板的候選列可在多個模擬間共用（只讀）。"""

    def __init__(
        self,
        fd: FlowData,
        P: Panels,
        caps: np.ndarray,
        start: int,
        end: int,
        params: dict[str, Any] | None = None,
        rows_cache: dict[int, list[dict[str, Any]]] | None = None,
    ):
        self.fd, self.P = fd, P
        self.caps = np.nan_to_num(np.asarray(caps, dtype=float), nan=0.0)
        self.rows_cache = rows_cache if rows_cache is not None else {}
        self.p = params or PARAMS
        self.start, self.end = start, end
        self.n = int(self.p["slots_default"])
        self.fee = float(self.p["fee_rate"]) * float(self.p["fee_discount"])
        self.tax = float(self.p["tax_rate"])
        self.limit = float(self.p["k5_limit_up_pct"]) / 100
        self.close_ff = pd.DataFrame(fd.close).ffill().to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            self.raw_open = fd.open * fd.raw_close / fd.close
            self.gap = fd.open / np.vstack([np.full((1, fd.C), np.nan), fd.close[:-1]]) - 1
        self.reviews = {i for i in review_dates(fd.dates, int(self.p["review_day"])) if start <= i <= end}
        self.cash = INITIAL_CASH
        self.pos: dict[str, Position] = {}
        self.orders: list[Order] = []
        self.nav: list[float] = []
        self.cash_hist: list[float] = []  # 每日收盤後現金（研究：投入比例、槓桿疊加）
        self.sold: list[float] = []  # 每日出場金額
        self.costs: list[float] = []  # 每日成本（手續費＋稅）
        self.trades: list[dict[str, Any]] = []
        self.log: list[str] = []

    # ------------------------------------------------------------ 工具
    def usable(self, t: int) -> int:
        return math.floor(self.n * float(self.caps[t]) + 1e-9)

    def rows(self, t: int) -> list[dict[str, Any]]:
        if t not in self.rows_cache:
            self.rows_cache[t] = candidates.day_rows(self.fd, self.P, t, self.p)
        return self.rows_cache[t]

    def mark(self, t: int) -> float:
        return self.cash + sum(p.value(self.close_ff[t, p.c]) for p in self.pos.values())

    def selling(self) -> set[str]:
        return {o.code for o in self.orders if o.side == "out" and o.amount >= 1}

    # ------------------------------------------------------------ 執行（t 日開盤）
    def execute(self, t: int) -> tuple[float, float]:
        fd = self.fd
        sold = costs = 0.0
        keep: list[Order] = []
        # 出場先於進場：出場的現金同一天可用
        for o in sorted(self.orders, key=lambda o: 0 if o.side == "out" else 1):
            op, gap = fd.open[t, o.c], self.gap[t, o.c]
            if o.side == "out":
                p = self.pos.get(o.code)
                if p is None:
                    continue
                if not _fin(op) or (_fin(gap) and gap <= -self.limit):
                    o.tries += 1
                    keep.append(o)
                    continue
                units = p.units * min(1.0, o.amount)
                gross = units * op
                fee, tax = gross * self.fee, gross * self.tax
                self.cash += gross - fee - tax
                sold += gross
                costs += fee + tax
                self.trades.append({"t": t, "code": o.code, "side": "out", "amount": round(gross), "why": o.why})
                if o.amount >= 1:
                    del self.pos[o.code]
                else:
                    p.cost *= 1 - units / p.units
                    p.units -= units
            else:
                if o.code in self.pos:
                    continue
                if not _fin(op) or (_fin(gap) and gap >= self.limit) or not _fin(self.raw_open[t, o.c]):
                    o.tries += 1
                    if o.tries < PENDING_BUY_MAX_DAYS:
                        keep.append(o)
                    continue
                if len(self.pos) >= self.usable(t - 1):
                    continue
                budget = min(o.amount, self.cash / (1 + self.fee))
                shares = math.floor(budget / self.raw_open[t, o.c])
                if shares <= 0:
                    continue
                cost = shares * self.raw_open[t, o.c]
                fee = cost * self.fee
                self.cash -= cost + fee
                costs += fee
                self.pos[o.code] = Position(o.code, o.c, cost / op, cost, t, fd.group_of.get(o.code))
                self.trades.append({"t": t, "code": o.code, "side": "in", "amount": round(cost), "why": o.why})
        self.orders = keep
        return sold, costs

    # ------------------------------------------------------------ 決策（t 日收盤後）
    def decide(self, t: int) -> None:
        fd, P = self.fd, self.P
        nav = self.mark(t)
        selling = self.selling()
        # 下市／長期無價：以最後有效收盤出場
        for p in list(self.pos.values()):
            if p.code in selling:
                continue
            recent = fd.close[max(0, t - STALE_DAYS + 1) : t + 1, p.c]
            if not np.isfinite(recent).any():
                gross = p.value(self.close_ff[t, p.c])
                fee, tax = gross * self.fee, gross * self.tax
                self.cash += gross - fee - tax
                self.sold[-1] += gross
                self.costs[-1] += fee + tax
                self.trades.append({"t": t, "code": p.code, "side": "out", "amount": round(gross), "why": "無價格"})
                del self.pos[p.code]
        selling = self.selling()
        # 每日條件
        for p in self.pos.values():
            if p.code in selling:
                continue
            c = p.c
            d1 = t >= 2 and all(
                _fin(fd.close[t - i, c]) and _fin(P.ma60[t - i, c]) and fd.close[t - i, c] < P.ma60[t - i, c]
                for i in range(int(self.p["d1_days"]))
            )
            d2 = p.value(self.close_ff[t, c]) <= (1 + float(self.p["d2_drawdown_pct"]) / 100) * p.cost
            if d1 or d2:
                self.orders.append(Order(p.code, c, "out", 1.0, "D1" if d1 else "D2"))
                selling.add(p.code)
        # 月度檢討
        if t in self.reviews:
            for p in self.pos.values():
                if p.code in selling:
                    continue
                c = p.c
                rs, yoy, avg3, gm = P.rs[t, c], P.yoy[t, c], P.yoy_avg3[t, c], P.gm63[t, c]
                m1 = _fin(rs) and rs < float(self.p["m1_rs"])
                m2 = (_fin(yoy) and yoy < 0) or (_fin(yoy) and _fin(avg3) and yoy <= avg3 - float(self.p["m2_drop_pp"]))
                m3 = _fin(gm) and gm < 0
                if m1 or m2 or m3:
                    self.orders.append(Order(p.code, c, "out", 1.0, "M1" if m1 else "M2" if m2 else "M3"))
                    selling.add(p.code)
            for p in self.pos.values():
                if p.code in selling or nav <= 0:
                    continue
                v = p.value(self.close_ff[t, p.c])
                if v / nav > float(self.p["weight_alert"]):
                    frac = 1 - (nav / self.n) / v
                    if frac > 0:
                        self.orders.append(Order(p.code, p.c, "out", frac, "權重"))
        # 降級：可用名額減少 → 依 RS 由低到高出場
        usable = self.usable(t)
        held = [p for p in self.pos.values() if p.code not in selling]
        pending_in = [o for o in self.orders if o.side == "in"]
        if len(held) + len(pending_in) > usable:
            self.orders = [o for o in self.orders if o.side != "in"]
            pending_in = []
            over = len(held) - usable
            if over > 0:
                held.sort(key=lambda p: (np.nan_to_num(P.rs[t, p.c], nan=-1.0), p.code))
                for p in held[:over]:
                    self.orders.append(Order(p.code, p.c, "out", 1.0, "降級"))
                    selling.add(p.code)
                held = held[over:]
        # 月度填補（升級後也只在 R 補足）
        if t in self.reviews:
            empty = usable - len(held) - len(pending_in)
            if empty > 0:
                self.fill(t, nav, held, pending_in, empty)

    def fill(self, t: int, nav: float, held: list[Position], pending_in: list[Order], empty: int) -> None:
        fd = self.fd
        s = nav / self.n
        taken = {p.code for p in held} | {o.code for o in pending_in} | set(self.pos)
        g_count: dict[str, int] = {}
        g_amt: dict[str, float] = {}
        for p in held:
            if p.group:
                g_count[p.group] = g_count.get(p.group, 0) + 1
                g_amt[p.group] = g_amt.get(p.group, 0.0) + p.value(self.close_ff[t, p.c])
        for o in pending_in:
            g = fd.group_of.get(o.code)
            if g:
                g_count[g] = g_count.get(g, 0) + 1
                g_amt[g] = g_amt.get(g, 0.0) + o.amount
        pos = {c: i for i, c in enumerate(fd.codes)}
        for r in self.rows(t):
            if empty <= 0:
                break
            if not r["pass"] or r["code"] in taken:
                continue
            g = r["group"]
            if g and g_count.get(g, 0) >= int(self.p["group_max_count"]):
                continue
            if g and g_amt.get(g, 0.0) + s > float(self.p["group_max_weight"]) * nav:
                continue
            self.orders.append(Order(r["code"], pos[r["code"]], "in", s, f"R {r['level']}"))
            taken.add(r["code"])
            if g:
                g_count[g] = g_count.get(g, 0) + 1
                g_amt[g] = g_amt.get(g, 0.0) + s
            empty -= 1

    # ------------------------------------------------------------ 主迴圈
    def run(self) -> None:
        for t in range(self.start, self.end + 1):
            sold, costs = self.execute(t) if t > self.start else (0.0, 0.0)
            self.sold.append(sold)
            self.costs.append(costs)
            self.decide(t)
            self.nav.append(self.mark(t))
            self.cash_hist.append(self.cash)


# ---------------------------------------------------------------- 指標
def _mdd(nav: np.ndarray) -> float | None:
    if nav.size == 0:
        return None
    peak = np.maximum.accumulate(nav)
    with np.errstate(invalid="ignore", divide="ignore"):
        dd = nav / peak - 1
    return float(np.nanmin(dd)) if np.isfinite(dd).any() else None


def _month_ends(dates: list[str]) -> list[int]:
    out = [i for i in range(len(dates) - 1) if dates[i][:7] != dates[i + 1][:7]]
    out.append(len(dates) - 1)
    return out


def _r(v: float | None, d: int = 4) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def _ew_level(fd: FlowData, start: int, end: int) -> np.ndarray:
    """等權股票池指數（指標效度評估同一定義）：前一日在股票池的股票等權、收盤到收盤。"""
    close = fd.close[start - 1 : end + 1]
    uni = fd.universe[start - 1 : end + 1]
    with np.errstate(invalid="ignore", divide="ignore"):
        r = close[1:] / close[:-1] - 1
    r = np.where(uni[:-1] & np.isfinite(r), r, np.nan)
    cnt = np.isfinite(r).sum(axis=1)
    daily = np.where(cnt > 0, np.nansum(r, axis=1) / np.maximum(cnt, 1), 0.0)
    return np.concatenate([[1.0], np.cumprod(1 + daily)])


def summarize(fd: FlowData, sim: Simulator, bench: np.ndarray, ew: np.ndarray) -> dict[str, Any]:
    dates = fd.dates[sim.start : sim.end + 1]
    nav = np.asarray(sim.nav)
    n_days = len(nav)
    years = max(n_days / 252, 1e-9)
    with np.errstate(invalid="ignore", divide="ignore"):
        daily = nav[1:] / nav[:-1] - 1
    avg_nav = float(np.mean(nav))
    cagr = (nav[-1] / nav[0]) ** (1 / years) - 1 if nav[0] > 0 else None
    b_ok = np.isfinite(bench).all() and bench[0] > 0
    b_cagr = (bench[-1] / bench[0]) ** (1 / years) - 1 if b_ok else None
    ew_cagr = (ew[-1] / ew[0]) ** (1 / years) - 1 if ew[0] > 0 else None
    me = _month_ends(dates)
    m_nav = nav[me]
    m_b = bench[me]
    with np.errstate(invalid="ignore", divide="ignore"):
        m_ret = m_nav[1:] / m_nav[:-1] - 1
        m_bret = m_b[1:] / m_b[:-1] - 1
    exc = m_ret - m_bret
    exc = exc[np.isfinite(exc)]
    summary = {
        "cagr": _r(cagr),
        "vol": _r(float(np.nanstd(daily, ddof=1)) * math.sqrt(252)) if daily.size > 1 else None,
        "mdd": _r(_mdd(nav)),
        "bench_cagr": _r(b_cagr),
        "ew_cagr": _r(ew_cagr),
        "excess_vs_0050": _r(cagr - b_cagr) if cagr is not None and b_cagr is not None else None,
        "turnover": _r(float(np.sum(sim.sold)) / avg_nav / years) if avg_nav > 0 else None,
        "cost_drag": _r(float(np.sum(sim.costs)) / avg_nav / years) if avg_nav > 0 else None,
        "excess_mean": _r(float(exc.mean())) if exc.size else None,
        "excess_t": _r(stats.newey_west_t(exc, 3), 2) if exc.size >= 3 else None,
        "excess_months": int(exc.size),
        "trades": len(sim.trades),
        "final_nav": round(float(nav[-1])),
        "total_cost": round(float(np.sum(sim.costs))),
    }
    # 逐年
    yearly: list[dict[str, Any]] = []
    ys = sorted({d[:4] for d in dates})
    for y in ys:
        idx = [i for i, d in enumerate(dates) if d[:4] == y]
        i0, i1 = idx[0], idx[-1]
        base = i0 - 1 if i0 > 0 else i0
        seg = nav[i0 : i1 + 1]
        yearly.append(
            {
                "year": y,
                "ret": _r(nav[i1] / nav[base] - 1) if nav[base] > 0 else None,
                "bench": _r(bench[i1] / bench[base] - 1) if b_ok else None,
                "ew": _r(ew[i1] / ew[base] - 1),
                "turnover": _r(float(np.sum(sim.sold[i0 : i1 + 1])) / float(np.mean(seg)))
                if np.mean(seg) > 0
                else None,
                "mdd": _r(_mdd(seg)),
                "trades": sum(1 for x in sim.trades if i0 <= x["t"] - sim.start <= i1),
            }
        )
    return {"summary": summary, "yearly": yearly, "years": ys}


def filter_validity(
    fd: FlowData, P: Panels, start: int, end: int, params: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """濾網效度：每個 R，P＝全通過；F_k＝只有 Kk 未通過（其他 5 項通過）；前瞻＝還原收盤(R+21) ÷ 還原開盤(R+1) − 1。"""
    p = params or PARAMS
    h = int(p["windows"]["1M"])
    rs_ = [r for r in review_dates(fd.dates, int(p["review_day"])) if start <= r <= end and r + h < fd.T]
    out: list[dict[str, Any]] = []
    for i, k in enumerate(K_NAMES):
        diffs: list[float] = []
        np_, nf = [], []
        for r in rs_:
            with np.errstate(invalid="ignore", divide="ignore"):
                fwd = fd.close[r + h] / fd.open[r + 1] - 1
            cand = P.level[r] > 0
            others = np.all(np.delete(P.k[:, r, :], i, axis=0) == PASS, axis=0)
            grp_p = cand & P.passed[r] & np.isfinite(fwd)
            grp_f = cand & others & (P.k[i, r] == FAIL) & np.isfinite(fwd)
            if grp_p.any() and grp_f.any():
                diffs.append(float(fwd[grp_p].mean() - fwd[grp_f].mean()))
                np_.append(int(grp_p.sum()))
                nf.append(int(grp_f.sum()))
        x = np.asarray(diffs)
        out.append(
            {
                "k": k,
                "label": K_LABELS[k],
                "mean_diff": _r(float(x.mean())) if x.size else None,
                "t": _r(stats.newey_west_t(x, 1), 2) if x.size >= 3 else None,
                "periods": int(x.size),
                "avg_p": _r(float(np.mean(np_)), 1) if np_ else None,
                "avg_f": _r(float(np.mean(nf)), 1) if nf else None,
                "enough": bool(x.size >= MIN_PERIODS),
            }
        )
    return out


def run(
    fd: FlowData, P: Panels, eff: np.ndarray, start: int, end: int | None = None, params: dict[str, Any] | None = None
) -> dict[str, Any]:
    """整段：模擬 + 指標 + 濾網效度 → 前端 backtest.json 的內容。"""
    p = params or PARAMS
    end = fd.T - 1 if end is None else end
    start = max(start, 1)
    sim = Simulator(fd, P, caps_from_eff(eff, p), start, end, p)
    sim.run()
    nav = np.asarray(sim.nav)
    etf = (getattr(fd.ev, "etf", None) or {}).get(BENCH_CODE)
    if etf is not None:
        b = pd.Series(etf["close"][start : end + 1]).ffill().to_numpy()
        bench = b / b[0] * INITIAL_CASH if np.isfinite(b[0]) and b[0] > 0 else np.full(nav.size, np.nan)
    else:
        bench = np.full(nav.size, np.nan)
    ew = _ew_level(fd, start, end) * INITIAL_CASH
    m = summarize(fd, sim, bench, ew)
    dates = fd.dates[start : end + 1]
    return {
        "date": fd.dates[end],
        "period": [dates[0], dates[-1]],
        "years": m["years"],
        "params": {
            "initial": INITIAL_CASH,
            "slots": int(p["slots_default"]),
            "fee": f"{p['fee_rate']:.4%} × {p['fee_discount']}",
            "tax": f"{p['tax_rate']:.1%}",
            "limit_pct": p["k5_limit_up_pct"],
            "bench": BENCH_CODE,
        },
        "summary": m["summary"],
        "yearly": m["yearly"],
        "curve": {
            "dates": dates,
            "nav": [round(float(v)) for v in nav],
            "bench": [None if not np.isfinite(v) else round(float(v)) for v in bench],
            "ew": [round(float(v)) for v in ew],
        },
        "trades": [{**x, "date": fd.dates[x["t"]]} for x in sim.trades][-300:],
        "filters": filter_validity(fd, P, start, end, p),
        "notes": [
            "決策在 t 日收盤後、t+1 日開盤執行；開盤相對前一日收盤 ≥ +9.5% 視為漲停（無法進場）、≤ −9.5% 視為跌停（無法出場），順延到下一個交易日；進場順延超過 5 個交易日取消。",
            "執行價用未還原開盤價算整數股數（含零股）；持股評價用還原收盤（含股利，視同再投入）。",
            f"手續費 {p['fee_rate']:.4%} × {p['fee_discount']} 進出雙邊、證交稅 {p['tax_rate']:.1%} 只在出場收；不計最低手續費。",
            "基準：0050 還原（含息）；等權股票池＝前一日在股票池的股票等權、收盤到收盤（指標效度評估同一定義，不扣成本）。",
            "K5 需要注意名單（2023-06 起），之前的日子沒有股票能全通過；回測實際從第一個可全通過的檢查日開始持股。",
            "族群成員用目前的產業分類（沒有歷史分類），主族群 3M 中位數與族群上限都受此限制。",
        ],
    }
