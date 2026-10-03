"""資金環境燈號的歷史重建與驗證（2026-10 改版；METHODOLOGY「資金環境驗證」）。

- light_history：用與 market_env 相同的門檻，逐日重建 5 項燈號（只用當日以前已公布的資料）。
  · 外資台指期淨未平倉：T 日盤後（約 15:00）公布 → T 日可用。
  · 台幣匯率 20 日變化：期交所每日匯率，T 日可用。
  · 大盤與年線：T 日收盤。
  · M1B／M2：央行約在次月下旬公布 → 保守起見資料月份 M 從 M+2 月 1 日起才採用。
  · 美國 10 年期殖利率：美國 D 日收盤在台北 D+1 早上才知道 → 只用 D < T 的資料。
- env_state：與前端 envState.ts 相同規則（任一項風險 → 保守；沒有風險且有利 ≥ 3 → 積極；其餘中性）。
- validate：狀態占比，以及各狀態之後 20／40 個交易日的加權報酬指數報酬（T 日收盤後才知道狀態，
  由 T+1 收盤起算到 T+1+h 收盤），平均與 Newey-West（Bartlett，lag＝h）t。
- percentile：外資期貨淨未平倉近 250 個交易日百分位。
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.derive.export import clean

STATES = ("conservative", "neutral", "aggressive")
STATE_LABEL = {"conservative": "保守", "neutral": "中性", "aggressive": "積極"}
HORIZONS = (20, 40)
MAX_CONSERVATIVE_SHARE = 0.6
T_THRESHOLD = 2.0
MIN_N = 20


def percentile(series: pd.Series, window: int = 250) -> float | None:
    """最新值在最近 window 個觀測值（含最新）中的百分位：≤ 最新值的比例 × 100。觀測值不足 window → None。"""
    s = series.dropna()
    if len(s) < window:
        return None
    w = s.iloc[-window:]
    return clean(float((w <= w.iloc[-1]).mean() * 100), 1)


def _asof(s: pd.Series, dates: list[str], *, strict: bool = False, max_gap: int | None = None) -> pd.Series:
    """把不規則日期的序列對齊到交易日：取 ≤ T（strict：< T）的最後一筆；max_gap：最多往前幾個日曆日。"""
    s = s.dropna().sort_index()
    if s.empty:
        return pd.Series(np.nan, index=dates)
    idx = pd.to_datetime(pd.Series(s.index.astype(str)))
    vals = s.to_numpy(dtype=float)
    t = pd.to_datetime(pd.Series(dates))
    pos = np.searchsorted(idx.to_numpy(), t.to_numpy(), side="left" if strict else "right") - 1
    out = np.where(pos >= 0, vals[np.clip(pos, 0, None)], np.nan)
    if max_gap is not None:
        gap = (t.to_numpy() - idx.to_numpy()[np.clip(pos, 0, None)]).astype("timedelta64[D]").astype(float)
        out = np.where((pos >= 0) & (gap <= max_gap), out, np.nan)
    return pd.Series(out, index=dates)


def _states(values: pd.Series, green: Any, red: Any) -> pd.Series:
    out = pd.Series([("yellow" if ok else None) for ok in values.notna()], index=values.index, dtype=object)
    out[green(values).fillna(False).astype(bool)] = "green"
    out[red(values).fillna(False).astype(bool)] = "red"
    return out


def light_history(ds: Any, dates: list[str], taiex: pd.Series, net: pd.Series) -> pd.DataFrame:
    """逐日 5 項燈號（green/yellow/red；資料不足為 None）。net：外資台指期淨未平倉（日期索引）。"""
    env = config.thresholds()["market_env"]
    cols: dict[str, pd.Series] = {}
    # 1) 外資台指期淨未平倉（T 日盤後公布；最多容許 5 個日曆日沒有新資料）
    f = env["futures_net_oi"]
    v = _asof(net, dates, max_gap=5)
    cols["futures"] = _states(v, lambda x: x >= f["bullish_above"], lambda x: x <= f["bearish_below"])
    # 2) 台幣匯率 20 日變化
    fx = ds.table("fx")
    if not fx.empty:
        s = fx.drop_duplicates("date").set_index("date")["usd_twd"].sort_index().dropna()
        chg = (s / s.shift(20) - 1) * 100
        c = env["usd_twd_change_20d_pct"]
        cols["fx"] = _states(
            _asof(chg, dates, max_gap=7), lambda x: x <= c["inflow_below"], lambda x: x >= c["outflow_above"]
        )
    else:
        cols["fx"] = pd.Series(None, index=dates, dtype=object)
    # 3) 大盤與年線
    t = taiex.reindex(dates).astype(float)
    gap = (t / t.rolling(240, min_periods=240).mean() - 1) * 100
    band = env["index_vs_ma240_pct"]["neutral_band"]
    cols["ma240"] = _states(gap, lambda x: x > band, lambda x: x < -band)
    # 4) M1B／M2（資料月份 M 從 M+2 月 1 日起採用）
    money = ds.table("cbc_money")
    if not money.empty:
        m = money.dropna(subset=["m1b_yoy", "m2_yoy"]).sort_values("ym")
        avail = (pd.PeriodIndex(m["ym"].astype(str), freq="M") + 2).to_timestamp().strftime("%Y-%m-%d")
        gapm = pd.Series((m["m1b_yoy"] - m["m2_yoy"]).to_numpy(dtype=float), index=avail)
        gapm = gapm[~gapm.index.duplicated(keep="last")]
        b = env["m1b_m2_gap"]["bullish_above"]
        g = _asof(gapm, dates)
        cols["m1b"] = pd.Series(
            [None if v != v else ("green" if v > b else "red") for v in g.to_numpy(dtype=float)],
            index=dates,
            dtype=object,
        )
    else:
        cols["m1b"] = pd.Series(None, index=dates, dtype=object)
    # 5) 美國 10 年期殖利率 20 日變化（只用美國日期 < T）
    ust = ds.table("ust")
    if not ust.empty:
        s = ust.drop_duplicates("date").set_index("date")["y10"].sort_index().dropna()
        bp = (s - s.shift(20)) * 100
        c = env["us10y_change_20d_bp"]
        cols["ust"] = _states(
            _asof(bp, dates, strict=True, max_gap=7),
            lambda x: x <= c["easing_below"],
            lambda x: x >= c["tightening_above"],
        )
    else:
        cols["ust"] = pd.Series(None, index=dates, dtype=object)
    return pd.DataFrame(cols, index=dates)


def env_state(row: pd.Series) -> str | None:
    """envState.ts 的規則（config/ui.yml env_state）。全部未知 → None。"""
    cfg = config.load("ui").get("env_state", {})
    vals = [v for v in row.tolist() if v in ("green", "yellow", "red")]
    if not vals:
        return None
    if vals.count("red") >= int(cfg.get("conservative_min_red", 1)):
        return "conservative"
    if vals.count("green") >= int(cfg.get("aggressive_min_green", 3)):
        return "aggressive"
    return "neutral"


def hac(y: np.ndarray, x: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    """OLS 係數與 Newey-West（Bartlett 權重）共變異矩陣。"""
    xtx_inv = np.linalg.pinv(x.T @ x)
    beta = xtx_inv @ x.T @ y
    u = y - x @ beta
    xu = x * u[:, None]
    s = xu.T @ xu
    for k in range(1, min(lag, len(y) - 1) + 1):
        w = 1 - k / (lag + 1)
        g = xu[k:].T @ xu[:-k]
        s += w * (g + g.T)
    return beta, xtx_inv @ s @ xtx_inv


def forward_returns(tr: pd.Series, h: int) -> pd.Series:
    """T 日 → (TR[T+1+h] ÷ TR[T+1] − 1) × 100（%）。"""
    base = tr.shift(-1)
    return (tr.shift(-(1 + h)) / base - 1) * 100


def validate(states: pd.Series, tr: pd.Series) -> dict[str, Any]:
    """states：逐日狀態（5 項都有資料的日子）；tr：加權報酬指數（同一組日期索引）。"""
    st = states.dropna()
    if st.empty:
        return {
            "period": [None, None],
            "days": 0,
            "states": [],
            "show_conclusion": False,
            "reason": "資金指標歷史不足，無法驗證",
        }
    days = len(st)
    out_states: list[dict[str, Any]] = []
    diffs: dict[int, list[tuple[str, float, float]]] = {}
    for h in HORIZONS:
        r = forward_returns(tr.astype(float), h).reindex(st.index)
        ok = r.notna()
        y = r[ok].to_numpy(dtype=float)
        lab = st[ok].to_numpy()
        present = [s for s in STATES if (lab == s).sum() > 0]
        x = np.column_stack([(lab == s).astype(float) for s in present]) if present else np.zeros((len(y), 0))
        res: dict[str, dict[str, Any]] = {}
        if len(y) and present:
            beta, cov = hac(y, x, lag=h)
            for i, s in enumerate(present):
                se = float(np.sqrt(max(cov[i, i], 0)))
                res[s] = {
                    "mean": clean(float(beta[i]), 2),
                    "t": clean(float(beta[i] / se), 2) if se > 0 else None,
                    "n": int((lab == s).sum()),
                }
            if "conservative" in present:
                ci = present.index("conservative")
                for j, s in enumerate(present):
                    if s == "conservative" or res[s]["n"] < MIN_N or res["conservative"]["n"] < MIN_N:
                        continue
                    var = cov[ci, ci] + cov[j, j] - 2 * cov[ci, j]
                    d = float(beta[ci] - beta[j])
                    diffs.setdefault(h, []).append((s, d, d / float(np.sqrt(var)) if var > 0 else 0.0))
        for s in STATES:
            entry = next((e for e in out_states if e["state"] == s), None)
            if entry is None:
                entry = {"state": s, "share": clean(float((st == s).mean()), 4)}
                out_states.append(entry)
            entry[f"r{h}"] = res.get(s, {"mean": None, "t": None, "n": 0})
    share_c = float((st == "conservative").mean())
    sig = {h: [d for d in diffs.get(h, []) if d[1] < 0 and d[2] <= -T_THRESHOLD] for h in HORIZONS}
    show = share_c <= MAX_CONSERVATIVE_SHARE and all(sig[h] for h in HORIZONS)
    reasons = []
    if share_c > MAX_CONSERVATIVE_SHARE:
        reasons.append(f"保守占比 {share_c:.1%} 超過 {MAX_CONSERVATIVE_SHARE:.0%}")
    for h in HORIZONS:
        if not sig[h]:
            best = sorted(diffs.get(h, []), key=lambda d: d[2])
            txt = "、".join(f"相對{STATE_LABEL[s]} {d:+.2f}%（t {t:.2f}）" for s, d, t in best) or "其他狀態樣本不足"
            reasons.append(f"{h} 日：保守後報酬未顯著較低（{txt}；門檻 t ≤ −{T_THRESHOLD:g}）")
    reason = (
        "；".join(reasons)
        if reasons
        else f"保守占比 {share_c:.1%}；保守後 20、40 日報酬皆顯著低於其他狀態（Newey-West t ≤ −{T_THRESHOLD:g}）"
    )
    return {
        "period": [str(st.index[0]), str(st.index[-1])],
        "days": days,
        "states": out_states,
        "show_conclusion": bool(show),
        "reason": reason,
    }


def env_validation(ds: Any, dates: list[str], taiex: pd.Series, tr: pd.Series, net: pd.Series) -> dict[str, Any]:
    hist = light_history(ds, dates, taiex, net)
    full = hist.notna().all(axis=1)  # 5 項都有資料的日子才列入驗證
    states = hist[full].apply(env_state, axis=1)
    out = validate(states, tr.reindex(dates))
    out["method"] = (
        "逐日以相同門檻重建 5 項燈號（只用當日已公布的資料；M1B 資料月份後第 2 個月起採用、美債用前一日），"
        "5 項都有資料的交易日才列入；報酬為加權報酬指數由 T+1 收盤起算 20／40 個交易日，"
        f"t 為 Newey-West（lag＝期間長度）。結論顯示條件（事先指定）：保守占比 ≤ {MAX_CONSERVATIVE_SHARE:.0%}，"
        f"且 20 日與 40 日保守後平均報酬都比另一狀態低、差的 t ≤ −{T_THRESHOLD:g}"
    )
    return out
