"""報酬拆解：市場 Beta、因子與產業、Alpha（探索 › 報酬拆解；2026-10-27；定義見 METHODOLOGY §4.12）。

三層（Sharpe 1964 CAPM、Jensen 1968、Fama–French 1993／2015、Carhart 1997）：
  R_i − R_f = α_i + β_i (R_m − R_f) + b_ind · IND_i + Σ_k b_k F_k + ε_i
- 市場：發行量加權股價「報酬指數」（含息），無風險利率為設定的固定年利率（`config/ui.yml` attribution.rf_annual）。
- 因子：台股自建的多空因子（每月底依特徵分組，下個月等權報酬）：
  規模 SMB、價值 HML（淨值市價比）、動能 UMD（12−1 個月報酬）、獲利 RMW（ROE，財報公布期限後才用）、低波動 LV。
  一律 2×3 分組（市值中位數 × 特徵 30／70 百分位）、組內等權——台股市值高度集中，市值加權會讓單一權值股主導因子（課文「尺會失真」）。
- 產業：IND_i＝同業籃子 − 大盤。同業籃子不是族群輪動的分組：候選來自官方產業與細產業，再依「扣掉大盤後的週報酬相關」
  挑出最貼近的 5～10 家等權（課文：同產業的公司股價常常一起漲跌；同業籃子至少 5 家，避免單一家公司出事尺就歪）。
- Alpha：期間總超額報酬 − 市場 − 產業 − 因子（＝α 加上殘差；單一期間分不出能力和運氣，另附 t 值與所需年數）。

只用收盤後已知的資料（月底分組、財報依法定公布期限生效）；同業籃子以最新資料挑選後回頭量歷史（事後歸因，不是訊號）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock

log = logging.getLogger(__name__)

FACTORS = ["smb", "hml", "umd", "rmw", "lv"]
FACTOR_LABELS = {
    "mkt": "市場",
    "ind": "產業（同業籃子）",
    "smb": "規模（小型 − 大型）",
    "hml": "價值（便宜 − 昂貴）",
    "umd": "動能（強勢 − 弱勢）",
    "rmw": "獲利（高 ROE − 低 ROE）",
    "lv": "低波動（低 − 高）",
}
STYLE_SIZE = ["小型", "中型", "大型"]
STYLE_VALUE = ["成長", "中性", "價值"]


def settings() -> dict[str, Any]:
    return dict(config.load("ui")["attribution"])


def demo_settings() -> dict[str, Any]:
    """示範資料（12 檔、約 15 個月）：放寬檔數與月數門檻，讓本機與 e2e 看得到畫面；數字沒有意義。"""
    return {
        **settings(),
        "min_universe": 6,
        "min_corner": 1,
        "min_months": 8,
        "peer_min": 3,
        "peer_min_corr": -1.0,
        "peer_cover": 0.5,
        "liquidity_pctile": 0,
    }


# ------------------------------------------------------------------ 日期
def month_ends(dates: pd.Index) -> tuple[list[int], list[str]]:
    """每個月最後一個交易日的位置與「YYYY-MM」。"""
    s = pd.Series(range(len(dates)), index=pd.DatetimeIndex(dates))
    last = s.groupby(s.index.to_period("M")).max()
    return [int(v) for v in last.to_numpy()], [str(p) for p in last.index]


@dataclass
class FactorSet:
    labels: list[str]  # 月份（每個月的報酬期間＝上個月最後交易日 → 本月最後交易日）
    end_dates: list[str]
    partial: bool  # 最後一個月是否尚未結束
    rf: np.ndarray
    mkt: np.ndarray  # 市場報酬（未扣無風險）
    f: dict[str, np.ndarray]
    ret: pd.DataFrame  # 個股月報酬（月 × 代號）
    style: pd.DataFrame  # 期初的風格組（0–8；月 × 代號，NaN＝不在樣本內）
    style_ret: np.ndarray  # 9 組等權月報酬（月 × 9）
    universe: pd.DataFrame  # 期初是否在樣本內（流動性）
    counts: dict[str, list[int]] = field(default_factory=dict)


def _pct_rank_breaks(x: pd.Series, lo: float, hi: float) -> tuple[float, float]:
    v = x.dropna()
    return float(v.quantile(lo)), float(v.quantile(hi))


def _two_by_three(
    ret: pd.Series, size: pd.Series, med: float, char: pd.Series, lo: float, hi: float, corner: int = 5
) -> float:
    """2×3：小／大 × 低／中／高；回傳（小高＋大高）/2 −（小低＋大低）/2。組內等權；任一角落少於 corner 檔 → NaN。"""
    ok = ret.notna() & size.notna() & char.notna()
    r, s, c = ret[ok], size[ok], char[ok]
    small = s <= med
    out = {}
    for sz, mask in (("S", small), ("B", ~small)):
        for k, sel in (("L", c <= lo), ("H", c >= hi)):
            m = mask & sel
            if int(m.sum()) < corner:
                return float("nan")
            out[sz + k] = float(r[m].mean())
    return (out["SH"] + out["BH"]) / 2 - (out["SL"] + out["BL"]) / 2


def build_factors(
    adj: pd.DataFrame,
    close: pd.DataFrame,
    value: pd.DataFrame,
    shares: dict[str, float],
    pb: pd.DataFrame,
    roe: pd.DataFrame,
    market: pd.Series,
    cfg: dict[str, Any] | None = None,
) -> FactorSet:
    """台股月因子。adj／close／value／pb／roe：交易日 × 代號（同一個 index）；market：報酬指數（同一個 index）。"""
    cfg = cfg or settings()
    codes = [c for c in adj.columns if is_common_stock(str(c))]
    adj, close, value = adj[codes], close.reindex(columns=codes), value.reindex(columns=codes)
    pb, roe = pb.reindex(index=adj.index, columns=codes), roe.reindex(index=adj.index, columns=codes)
    pos, labels = month_ends(adj.index)
    # 最新一天的下一個營業日還在同一個月 → 最後一個月還沒過完（進行中；不放進迴歸）
    last_day = pd.Timestamp(adj.index[-1])
    partial = (last_day + pd.offsets.BDay(1)).month == last_day.month
    me = adj.iloc[pos]
    ret = me / me.shift(1) - 1
    ret.index = labels
    m_me = market.reindex(adj.index).ffill().iloc[pos]
    mkt = (m_me / m_me.shift(1) - 1).to_numpy()
    ends = pd.DatetimeIndex(adj.index[pos])
    days = np.r_[np.nan, np.diff(ends.values).astype("timedelta64[D]").astype(float)]
    rf = (1 + float(cfg["rf_annual"])) ** (days / 365.0) - 1

    daily = adj.pct_change(fill_method=None)
    vol = daily.rolling(252, min_periods=200).std()
    liq = value.rolling(60, min_periods=40).mean()
    mcap = close * pd.Series(shares).reindex(codes)
    n = len(pos)
    f = {k: np.full(n, np.nan) for k in FACTORS}
    style = pd.DataFrame(np.nan, index=labels, columns=codes)
    style_ret = np.full((n, 9), np.nan)
    universe = pd.DataFrame(False, index=labels, columns=codes)
    counts: dict[str, list[int]] = {k: [0] * n for k in ["universe", *FACTORS]}
    lo, hi = float(cfg["break_low"]), float(cfg["break_high"])
    min_univ, corner = int(cfg.get("min_universe", 100)), int(cfg.get("min_corner", 5))
    for j in range(1, n):
        t = pos[j - 1]  # 期初（上個月最後交易日）
        r_next = ret.iloc[j]
        lq = liq.iloc[t]
        ok = r_next.notna() & mcap.iloc[t].notna() & lq.notna()
        if ok.sum() < min_univ:
            continue
        floor = float(lq[ok].quantile(float(cfg["liquidity_pctile"]) / 100))
        ok &= lq >= floor
        universe.iloc[j] = ok.to_numpy()
        counts["universe"][j] = int(ok.sum())
        size = mcap.iloc[t].where(ok)
        med = float(size.median())
        chars = {
            "hml": (1 / pb.iloc[t]).where((pb.iloc[t] > 0) & ok),
            "umd": (me.iloc[j - 2] / me.iloc[j - 13] - 1).where(ok) if j >= 13 else pd.Series(np.nan, index=codes),
            "rmw": roe.iloc[t].where(ok),
            "lv": (-vol.iloc[t]).where(ok),  # 波動低＝特徵值高
        }
        rr = r_next.where(ok)
        f["smb"][j] = -_size_spread(rr, size, med, chars, min_univ)
        for k, ch in chars.items():
            if int(ch.notna().sum()) < min_univ:
                continue
            a, b = _pct_rank_breaks(ch, lo, hi)
            f[k][j] = _two_by_three(rr, size, med, ch, a, b, corner)
            counts[k][j] = int(ch.notna().sum())
        # 風格組（規模三分 × 價值三分）：期初分組，三把尺的「同風格籃子」
        bm = chars["hml"]
        if int(bm.notna().sum()) >= min_univ:
            s1, s2 = _pct_rank_breaks(size, 1 / 3, 2 / 3)
            v1, v2 = _pct_rank_breaks(bm, 1 / 3, 2 / 3)
            si = np.where(size <= s1, 0, np.where(size <= s2, 1, 2))
            vi = np.where(bm <= v1, 0, np.where(bm <= v2, 1, 2))
            g = pd.Series(si * 3 + vi, index=codes).where(size.notna() & bm.notna())
            style.iloc[j] = g.to_numpy()
            for gi in range(9):
                m = g == gi
                if int(m.sum()) >= corner:
                    style_ret[j, gi] = float(rr[m].mean())
    return FactorSet(
        labels=labels,
        end_dates=[str(pd.Timestamp(d).date()) for d in ends],
        partial=bool(partial),
        rf=rf,
        mkt=mkt,
        f=f,
        ret=ret,
        style=style,
        style_ret=style_ret,
        universe=universe,
        counts=counts,
    )


def _size_spread(rr: pd.Series, size: pd.Series, med: float, chars: dict[str, pd.Series], min_univ: int = 100) -> float:
    """SMB（Fama–French 2015 的做法）：每個特徵的 2×3 裡大型三組平均 − 小型三組平均，再對特徵平均；回傳 大 − 小。"""
    vals = []
    for ch in chars.values():
        ok = rr.notna() & size.notna() & ch.notna()
        if int(ok.sum()) < min_univ:
            continue
        a, b = _pct_rank_breaks(ch[ok], 0.3, 0.7)
        small = size[ok] <= med
        cuts = [ch[ok] <= a, (ch[ok] > a) & (ch[ok] < b), ch[ok] >= b]
        s = [float(rr[ok][small & c].mean()) for c in cuts]
        bg = [float(rr[ok][~small & c].mean()) for c in cuts]
        if any(np.isnan(x) for x in s + bg):
            continue
        vals.append(np.mean(bg) - np.mean(s))
    return float(np.mean(vals)) if vals else float("nan")


# ------------------------------------------------------------------ 同業籃子
@dataclass
class Peers:
    codes: list[str]
    corr: list[float]
    cross: list[bool]  # 不在官方產業／細產業候選內（只依股價連動挑出）
    kind: str  # peer＝同業籃子；weak＝連動夠強的不到 5 家，取候選中最接近的（解讀要打折）


def weekly_residuals(adj: pd.DataFrame, weeks: int, min_cover: float) -> pd.DataFrame:
    """近 weeks 週的週報酬扣掉「全市場等權平均」（各自估 β）後的殘差；涵蓋率不足的股票不列。

    用等權平均而不是加權指數：台積電這類權值股本身就是大半個指數，扣掉指數後跟每一家都變成負相關，挑不出同業。
    """
    idx = pd.DatetimeIndex(adj.index)
    wk = pd.Series(range(len(idx)), index=idx).groupby(idx.to_period("W-FRI")).max().to_numpy()[-(weeks + 1) :]
    p = adj.iloc[wk]
    r = (p / p.shift(1) - 1).iloc[1:]
    r = r.loc[:, r.notna().mean() >= min_cover]
    rm = r.mean(axis=1, skipna=True).to_numpy()
    x = rm - np.nanmean(rm)
    out = {}
    for c in r.columns:
        y = r[c].to_numpy()
        ok = ~np.isnan(y) & ~np.isnan(rm)
        if ok.sum() < min(20, len(y) - 2):
            continue
        yy = y[ok] - y[ok].mean()
        beta = float((x[ok] * yy).sum() / ((x[ok] ** 2).sum() or np.nan))
        e = np.full(len(y), np.nan)
        e[ok] = yy - beta * x[ok]
        out[c] = e
    return pd.DataFrame(out, index=r.index)


def select_peers(
    resid: pd.DataFrame, candidates: dict[str, set[str]], cfg: dict[str, Any] | None = None
) -> dict[str, Peers]:
    """每一檔：候選（同官方產業或同細產業）中扣掉大盤後相關最高的 5～10 家；不足 5 家由全市場依相關補齊並標示。"""
    cfg = cfg or settings()
    min_corr, lo, hi = float(cfg["peer_min_corr"]), int(cfg["peer_min"]), int(cfg["peer_max"])
    codes = list(resid.columns)
    z = resid.fillna(0.0).to_numpy()
    cnt = (~resid.isna()).to_numpy().astype(float)
    z = z - (z.sum(0) / np.maximum(cnt.sum(0), 1))
    z = np.where(cnt > 0, z, 0.0)
    norm = np.sqrt((z**2).sum(0))
    norm[norm == 0] = np.nan
    c = (z.T @ z) / np.outer(norm, norm)
    np.fill_diagonal(c, np.nan)
    pos = {k: i for i, k in enumerate(codes)}
    out: dict[str, Peers] = {}
    for code, cand in candidates.items():
        if code not in pos:
            continue
        i = pos[code]
        row = c[i]
        inside = [
            (codes[j], float(row[j])) for j in (pos[x] for x in cand if x in pos and x != code) if row[j] >= min_corr
        ]
        inside.sort(key=lambda t: -t[1])
        chosen = inside[:hi]
        cross: list[bool] = [False] * len(chosen)
        if len(chosen) < lo:
            order = np.argsort(-np.nan_to_num(row, nan=-9))
            have = {x for x, _ in chosen}
            for j in order:
                if len(chosen) >= lo or not np.isfinite(row[j]) or row[j] < min_corr:
                    break
                if codes[j] in have:
                    continue
                chosen.append((codes[j], float(row[j])))
                cross.append(True)
        if len(chosen) >= lo:
            out[code] = Peers([x for x, _ in chosen], [round(v, 3) for _, v in chosen], cross, "peer")
            continue
        # 連動夠強的不到 5 家：改取候選中相關最高的 5～10 家，標示「連動偏弱」（尺的貼合度低，解讀要打折）
        weak = sorted(
            ((x, float(row[pos[x]])) for x in cand if x in pos and x != code and np.isfinite(row[pos[x]])),
            key=lambda t: -t[1],
        )[:hi]
        if len(weak) >= lo:
            out[code] = Peers([x for x, _ in weak], [round(v, 3) for _, v in weak], [False] * len(weak), "weak")
    return out


# ------------------------------------------------------------------ 迴歸
def ols(y: np.ndarray, x: np.ndarray) -> dict[str, Any] | None:
    """y＝a＋x·b；回傳係數、t 值、R²、殘差標準差。"""
    n, k = x.shape
    if n < k + 3:
        return None
    xx = np.column_stack([np.ones(n), x])
    coef, *_ = np.linalg.lstsq(xx, y, rcond=None)
    e = y - xx @ coef
    dof = n - k - 1
    s2 = float(e @ e) / dof
    try:
        cov = s2 * np.linalg.inv(xx.T @ xx)
    except np.linalg.LinAlgError:
        return None
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    tss = float(((y - y.mean()) ** 2).sum())
    return {
        "coef": coef,
        "t": np.where(se > 0, coef / se, np.nan),
        "r2": 1 - float(e @ e) / tss if tss > 0 else float("nan"),
        "sd": float(np.sqrt(s2)),
        "n": n,
    }


def _r(v: float | None, d: int = 4) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def _arr(a: np.ndarray | pd.Series, d: int = 5) -> list[float | None]:
    return [_r(float(v), d) for v in np.asarray(a, dtype=float)]


def stock_report(
    code: str,
    fs: FactorSet,
    peers: Peers | None,
    rulers: dict[str, pd.Series],
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """單一股票：月報酬、同業籃子、各把尺的貼合度（R²）、CAPM 與多因子迴歸。rulers：其他尺的月報酬（官方產業、主要細產業）。"""
    cfg = cfg or settings()
    if code not in fs.ret.columns:
        return None
    r = fs.ret[code].to_numpy(dtype=float)
    n = len(r)
    peer_r = np.full(n, np.nan)
    if peers and peers.codes:
        cols = [c for c in peers.codes if c in fs.ret.columns]
        peer_r = fs.ret[cols].mean(axis=1, skipna=True).to_numpy(dtype=float).copy()
        cnt = fs.ret[cols].notna().sum(axis=1).to_numpy()
        peer_r[cnt < max(3, int(cfg["peer_min"]) // 2)] = np.nan
    complete = np.arange(n) < (n - 1 if fs.partial else n)
    y = r - fs.rf
    mk = fs.mkt - fs.rf
    peer_x = peer_r - fs.rf
    # 因子資料起點不同（價值、獲利要等淨值比與財報）：樣本不足 min_months 時，先拿掉最晚才有資料的因子
    used = [k for k in FACTORS if np.nanstd(fs.f[k]) > 1e-9]  # 沒有變化的因子（資料不足）不放進迴歸
    base_ok = complete & np.isfinite(y) & np.isfinite(mk) & np.isfinite(peer_x)
    while True:
        fac = np.column_stack([fs.f[k] for k in used]) if used else np.zeros((n, 0))
        ok = base_ok & np.isfinite(fac).all(axis=1)
        idx = np.where(ok)[0][-int(cfg["window_months"]) :]
        if len(idx) >= int(cfg["min_months"]) or not used:
            break
        used.remove(max(used, key=lambda k: int(np.argmax(np.isfinite(fs.f[k])))))
    capm = full = None
    ind = np.full(n, np.nan)
    if len(idx) >= int(cfg["min_months"]):
        # 第一層：CAPM（β 就是課文的市場 Beta）
        capm = ols(y[idx], mk[idx, None])
        # 產業：同業籃子扣掉它自己的市場 Beta（課文進階試算：產業領先大盤的一部分只是波動本來就比較大）
        pc = ols(peer_x[idx], mk[idx, None])
        if capm is not None and pc is not None:
            ind = peer_x - float(pc["coef"][1]) * mk
            # 第二層：扣掉市場那一段後，再用產業與因子解釋（β 固定為 CAPM 的值，層與層不互相搶功勞）
            y2 = y - float(capm["coef"][1]) * mk
            full = ols(y2[idx], np.column_stack([ind[idx], fac[idx]]))
            if full is not None:
                tss = float(((y[idx] - y[idx].mean()) ** 2).sum())
                full["r2"] = 1 - (full["sd"] ** 2) * (full["n"] - fac.shape[1] - 2) / tss if tss > 0 else float("nan")
    fit = {}
    okm = complete & np.isfinite(y) & np.isfinite(mk)
    for name, series in {
        "market": fs.mkt,
        "peer": peer_r,
        **{k: v.to_numpy(dtype=float) for k, v in rulers.items()},
    }.items():
        x = np.asarray(series, dtype=float) - fs.rf
        m = okm & np.isfinite(x)
        mi = np.where(m)[0][-int(cfg["window_months"]) :]
        res = ols(y[mi], x[mi, None]) if len(mi) >= int(cfg["min_months"]) else None
        fit[name] = None if res is None else {"r2": _r(res["r2"], 3), "n": res["n"]}
    style_g = fs.style[code].to_numpy(dtype=float)

    def pack(res: dict[str, Any] | None, names: list[str]) -> dict[str, Any] | None:
        if res is None:
            return None
        return {
            "alpha": _r(res["coef"][0], 5),
            "alpha_t": _r(res["t"][0], 2),
            "b": {k: _r(res["coef"][i + 1], 3) for i, k in enumerate(names)},
            "t": {k: _r(res["t"][i + 1], 2) for i, k in enumerate(names)},
            "r2": _r(res["r2"], 3),
            "resid_sd": _r(res["sd"], 5),
            "n": res["n"],
        }

    return {
        "code": code,
        "r": _arr(r),
        "peer": _arr(peer_r),
        "ind": _arr(ind),
        "style": [None if not np.isfinite(v) else int(v) for v in style_g],
        "peers": None
        if peers is None
        else {"kind": peers.kind, "codes": peers.codes, "corr": peers.corr, "cross": peers.cross},
        "fit": fit,
        "window": [fs.labels[int(idx[0])], fs.labels[int(idx[-1])]] if len(idx) else None,
        "capm": pack(capm, ["mkt"]),
        "full": pack(full, ["ind", *used]),
        "dropped": [k for k in FACTORS if k not in used],
    }


def factors_json(fs: FactorSet, cfg: dict[str, Any]) -> dict[str, Any]:
    cover = {k: next((fs.labels[i] for i, v in enumerate(fs.f[k]) if np.isfinite(v)), None) for k in FACTORS}
    return {
        "months": fs.labels,
        "end_dates": fs.end_dates,
        "partial": fs.partial,
        "rf_annual": float(cfg["rf_annual"]),
        "rf": _arr(fs.rf, 6),
        "mkt": _arr(fs.mkt),
        "f": {k: _arr(v) for k, v in fs.f.items()},
        "start": cover,
        "labels": FACTOR_LABELS,
        "style_labels": [f"{s}・{v}" for s in STYLE_SIZE for v in STYLE_VALUE],
        "style_ret": [_arr(fs.style_ret[:, k]) for k in range(9)],
        "universe": fs.counts["universe"],
        "window_months": int(cfg["window_months"]),
        "min_months": int(cfg["min_months"]),
        "peer_min": int(cfg["peer_min"]),
        "peer_max": int(cfg["peer_max"]),
        "peer_min_corr": float(cfg["peer_min_corr"]),
        "peer_weeks": int(cfg["peer_weeks"]),
        "liquidity_pctile": float(cfg["liquidity_pctile"]),
    }


def equal_weight_monthly(ret: pd.DataFrame, members: list[str], exclude: str) -> pd.Series:
    cols = [c for c in members if c in ret.columns and c != exclude]
    if len(cols) < 3:
        return pd.Series(np.nan, index=ret.index)
    return ret[cols].mean(axis=1, skipna=True)


def build(
    *,
    adj: pd.DataFrame,
    close: pd.DataFrame,
    value: pd.DataFrame,
    shares: dict[str, float],
    pb: pd.DataFrame,
    roe: pd.DataFrame,
    market: pd.Series,
    industries: dict[str, str],
    fine_of: dict[str, list[str]],
    out: Path,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """寫出 attribution/factors.json 與 attribution/{代號}.json（普通股）。"""
    from pipeline.derive.export import write_json

    cfg = cfg or settings()
    base = out / "attribution"
    if base.exists():
        for old in base.glob("*.json"):
            old.unlink()
    fs = build_factors(adj, close, value, shares, pb, roe, market, cfg)
    if len(fs.labels) < int(cfg["min_months"]) + 2:
        log.info("報酬拆解：月數不足（%d）", len(fs.labels))
        return {"stocks": 0}
    write_json(base / "factors.json", factors_json(fs, cfg))
    resid = weekly_residuals(
        adj[[c for c in adj.columns if is_common_stock(str(c))]],
        int(cfg["peer_weeks"]),
        float(cfg.get("peer_cover", 0.9)),
    )
    by_ind: dict[str, set[str]] = {}
    by_fine: dict[str, set[str]] = {}
    codes = [c for c in fs.ret.columns]
    for c in codes:
        if industries.get(c):
            by_ind.setdefault(industries[c], set()).add(c)
        for g in fine_of.get(c) or []:
            by_fine.setdefault(g, set()).add(c)
    cands = {
        c: set(by_ind.get(industries.get(c) or "", set())).union(*[by_fine.get(g, set()) for g in fine_of.get(c) or []])
        for c in codes
    }
    peers = select_peers(resid, cands, cfg)
    n = 0
    for c in codes:
        rulers = {}
        if industries.get(c):
            rulers["official"] = equal_weight_monthly(fs.ret, sorted(by_ind[industries[c]]), c)
        fine = fine_of.get(c) or []
        if fine:
            rulers["fine"] = equal_weight_monthly(fs.ret, sorted(by_fine.get(fine[0], set())), c)
        rep = stock_report(c, fs, peers.get(c), rulers, cfg)
        if rep is None or not any(v is not None for v in rep["r"]):
            continue
        write_json(base / f"{c}.json", rep)
        n += 1
    log.info("報酬拆解：%d 檔、%d 個月（%s～%s）", n, len(fs.labels), fs.labels[0], fs.labels[-1])
    return {"stocks": n, "months": len(fs.labels), "start": fs.labels[0], "end": fs.labels[-1]}
