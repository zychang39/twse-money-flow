"""1.10 出場規則比較（同樣的進場，六種出場）。

- 固定 5／10／20 日：進場後第 N 個交易日開盤。
- 收盤跌破 N 日線（N＝10／20／60，walk-forward 選擇）：跌破當天收盤後出場訊號，下一個交易日開盤出場。
- 固定停損（−5／−7／−10%，walk-forward 選擇），其餘到 20 日出場：盤中最低價觸及停損價即以停損價出場；
  開盤就跳空在停損價之下以開盤價；當天跌停鎖死賣不掉 → 下一個可成交日開盤。
- 追蹤停損：收盤從進場後最高收盤回落 8／10／15%（walk-forward 選擇），下一個交易日開盤出場。
- ATR 移動停損（2026-10-02 健檢 M2）：收盤 ≤ 進場後最高收盤 − k × ATR14（k＝2／3，walk-forward 選擇），下一個交易日開盤出場；
  ATR 用進場日之前的 14 日真實波幅平均（還原價）。
- 收盤跌破進場日最低價：下一個交易日開盤出場。
- 動能衰竭：連續 3 日量能 < 0.5 倍（當日量 ÷ 前 20 日均量）且 3 日內漲跌 ≤ ±2%，下一個交易日開盤出場。
沒有時間上限的規則最多持有 exits.max_days（60）個交易日。出場日跌停鎖死、停牌一律順延到下一個可成交日開盤。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence.engine import Market, dedupe, net_return
from pipeline.evidence.indicators import avg_volume_prev, ma
from pipeline.evidence.stats import pct


class Paths:
    """每筆進場之後 K+1 列的價格矩陣（n, K+1）。"""

    def __init__(self, mk: Market, e: np.ndarray, c: np.ndarray, K: int, extra: dict[str, np.ndarray]):
        T = len(mk.dates)
        self.mk, self.e, self.c, self.K = mk, e, c, K
        self.rows = e[:, None] + np.arange(K + 1)[None, :]
        self.valid = self.rows < T
        r = np.minimum(self.rows, T - 1)
        cc = c[:, None]
        self.op, self.hi, self.lo, self.cl = mk.open[r, cc], mk.high[r, cc], mk.low[r, cc], mk.close[r, cc]
        self.locked = mk.locked[r, cc]
        self.extra = {k: v[r, cc] for k, v in extra.items()}
        self.entry = mk.open[e, c]

    def next_open_after(self, k: np.ndarray) -> np.ndarray:
        """第 k 列收盤後出場 → 下一個可成交日開盤的列（沒有 → T）。"""
        T = len(self.mk.dates)
        nxt = np.minimum(self.e + k + 1, T)
        return self.mk.next_sell[nxt, self.c]


def first_hit(cond: np.ndarray, start: int = 0, stop: int | None = None) -> np.ndarray:
    """每列第一個成立的欄位索引（沒有 → -1）。"""
    sub = cond[:, start:stop]
    hit = sub.any(axis=1)
    idx = np.argmax(sub, axis=1) + start
    return np.where(hit, idx, -1)


def _result(p: Paths, row: np.ndarray, px: np.ndarray | None, planned_locked: np.ndarray) -> pd.DataFrame:
    mk = p.mk
    T = len(mk.dates)
    has = row < T
    rc = np.where(has, row, 0)
    price = (
        np.where(has, mk.open[rc, p.c], np.nan)
        if px is None
        else np.where(np.isfinite(px), px, np.where(has, mk.open[rc, p.c], np.nan))
    )
    hold = np.where(has, row - p.e, np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        gross = price / p.entry - 1
        lows = np.where(p.valid, p.lo, np.nan)
        cm = np.fmin.accumulate(np.where(np.isfinite(lows), lows, np.inf), axis=1)
        hi = np.clip(np.nan_to_num(hold, nan=1).astype(int) - 1, 0, p.K)
        worst = np.minimum(cm[np.arange(len(hi)), hi], price)
        mae = worst / p.entry - 1
    net = net_return(gross, mk.fee, mk.tax, mk.slip)
    xr = np.where(has, row, T - 1)
    bench = mk.bench_return(p.e, xr)
    ew = mk.ew_return(p.e, xr)
    at_close = np.zeros(len(xr), dtype=bool)
    e0050 = mk.etf_return("0050", p.e, xr, at_close)
    e631 = mk.etf_return("00631L", p.e, xr, at_close)
    status = np.where(has & np.isfinite(net), "ok", "pending")
    return pd.DataFrame(
        {
            "t": p.e - 1,
            "c": p.c,
            "e": p.e,
            "x": np.where(has, row, T),
            "status": status,
            "net": net,
            "entry": p.entry,
            "px": price,
            "exc_idx": net - bench,
            "exc_ew": net - ew,
            "exc_0050": net - e0050,
            "exc_00631L": net - e631,
            "mae": mae,
            "hold": hold,
            "locked": planned_locked,
        }
    )


def rule_fixed(p: Paths, n: int) -> pd.DataFrame:
    ex = p.mk.exits(p.e, p.c, n)
    return _result(p, np.where(ex["ok"], ex["row"], len(p.mk.dates)), ex["px"], ex["locked"])


def rule_close_signal(p: Paths, cond: np.ndarray, start: int = 0) -> pd.DataFrame:
    """收盤條件成立（第 k 列）→ 下一個可成交日開盤；最多持有 K 日。"""
    cond = cond & p.valid
    k = first_hit(cond[:, : p.K], start)
    k_eff = np.where(k >= 0, k, p.K - 1)
    row = p.next_open_after(k_eff)
    nominal = np.minimum(p.e + k_eff + 1, len(p.mk.dates) - 1)
    return _result(p, row, None, p.mk.locked[nominal, p.c])


def rule_stop(p: Paths, stop_pct: float, cap: int) -> pd.DataFrame:
    """固定停損：持有 cap 日內盤中最低價觸及停損價即出場；沒有觸及則第 cap 日開盤出場。"""
    T = len(p.mk.dates)
    stop_px = p.entry * (1 + stop_pct / 100)
    with np.errstate(invalid="ignore"):
        cond = (p.lo <= stop_px[:, None]) & p.valid
    k = first_hit(cond[:, :cap])
    hit = k >= 0
    kk = np.where(hit, k, 0)
    i = np.arange(len(kk))
    op = p.op[i, kk]
    lock = p.locked[i, kk]
    # 進場當天以停損價；之後開盤就跳空在停損價之下以開盤價；觸及當天跌停鎖死 → 下一個可成交日開盤
    price = np.where(kk == 0, stop_px, np.minimum(np.nan_to_num(op, nan=np.inf), stop_px))
    fx = p.mk.exits(p.e, p.c, cap)
    fixed_row = np.where(fx["ok"], fx["row"], T)
    row = np.where(hit, np.where(lock, p.next_open_after(kk), p.e + kk), fixed_row)
    px = np.where(hit, np.where(lock, np.nan, price), fx["px"])
    return _result(p, row, px, np.where(hit, lock, fx["locked"]))


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, n: int) -> np.ndarray:
    """(T, C) 平均真實波幅：max(高−低, |高−前收|, |低−前收|) 的 n 日簡單平均（需滿 n 日）。"""
    prev = np.vstack([np.full((1, close.shape[1]), np.nan), close[:-1]])
    with np.errstate(invalid="ignore"):
        tr = np.fmax(high - low, np.fmax(np.abs(high - prev), np.abs(low - prev)))
    return pd.DataFrame(tr).rolling(n, min_periods=n).mean().to_numpy()


def run_rules(mk: Market, cand: pd.DataFrame, ev: Any, cfg: dict[str, Any]) -> dict[str, dict[str, pd.DataFrame]]:
    """所有出場規則（含參數格）→ 規則名稱 → 參數 → 去重前的結果。"""
    x = cfg["exits"]
    K = int(x["max_days"])
    extra = {"vr": ev.volume / avg_volume_prev(ev.volume, 20)}
    for n in x["ma_days"]:
        extra[f"ma{n}"] = ma(ev.close, int(n))
    if x.get("atr_mult"):
        extra["atr"] = atr(ev.high, ev.low, ev.close, int(x.get("atr_period", 14)))
    p = Paths(mk, cand["e"].to_numpy(), cand["c"].to_numpy(), K, extra)
    out: dict[str, dict[str, pd.DataFrame]] = {}
    out["fixed"] = {str(n): rule_fixed(p, int(n)) for n in cfg["horizons"]}
    with np.errstate(invalid="ignore"):
        out["ma"] = {str(n): rule_close_signal(p, p.cl < p.extra[f"ma{n}"]) for n in x["ma_days"]}
        out["stop"] = {str(s): rule_stop(p, float(s), int(x["stop_cap"])) for s in x["stop_pct"]}
        runmax = np.fmax.accumulate(np.where(np.isfinite(p.cl), p.cl, -np.inf), axis=1)
        out["trailing"] = {
            str(s): rule_close_signal(p, p.cl <= runmax * (1 - float(s) / 100)) for s in x["trailing_pct"]
        }
        if "atr" in p.extra:
            # ATR 以進場日前一列為準（只用進場前已知的波幅）；收盤 ≤ 最高收盤 − k × ATR → 下一個可成交日開盤出場
            atr0 = p.extra["atr"][:, :1]
            out["atr"] = {str(k): rule_close_signal(p, p.cl <= runmax - float(k) * atr0) for k in x["atr_mult"]}
        out["entry_low"] = {"-": rule_close_signal(p, p.cl < p.lo[:, :1], start=1)}
        d = int(x["exhaust_days"])
        low_vol = p.extra["vr"] < float(x["exhaust_vol"])
        run = np.ones_like(low_vol)
        for j in range(d):
            run &= np.roll(low_vol, j, axis=1)
        prev = np.roll(p.cl, d, axis=1)
        flat = np.abs(p.cl / prev - 1) <= float(x["exhaust_move_pct"]) / 100
        cond = run & flat
        cond[:, :d] = False
        out["exhaust"] = {"-": rule_close_signal(p, cond)}
    return out


def _mean(d: pd.DataFrame, col: str) -> float | None:
    return pct(float(d[col].mean())) if col in d.columns and d[col].notna().any() else None


def summarize_rule(df: pd.DataFrame) -> dict[str, Any]:
    d = dedupe(df)
    n = len(d)
    if n == 0:
        return {"n": 0}
    return {
        "n": n,
        "ev": pct(float(d["net"].mean())),
        "exc_idx": _mean(d, "exc_idx"),
        # v3 M3-4：四種基準的相對報酬（事件平均）；等權以同日等權指數近似（持有天數不固定）
        "rel": {
            "ew": _mean(d, "exc_ew"),
            "tr": _mean(d, "exc_idx"),
            "0050": _mean(d, "exc_0050"),
            "00631L": _mean(d, "exc_00631L"),
        },
        "win": pct(float((d["net"] > 0).mean())),
        "hold": round(float(d["hold"].mean()), 1),
        "mae": pct(float(d["mae"].mean())),
        "locked": int(d["locked"].sum()),
    }


RULE_LABELS = {
    "fixed": "固定 {p} 日",
    "ma": "收盤跌破 {p} 日線",
    "stop": "固定停損 {p}%（其餘 20 日）",
    "trailing": "追蹤停損（最高收盤回落 {p}%）",
    "atr": "ATR 移動停損（最高收盤回落 {p} 倍 ATR14）",
    "entry_low": "收盤跌破進場日最低價",
    "exhaust": "動能衰竭（量縮 3 日且漲跌 ≤ ±2%）",
    "peak": "第 {p} 日出場（訓練期累積超額峰值）",
}


def compare(
    mk: Market,
    cand: pd.DataFrame,
    ev: Any,
    cfg: dict[str, Any],
    windows: list[tuple[str, str]],
    peak: int | None = None,
) -> dict[str, Any]:
    """每種出場的全參數表＋walk-forward 選參數（依訓練期期望值）與驗證期表現。

    peak：v3 M3-4「第 N 日出場（訓練期峰值）」的 N＝訓練期（第一個 walk-forward 訓練窗）累積超額曲線的峰值日，不看全樣本。
    """
    res = run_rules(mk, cand, ev, cfg)
    if peak:
        x = cfg["exits"]
        p = Paths(mk, cand["e"].to_numpy(), cand["c"].to_numpy(), int(x["max_days"]), {})
        res["peak"] = {str(int(peak)): rule_fixed(p, int(peak))}
    dates = np.asarray(mk.dates)
    table = []
    for rule, cells in res.items():
        params = {k: summarize_rule(v) for k, v in cells.items()}
        chosen, wf = None, []
        if len(cells) > 1 and rule != "fixed" and len(windows) >= 2:
            for i in range(1, len(windows)):
                train_lo, train_hi = windows[0][0], windows[i - 1][1]
                val_lo, val_hi = windows[i]
                best, best_v = None, None
                for k, v in cells.items():
                    d = v[(dates[v["t"].to_numpy()] >= train_lo) & (dates[v["t"].to_numpy()] < train_hi)]
                    s = summarize_rule(d)
                    if s["n"] >= int(cfg["verdict"]["wf_min_events"]) and (best_v is None or s["ev"] > best_v):
                        best, best_v = k, s["ev"]
                if best is None:
                    continue
                v = cells[best]
                d = v[(dates[v["t"].to_numpy()] >= val_lo) & (dates[v["t"].to_numpy()] < val_hi)]
                wf.append(
                    {"train": [train_lo, train_hi], "valid": [val_lo, val_hi], "param": best, **summarize_rule(d)}
                )
                chosen = best
        if chosen is None:
            chosen = next(iter(cells)) if rule != "fixed" else str(cfg.get("primary_horizon", 10))
        for k, s in params.items():
            table.append(
                {
                    "rule": rule,
                    "param": k,
                    "label": RULE_LABELS[rule].format(p=k),
                    "chosen": k == chosen,
                    **s,
                }
            )
        if wf:
            table[-1]["walk_forward"] = wf
    return {"rules": table}


def run_one(mk: Market, cand: pd.DataFrame, ev: Any, cfg: dict[str, Any], rule: str, param: str) -> pd.DataFrame:
    """單一出場規則（策略庫用）：與 run_rules 同樣的規則與參數格式。"""
    if rule in ("fixed", "peak"):  # 第 N 日出場（訓練期峰值）＝固定 N 日（N＝訓練期峰值日）
        x = cfg["exits"]
        p = Paths(mk, cand["e"].to_numpy(), cand["c"].to_numpy(), int(x["max_days"]), {})
        return rule_fixed(p, int(param))
    return run_rules(mk, cand, ev, cfg)[rule][param]


def _split_dates(v: pd.DataFrame, dates: np.ndarray) -> np.ndarray:
    return dates[v["t"].to_numpy()]


def _metric(s: dict[str, Any], key: str) -> float | None:
    """選規則的指標：相對 0050 的平均超額（事件平均，%）；key 為 rel 的鍵。"""
    v = (s.get("rel") or {}).get(key)
    return None if v is None else float(v)


def compare_split(
    mk: Market,
    cand: pd.DataFrame,
    ev: Any,
    cfg: dict[str, Any],
    train_end: str,
    peak: int | None = None,
    metric: str = "0050",
    min_events: int = 30,
    fallback: tuple[str, str] | None = None,
) -> dict[str, Any]:
    """2026-10-03 出場規則：只用訊號日 ≤ train_end（2021-12-31）的事件選規則，之後（2022 起）另列樣本外，兩段並排。

    1. 每種規則的參數（如停損 −5／−7／−10%）：樣本內相對 0050 平均超額最高者（樣本內去重事件 ≥ min_events 才可選）。
    2. 規則之間：各規則選定參數的樣本內相對 0050 平均超額最高者＝chosen（同分取樣本內 MAE 較小者）。
    3. 樣本內沒有足夠事件（訊號期間自 2022 起的策略）→ chosen＝fallback（預先指定：固定持有判定天數），並註明。
    樣本外的數字只報告、不參與任何選擇。
    """
    res = run_rules(mk, cand, ev, cfg)
    if peak:
        x = cfg["exits"]
        p = Paths(mk, cand["e"].to_numpy(), cand["c"].to_numpy(), int(x["max_days"]), {})
        res["peak"] = {str(int(peak)): rule_fixed(p, int(peak))}
    dates = np.asarray(mk.dates)
    rules: list[dict[str, Any]] = []
    for rule, cells in res.items():
        best, best_v, best_mae, tested = None, None, None, []
        ins_by: dict[str, dict[str, Any]] = {}
        for k, v in cells.items():
            dd = _split_dates(v, dates)
            ins = summarize_rule(v[dd <= train_end])
            ins_by[k] = ins
            m = _metric(ins, metric)
            tested.append({"param": k, "n": ins.get("n", 0), "rel_0050": m})
            if ins.get("n", 0) < min_events or m is None:
                continue
            mae = ins.get("mae") or -999.0
            if best_v is None or m > best_v or (m == best_v and mae > (best_mae or -999.0)):
                best, best_v, best_mae = k, m, mae
        if best is None:
            continue
        v = cells[best]
        dd = _split_dates(v, dates)
        rules.append(
            {
                "rule": rule,
                "param": best,
                "label": RULE_LABELS[rule].format(p=best),
                "in_sample": ins_by[best],
                "oos": summarize_rule(v[dd > train_end]),
                "params_tested": tested,
            }
        )
    chosen: dict[str, Any] | None = None
    note = None
    if rules:
        top = max(rules, key=lambda r: (_metric(r["in_sample"], metric), r["in_sample"].get("mae") or -999.0))
        chosen = {"rule": top["rule"], "param": top["param"], "label": top["label"], "basis": "in_sample"}
    elif fallback is not None:
        rule, param = fallback
        cells = res.get(rule) or {}
        v = cells.get(param)
        if v is not None:
            dd = _split_dates(v, dates)
            rules.append(
                {
                    "rule": rule,
                    "param": param,
                    "label": RULE_LABELS[rule].format(p=param),
                    "in_sample": summarize_rule(v[dd <= train_end]),
                    "oos": summarize_rule(v[dd > train_end]),
                    "params_tested": [],
                }
            )
        chosen = {"rule": rule, "param": param, "label": RULE_LABELS[rule].format(p=param), "basis": "fallback"}
        note = f"{train_end[:4]} 年底前樣本不足 {min_events} 筆，無法選規則；採預先指定的{RULE_LABELS[rule].format(p=param)}"
    for r in rules:
        r["chosen"] = chosen is not None and r["rule"] == chosen["rule"] and r["param"] == chosen["param"]
    return {
        "train_end": train_end,
        "oos_start": (pd.Timestamp(train_end) + pd.Timedelta(days=1)).date().isoformat(),
        "metric": f"樣本內相對 {metric} 平均超額（扣成本）",
        "min_events": min_events,
        "max_days": int(cfg["exits"]["max_days"]),
        "rules": rules,
        "chosen": chosen,
        "note": note,
    }
