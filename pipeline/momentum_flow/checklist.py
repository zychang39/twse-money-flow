"""檢查清單（規格第四節）與候選等級（第三節）：全部以 (T, C) 面板向量化計算，三態＝1 符合、0 未符合、−1 資料不足。

沿用 App 既有定義（並在 PR 寫明公式）：
- RS 百分位＝0.4 R63 + 0.2 R126 + 0.2 R189 + 0.2 R252 在全市場普通股的百分位，(平均名次 − 0.5) ÷ 有效檔數 × 100
  （derive/metrics rs_percentile → indicators.cross_percentile）。
- PR1M／PR3M／PR12M＝21／63／252 個交易日還原報酬在全市場普通股的百分位，同一公式（derive/momentum.cross_pct）。
- 族群 3M 中位數＝主族群成員（含本身）63 日還原報酬的中位數，成員有值者少於 3 檔無值（derive/sectors WINDOWS 3M＝63）。
  K3 的個股報酬與族群中位數同用 63 日，兩邊口徑一致（規格寫 R60，為與既有族群中位數一致改用 63，PR 說明）。
- H250＝近 250 個交易日（含 T）還原最高價的最大值；上市未滿 250 個交易日 K2、K4 判為資料不足。
- 漲停：行情來源沒有官方漲停價，一律用替代門檻：未還原收盤 ÷ 前一日未還原收盤 − 1 ≥ 9.5%。
- 最新月營收年增＝生效日（次月 10 日）起延用、超過 45 個交易日沒有新資料視為無值（與 App 的 as-of 規則相同）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from pipeline.evidence import indicators as ind
from pipeline.momentum_flow.data import FlowData
from pipeline.momentum_flow.params import PARAMS
from pipeline.momentum_flow.signals import window_any

PASS, FAIL, NA = 1, 0, -1
K_NAMES = ["K1", "K2", "K3", "K4", "K5", "K6"]
K_LABELS = {"K1": "相對強度", "K2": "中長期動能", "K3": "族群動能", "K4": "趨勢與位置", "K5": "非投機", "K6": "流動性"}
LEVELS = {1: "A", 2: "B", 3: "C"}


@dataclass
class Panels:
    rs: np.ndarray
    pr1m: np.ndarray
    pr3m: np.ndarray
    pr12m: np.ndarray
    r63: np.ndarray
    gm63: np.ndarray  # 主族群 3M 中位數（對齊到個股）
    ma60: np.ndarray
    h250: np.ndarray
    limit_count: np.ndarray
    value20: np.ndarray
    yoy: np.ndarray  # 最新月營收年增（as-of）
    yoy_avg3: np.ndarray  # 最新月之前 3 個月年增的平均（任一無值＝NaN）
    level: np.ndarray  # (T, C) int8：0 非候選、1 A、2 B、3 C
    ref: np.ndarray  # 漲多投信買在窗口內觸發（顯示用）
    k: np.ndarray  # (6, T, C) int8 三態
    passed: np.ndarray  # (T, C) bool：候選且 K1–K6 全符合
    yoy_lists_ok: np.ndarray  # (T,) 注意／處置名單可用


def cross_pct(x: np.ndarray) -> np.ndarray:
    """App 個股頁的橫斷面百分位：(平均名次 − 0.5) ÷ 有效檔數 × 100（indicators.cross_percentile 同一公式）。"""
    df = pd.DataFrame(x)
    ranks = df.rank(axis=1, method="average")
    counts = df.notna().sum(axis=1)
    return np.asarray((ranks.sub(0.5).div(counts.replace(0, np.nan), axis=0) * 100).where(df.notna()).to_numpy())


def group_medians(fd: FlowData, r63: np.ndarray, min_members: int) -> np.ndarray:
    """主族群 3M 中位數，對齊到每一檔（沒有主族群＝NaN）。"""
    pos = {c: i for i, c in enumerate(fd.codes)}
    out = np.full(r63.shape, np.nan)
    by_group: dict[str, list[int]] = {}
    for c, g in fd.group_of.items():
        if c in pos:
            by_group.setdefault(g, []).append(pos[c])
    for g, owners in by_group.items():
        idx = [pos[c] for c in fd.members.get(g, []) if c in pos]
        if not idx:
            continue
        sub = r63[:, idx]
        cnt = np.isfinite(sub).sum(axis=1)
        med = np.full(sub.shape[0], np.nan)
        ok = cnt >= min_members
        if ok.any():  # 只對有足夠成員的列取中位數（避免全 NaN 列的 RuntimeWarning）
            med[ok] = np.nanmedian(np.where(np.isfinite(sub[ok]), sub[ok], np.nan), axis=1)
        out[:, owners] = med[:, None]
    return out


def tri(cond: np.ndarray, avail: np.ndarray) -> np.ndarray:
    return np.where(avail, cond.astype(np.int8), np.int8(NA)).astype(np.int8)


def compute(fd: FlowData, sig: dict[str, Any], params: dict[str, Any] | None = None) -> Panels:
    p = params or PARAMS
    T, C = fd.T, fd.C
    close = fd.close
    w = p["windows"]
    with np.errstate(invalid="ignore", divide="ignore"):
        rs_raw = sum(wt * ind.ret(close, n) for n, wt in zip(p["rs_windows"], p["rs_weights"], strict=True))
        rs = cross_pct(np.asarray(rs_raw))
        pr1m = cross_pct(ind.ret(close, int(w["1M"])))
        r63 = ind.ret(close, int(w["3M"]))
        pr3m = cross_pct(r63)
        pr12m = cross_pct(ind.ret(close, int(w["12M"])))
        gm63 = group_medians(fd, r63, int(p["group_min_members"]))
        ma60 = ind.ma(close, int(p["ma_short"]))
        h250 = ind.rolling(fd.high, int(p["k4_high_days"]), "max")
        prev_raw = ind.shift(fd.raw_close, 1)
        limit_up = (fd.raw_close / prev_raw - 1 >= p["k5_limit_up_pct"] / 100) & np.isfinite(prev_raw)
        limit_count = ind.rolling(limit_up.astype(float), int(p["k5_limit_days"]), "sum")
        value20 = ind.rolling(np.nan_to_num(fd.value, nan=0.0), int(p["k6_days"]), "mean")
    rf = sig["rev_features"]
    max_age = int(p["revenue_max_age"])
    yoy = ind.revenue_asof(rf, "yoy", T, fd.codes, max_age)
    rf2 = rf.copy()
    yoy3 = rf2.groupby("code")["yoy"].shift(3)
    span = pd.PeriodIndex(rf2["ym"].astype(str), freq="M")
    months = span.year * 12 + span.month
    rf2["_m"] = months
    ok3 = (rf2["_m"] - rf2.groupby("code")["_m"].shift(3)) == 3
    rf2["yoy_avg3"] = ((rf2["yoy1"] + rf2["yoy2"] + yoy3) / 3).where(ok3)
    yoy_avg3 = ind.revenue_asof(rf2, "yoy_avg3", T, fd.codes, max_age)

    n_win = int(p["window_days"])
    a_win = window_any(sig["a"], n_win)
    b_win = window_any(sig["b"], n_win)
    ref_win = window_any(sig["ref"], n_win)
    with np.errstate(invalid="ignore"):
        c_cond = (rs >= p["c_rs_min"]) & (yoy > 0)
    pool = fd.universe
    level = np.zeros((T, C), dtype=np.int8)
    level[pool & a_win] = 1
    level[pool & b_win & (level == 0)] = 2
    level[pool & c_cond & (level == 0)] = 3

    lists_ok = np.zeros(T, dtype=bool)
    if fd.lists_from:
        lists_ok = np.asarray(fd.dates) >= fd.lists_from
    listed_ok = fd.listed >= int(p["listed_min_days"])
    lo = np.where(level == 1, float(p["k1_rs_min_a"]), float(p["k1_rs_min"]))
    with np.errstate(invalid="ignore"):
        k1 = tri((rs >= lo) & (rs <= p["k1_rs_max"]), np.isfinite(rs))
        k2 = tri((pr12m >= p["k2_pr12m"]) & (pr3m >= p["k2_pr3m"]), listed_ok & np.isfinite(pr12m) & np.isfinite(pr3m))
        k3 = tri((gm63 > 0) & (r63 > gm63), np.isfinite(gm63) & np.isfinite(r63))
        k4 = tri(
            (close > ma60) & (close >= p["k4_high_ratio"] * h250),
            listed_ok & np.isfinite(ma60) & np.isfinite(h250) & np.isfinite(close),
        )
        k5 = tri(
            ~fd.in_disposition & ~fd.in_attention & (limit_count < p["k5_limit_up_max"]),
            lists_ok[:, None] & np.isfinite(limit_count),
        )
        k6 = tri(value20 >= p["k6_value_min"], np.isfinite(value20))
    k = np.stack([k1, k2, k3, k4, k5, k6])
    passed = (level > 0) & np.all(k == PASS, axis=0)
    return Panels(
        rs=rs,
        pr1m=pr1m,
        pr3m=pr3m,
        pr12m=pr12m,
        r63=r63,
        gm63=gm63,
        ma60=ma60,
        h250=h250,
        limit_count=limit_count,
        value20=value20,
        yoy=yoy,
        yoy_avg3=yoy_avg3,
        level=level,
        ref=ref_win,
        k=k,
        passed=passed,
        yoy_lists_ok=lists_ok,
    )
