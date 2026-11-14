"""順風檢查：風格 ETF 與類股當溫度計（探索 › 報酬拆解 › 順風檢查；2026-11-13；定義見 METHODOLOGY §4.12.2）。

依 Freddy〈法人級選股實戰〉單元 2「因子動能選股」、單元 3「類股輪動分析」的做法（只取方法，不轉載課文）：
- 每一類查兩個數字：自己過去 12 個月的含息報酬、同期大盤的含息報酬 →
  順風（自己賺錢且贏大盤）／中性（自己賺錢但輸大盤，或跟大盤幾乎一樣）／逆風（自己賠錢；贏大盤也不升級）。
- 風格：單元 2 對照表台股那一欄的 ETF（`config/ui.yml` attribution.tailwind.styles）。溫度計用 ETF 的還原價（含息）；
  掛牌前的期間以它追蹤的報酬指數補上（標示）。學術因子是多空組合，ETF 只有作多的那一半，中間隔著一層大盤，所以兩個數字都要看。
- 類股：台股沒有對應 11 個類股的 ETF，改用證交所的類股報酬指數（含息）；類股指數常被單一權值股主導，
  另附「排除最大權值股的等權籃子」（至少 5 家），兩個數字一起看。
- 一份順風不是兩份：風格 ETF 的類股權重（投信公布的持股）跟大盤並排，超配的類股若在順風名單上，風格的順風有一部分是類股在推；
  粗略的拆法（Brinson 配置效果的簡化）：Σ（ETF 權重 − 大盤權重）×（類股報酬 − 大盤報酬）。
- 個股的兩個狀態：所屬風格（特徵百分位 ≥ 門檻，或出現在那一檔風格 ETF 的持股裡）與所屬類股（官方產業 → 類股報酬指數）。

用途是排研究的優先順序與替報酬定位，不是進出場訊號；ETF 只是溫度計。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config

log = logging.getLogger(__name__)

STATES = ("tail", "neutral", "head")  # 順風／中性／逆風
SECTOR_SUFFIX = "類報酬指數"


def settings() -> dict[str, Any]:
    return dict(config.load("ui")["attribution"]["tailwind"])


def sector_key(industry: str | None) -> str | None:
    """官方產業名稱 → 類股名稱（「半導體業」→「半導體」、「水泥工業」→「水泥」）；ETF、存託憑證等不是類股。"""
    if not industry or industry in ("ETF", "存託憑證"):
        return None
    for suffix in ("工業", "業"):
        if industry.endswith(suffix) and len(industry) > len(suffix):
            return industry[: -len(suffix)]
    return industry


def state_of(r: float | None, rm: float | None, near_pp: float) -> str | None:
    """兩個數字 → 三種狀態。r、rm 為小數（0.2＝20%）；near_pp：跟大盤差不到幾個百分點算幾乎一樣（中性）。"""
    if r is None or rm is None or not np.isfinite(r) or not np.isfinite(rm):
        return None
    if r <= 0:
        return "head"
    return "tail" if (r - rm) * 100 > near_pp else "neutral"


def index_levels(index: pd.DataFrame, dates: list[str]) -> pd.DataFrame:
    """含息（報酬）指數的每日收盤：交易日 × 指數名稱。"""
    if index is None or index.empty:
        return pd.DataFrame(index=dates, dtype=float)
    t = index[index["kind"] == "return"] if "kind" in index.columns else index
    t = t.drop_duplicates(["date", "name"], keep="last")
    wide = t.pivot(index="date", columns="name", values="close")
    return wide.reindex(dates).astype(float)


def _fresh(s: pd.Series, stale_days: int) -> bool:
    """最後一筆離最新交易日不超過 stale_days 天（證交所停止公布的指數不再使用）。"""
    last = s.last_valid_index()
    if last is None:
        return False
    return (pd.Timestamp(s.index[-1]) - pd.Timestamp(last)).days <= stale_days


def splice(etf: pd.Series | None, idx: pd.Series | None) -> tuple[pd.Series | None, str | None, str]:
    """溫度計的每日序列：ETF 還原價；掛牌前以追蹤的報酬指數接上（在掛牌日對齊）。

    回傳（序列, ETF 第一個交易日, 來源）；來源：etf＝全程 ETF、spliced＝掛牌前用指數、index＝行情裡沒有這檔 ETF（示範資料）。
    """
    has_etf = etf is not None and etf.notna().any()
    has_idx = idx is not None and idx.notna().any()
    if not has_etf:
        return (idx.copy() if has_idx and idx is not None else None), None, "index"
    assert etf is not None
    first = str(etf.first_valid_index())
    out = etf.copy()
    k = int(np.argmax(etf.notna().to_numpy()))
    if has_idx and idx is not None and k > 0 and np.isfinite(idx.iloc[k]) and idx.iloc[:k].notna().any():
        out.iloc[:k] = (idx.iloc[:k] * (etf.iloc[k] / idx.iloc[k])).to_numpy()
        return out, first, "spliced"
    return out, first, "etf"


def trailing(s: pd.Series, months: int, end: int | None = None) -> float | None:
    """到第 end 個交易日（預設最新）為止、過去 months 個月的報酬：期末 ÷（期末往前推 months 個月當天或之前最近一筆）− 1。

    期末沒有值、或往前推的那一天之前沒有資料 → None（不拿舊值頂替）。
    """
    e = len(s) - 1 if end is None else end
    v = s.iloc[e]
    if not np.isfinite(v):
        return None
    start = pd.Timestamp(s.index[e]) - pd.DateOffset(months=months)
    head = s.iloc[: e + 1]
    prior = head[pd.DatetimeIndex(head.index) <= start].dropna()
    if prior.empty or prior.iloc[-1] <= 0:
        return None
    return float(v / prior.iloc[-1] - 1)


def _since(s: pd.Series, start: str, end: int | None = None) -> float | None:
    e = len(s) - 1 if end is None else end
    head = s.iloc[: e + 1]
    a = head[head.index <= start].dropna()
    if a.empty or not np.isfinite(head.iloc[-1]):
        return None
    return float(head.iloc[-1] / a.iloc[-1] - 1)


@dataclass
class Thermos:
    """溫度計的每日序列（含息）與說明。daily 的欄位：mkt、style:{key}、sector:{名稱}、etf:{代號}（對照用）。"""

    dates: list[str]
    daily: pd.DataFrame
    styles: list[dict[str, Any]] = field(default_factory=list)
    sectors: dict[str, str] = field(default_factory=dict)  # 類股名稱 → 指數名稱
    market_name: str = ""

    def col(self, key: str) -> pd.Series | None:
        return self.daily[key] if key in self.daily.columns else None


def build_thermos(
    adj: pd.DataFrame, index: pd.DataFrame, dates: list[str], names: dict[str, str], cfg: dict[str, Any] | None = None
) -> Thermos:
    cfg = cfg or settings()
    lv = index_levels(index, dates)
    stale = int(cfg["stale_days"])
    cols: dict[str, pd.Series] = {}
    mname = str(cfg["market"]["index"])
    if mname in lv.columns:
        cols["mkt"] = lv[mname]
    metf = str(cfg["market"].get("etf") or "")
    if metf and metf in adj.columns:
        cols[f"etf:{metf}"] = adj[metf]
    styles: list[dict[str, Any]] = []
    for st in cfg["styles"]:
        code = str(st["etf"])
        idx = lv[st["index"]] if st.get("index") in lv.columns else None
        s, first, source = splice(adj[code] if code in adj.columns else None, idx)
        if s is None or not _fresh(s, stale):
            styles.append({**st, "name": names.get(code, code), "source": None, "listed": first})
            continue
        cols[f"style:{st['key']}"] = s
        alt = str(st.get("alt") or "")
        if alt and alt in adj.columns:
            cols[f"etf:{alt}"] = adj[alt]
        styles.append(
            {
                **st,
                "name": names.get(code, code),
                "source": source,
                "listed": first,
                "start": str(s.first_valid_index()),
                "alt_name": names.get(alt) if alt else None,
            }
        )
    sectors: dict[str, str] = {}
    exclude = set(cfg.get("sector_exclude") or [])
    for name in lv.columns:
        if not str(name).endswith(SECTOR_SUFFIX):
            continue
        key = str(name)[: -len(SECTOR_SUFFIX)]
        if key in exclude or not _fresh(lv[name], stale):
            continue
        sectors[key] = str(name)
        cols[f"sector:{key}"] = lv[name]
    daily = pd.DataFrame(cols, index=dates) if cols else pd.DataFrame(index=dates, dtype=float)
    return Thermos(dates=dates, daily=daily, styles=styles, sectors=sectors, market_name=mname)


def period_returns(s: pd.Series | None, months: list[int], end: int | None = None) -> dict[str, float | None]:
    return {str(m): (None if s is None else _r(trailing(s, m, end))) for m in months}


def _r(v: float | None, d: int = 4) -> float | None:
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def prev_month_end(dates: list[str]) -> int | None:
    """上個月最後一個交易日的位置（跟上個月比：哪一類換了狀態）。"""
    cur = dates[-1][:7]
    for i in range(len(dates) - 1, -1, -1):
        if dates[i][:7] != cur:
            return i
    return None


# ------------------------------------------------------------------ 類股權重、超配
def market_weights(mcap: pd.Series, industries: dict[str, str], markets: dict[str, str]) -> dict[str, float]:
    """大盤（上市普通股）的類股權重（%）：市值加總。"""
    tot: dict[str, float] = {}
    for code, v in mcap.items():
        if not np.isfinite(v) or markets.get(str(code)) != "twse":
            continue
        k = sector_key(industries.get(str(code)))
        if k:
            tot[k] = tot.get(k, 0.0) + float(v)
    s = sum(tot.values())
    return {k: v / s * 100 for k, v in tot.items()} if s > 0 else {}


def etf_weights(holdings: pd.DataFrame, etf: str, industries: dict[str, str]) -> tuple[dict[str, float], str | None]:
    """風格 ETF 的類股權重（%，以股票部位為 100%）與持股日；沒有持股資料 →（{}, None）。"""
    if holdings is None or holdings.empty:
        return {}, None
    h = holdings[holdings["etf"].astype(str) == etf]
    if h.empty:
        return {}, None
    day = str(h["date"].max())
    h = h[h["date"].astype(str) == day]
    tot: dict[str, float] = {}
    for code, w in zip(h["code"].astype(str), h["weight"].astype(float), strict=True):
        k = sector_key(industries.get(code))
        if k and np.isfinite(w):
            tot[k] = tot.get(k, 0.0) + float(w)
    s = sum(tot.values())
    return ({k: v / s * 100 for k, v in tot.items()} if s > 0 else {}), day


def allocation(
    w: dict[str, float], wm: dict[str, float], sector_r: dict[str, float | None], rm: float | None
) -> float | None:
    """類股配置效果（小數）：Σ（ETF 權重 − 大盤權重）×（類股報酬 − 大盤報酬）；只算有報酬的類股。"""
    if rm is None or not w:
        return None
    tot = 0.0
    for k in set(w) | set(wm):
        rs = sector_r.get(k)
        if rs is None:
            continue
        tot += (w.get(k, 0.0) - wm.get(k, 0.0)) / 100 * (rs - rm)
    return tot


# ------------------------------------------------------------------ 個股的風格
def style_percentiles(chars: dict[str, pd.Series]) -> pd.DataFrame:
    """各特徵在樣本內的百分位（0–100；越高越屬於那一種風格）。chars：風格 key → 特徵值（越高越屬於）。"""
    out = {}
    for k, ch in chars.items():
        v = ch.dropna()
        if len(v) < 2:
            out[k] = pd.Series(np.nan, index=ch.index)
            continue
        out[k] = ((v.rank(method="average") - 0.5) / len(v) * 100).reindex(ch.index)
    return pd.DataFrame(out)


def main_style(pct: dict[str, float | None], held: dict[str, float], order: list[str], cut: float) -> str | None:
    """主要風格：特徵百分位 ≥ cut、或出現在那一檔風格 ETF 持股裡的風格中，百分位最高的；都沒有 → None。"""
    cand = [k for k in order if (pct.get(k) is not None and (pct[k] or 0) >= cut) or k in held]
    if not cand:
        return None
    return max(cand, key=lambda k: (pct.get(k) if pct.get(k) is not None else cut, -order.index(k)))


# ------------------------------------------------------------------ 輸出
def build(
    *,
    th: Thermos,
    adj: pd.DataFrame,
    mcap: pd.Series,
    industries: dict[str, str],
    markets: dict[str, str],
    names: dict[str, str],
    commons: list[str],
    holdings: pd.DataFrame | None,
    month_pos: list[int],
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """tailwind.json：大盤、五種風格、各類股的兩個數字與狀態（含上個月底的狀態）、風格 ETF 的類股超配。

    month_pos：報酬拆解的月底位置（factors.json 的 months 對齊），輸出各溫度計的月報酬（三把尺、同步性用）。
    """
    cfg = cfg or settings()
    months = [int(m) for m in cfg["months"]]
    near = float(cfg["near_pp"])
    dates = th.dates
    prev = prev_month_end(dates)
    mk = th.col("mkt")

    def monthly(s: pd.Series | None) -> list[float | None]:
        if s is None:
            return [None] * len(month_pos)
        p = s.ffill(limit=3).iloc[month_pos]
        return [_r(v, 5) for v in (p / p.shift(1) - 1).to_numpy(dtype=float)]

    def pack(s: pd.Series | None) -> dict[str, Any]:
        r = period_returns(s, months)
        st = state_of(r.get("12"), rm.get("12"), near)
        ps = (
            state_of(
                None if s is None or prev is None else trailing(s, 12, prev),
                None if mk is None or prev is None else trailing(mk, 12, prev),
                near,
            )
            if prev is not None
            else None
        )
        return {"r": r, "state": st, "prev": ps}

    rm = period_returns(mk, months)
    metf = str(cfg["market"].get("etf") or "")
    out: dict[str, Any] = {
        "date": dates[-1],
        "prev_date": dates[prev] if prev is not None else None,
        "months": months,
        "near_pp": near,
        "style_pct": float(cfg["style_pct"]),
        "top_weight_warn": float(cfg["top_weight_warn"]),
        "same_wind_corr": float(cfg["same_wind_corr"]),
        "market": {
            "name": th.market_name,
            "r": rm,
            "etf": None
            if th.col(f"etf:{metf}") is None
            else {"code": metf, "name": names.get(metf, metf), "r": period_returns(th.col(f"etf:{metf}"), months)},
        },
    }
    # 類股
    wm = market_weights(mcap, industries, markets)
    members: dict[str, list[str]] = {}
    for c in commons:
        if markets.get(c) == "twse" and np.isfinite(mcap.get(c, np.nan)):
            k = sector_key(industries.get(c))
            if k:
                members.setdefault(k, []).append(c)
    r12_stock = pd.Series({c: trailing(adj[c], 12) for c in commons if c in adj.columns}, dtype=float)
    sectors = []
    sector_r12: dict[str, float | None] = {}
    for key, iname in th.sectors.items():
        s = th.col(f"sector:{key}")
        item: dict[str, Any] = {"key": key, "index": iname, **pack(s), "m": monthly(s), "w": _r(wm.get(key), 2)}
        sector_r12[key] = item["r"].get("12")
        mem = members.get(key, [])
        item["n"] = len(mem)
        if mem:
            caps = mcap.reindex(mem).astype(float)
            top = str(caps.idxmax())
            item["top"] = {"code": top, "name": names.get(top, top), "w": _r(float(caps.max() / caps.sum() * 100), 1)}
            rest = r12_stock.reindex([c for c in mem if c != top]).dropna()
            if len(rest) >= int(cfg["basket_min"]):
                item["ex_top"] = {"r12": _r(float(rest.mean())), "n": len(rest)}
        sectors.append(item)
    # 風格
    styles = []
    for st in th.styles:
        key = str(st["key"])
        s = th.col(f"style:{key}")
        item = {
            "key": key,
            "label": st["label"],
            "etf": str(st["etf"]),
            "name": st.get("name"),
            "index": st.get("index"),
            "mix": st.get("mix"),
            "char": st.get("char"),
            "note": st.get("note"),
            "source": st.get("source"),
            "listed": st.get("listed"),
            "start": st.get("start"),
            **pack(s),
            "m": monthly(s),
        }
        if s is not None and item["r"].get("12") is None and st.get("start"):
            # 未滿 12 個月：改用有資料以來的同一段期間跟大盤比（暫定；資料滿 12 個月後自動換回）
            a, b = _since(s, str(st["start"])), (None if mk is None else _since(mk, str(st["start"])))
            item["since"] = {"start": st["start"], "r": _r(a), "rm": _r(b), "state": state_of(a, b, near)}
        alt = str(st.get("alt") or "")
        if alt and th.col(f"etf:{alt}") is not None:
            item["alt"] = {
                "code": alt,
                "name": st.get("alt_name") or alt,
                "r": period_returns(th.col(f"etf:{alt}"), months),
            }
        w, day = etf_weights(holdings if holdings is not None else pd.DataFrame(), str(st["etf"]), industries)
        if w:
            rows: list[dict[str, Any]] = sorted(
                (
                    {
                        "s": k,
                        "w": _r(w.get(k, 0.0), 1),
                        "wm": _r(wm.get(k, 0.0), 1),
                        "d": _r(w.get(k, 0.0) - wm.get(k, 0.0), 1),
                    }
                    for k in set(w) | set(wm)
                ),
                key=lambda x: -float(x["d"] or 0),
            )
            alloc = allocation(w, wm, sector_r12, rm.get("12"))
            item["weights"] = {"date": day, "rows": rows, "alloc": _r(alloc)}
        styles.append(item)
    out["styles"] = styles
    out["sectors"] = sectors
    return out


def holdings_by_code(holdings: pd.DataFrame | None, styles: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """代號 → {風格 key: 在那一檔風格 ETF 的權重 %}（最新一份持股）。"""
    out: dict[str, dict[str, float]] = {}
    if holdings is None or holdings.empty:
        return out
    for st in styles:
        h = holdings[holdings["etf"].astype(str) == str(st["etf"])]
        if h.empty:
            continue
        h = h[h["date"].astype(str) == str(h["date"].max())]
        for code, w in zip(h["code"].astype(str), h["weight"].astype(float), strict=True):
            if np.isfinite(w):
                out.setdefault(code, {})[str(st["key"])] = round(float(w), 2)
    return out
