"""1.3／1.4 事件研究引擎：進出場、成本、跌停鎖死、三種報酬、首次觸發去重。

慣例：訊號列 t（該列收盤後產生訊號）→ 進場 e＝t+1 開盤（還原價）；出場＝進場後第 N 個交易日（e+N）開盤。
- 進場日開盤 ≥ 前一日收盤 +9.5% → 開盤即漲停，排除並計入「無法進場」；進場日停牌（無開盤價或無量）也無法進場。
- 開盤 ≥ 前一日收盤 +5% → 標示跳空（主結果納入，另列「排除跳空 ≥ 5%」變體）。
- 出場日跌停鎖死（最高價 ≤ 前一日收盤 −9.5%，整天都在跌停價）或停牌 → 順延到下一個可成交日的開盤；
  統計跌停鎖死次數與額外損失（順延後的出場價 ÷ 原出場日開盤價 − 1）。之後都無法成交（下市）→ 以最後收盤出場並標示。
- 成本：手續費 0.1425% × 0.6 買賣各一次、證交稅 0.3%（本評估不含 ETF）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config


def cost_rates() -> tuple[float, float]:
    c = config.costs()
    fee = float(c["commission"]["rate"]) * float(c["commission"]["discount"])
    return fee, float(c["tax"]["stock"])


def net_return(gross: np.ndarray | float, fee: float, tax: float) -> Any:
    """淨報酬 =（1 + 毛報酬）×（1 − 賣出手續費 − 證交稅）÷（1 + 買進手續費）− 1。"""
    return (1 + gross) * (1 - fee - tax) / (1 + fee) - 1


def _fwd_extreme(a: np.ndarray, h: int, fn: str) -> np.ndarray:
    """out[e] = fn(a[e : e+h])（向前看 h 列，含 e；NaN 略過）。"""
    rev = pd.DataFrame(a[::-1])
    r = rev.rolling(h, min_periods=1)
    out = (r.min() if fn == "min" else r.max()).to_numpy()[::-1]
    return np.asarray(out)


@dataclass
class Market:
    """所有事件共用的市場資料與預先計算的出場價。"""

    dates: list[str]
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    universe: np.ndarray
    bench: np.ndarray  # 報酬指數（或加權指數）
    bench_is_tr: bool
    regime_up: np.ndarray  # (T,) 加權指數在 240 日線上
    trend_up: np.ndarray  # (T,) 加權指數近 60 日上漲
    quarter_end: np.ndarray  # (T,) 每季最後 10 個交易日
    limit_up_pct: float
    gap_pct: float
    limit_down_pct: float
    horizons: list[int]
    official_delisted: np.ndarray | None = None  # (C,) v3 M1：官方終止上市櫃（不含轉上市），資料期間內已下市
    etf: dict[str, dict[str, np.ndarray]] | None = None  # v3 M2：0050、00631L 還原開盤／收盤（買進持有基準）

    def __post_init__(self) -> None:
        T, C = self.open.shape
        self.fee, self.tax = cost_rates()
        prev = np.vstack([np.full((1, C), np.nan), self.close[:-1]])
        with np.errstate(invalid="ignore", divide="ignore"):
            self.open_gap = self.open / prev - 1
            day_high_move = self.high / prev - 1
        self.tradable = np.isfinite(self.open) & (np.nan_to_num(self.volume) > 0)
        self.locked = self.tradable & (np.nan_to_num(day_high_move, nan=0.0) <= self.limit_down_pct / 100)
        self.limit_up_open = self.tradable & (np.nan_to_num(self.open_gap, nan=0.0) >= self.limit_up_pct / 100)
        self.gap = self.tradable & (np.nan_to_num(self.open_gap, nan=0.0) >= self.gap_pct / 100)
        sellable = self.tradable & ~self.locked
        # next_sell[i, c]：i（含）之後第一個可以賣出的交易日；沒有 → T
        nxt = np.full((T + 1, C), T, dtype=np.int32)
        for i in range(T - 1, -1, -1):
            nxt[i] = np.where(sellable[i], i, nxt[i + 1])
        self.next_sell = nxt
        # 最後一個有收盤價的交易日（下市時以最後收盤出場）
        last = np.full(C, -1, dtype=np.int64)
        fin = np.isfinite(self.close)
        any_fin = fin.any(axis=0)
        last[any_fin] = T - 1 - np.argmax(fin[::-1][:, any_fin], axis=0)
        self.last_close_row = last
        self.fmin = {h: _fwd_extreme(self.low, h, "min") for h in self.horizons}
        self.fmax = {h: _fwd_extreme(self.high, h, "max") for h in self.horizons}
        self.market_mean = {h: self._market_mean(h) for h in self.horizons}

    # ------------------------------------------------------------------ 出場
    def exits(self, e: np.ndarray, c: np.ndarray, h: int) -> dict[str, np.ndarray]:
        """向量化：每筆 (進場列 e, 股票 c) 持有 h 日的出場列、出場價、鎖死、下市。"""
        T = len(self.dates)
        x = e + h
        ok = x < T
        xi = np.where(ok, x, T - 1)
        act = self.next_sell[xi, c]
        act = np.where(ok, act, T)
        has = act < T
        act_c = np.where(has, act, 0)
        px = np.where(has, self.open[act_c, c], np.nan)
        # 之後都無法成交：以最後一個收盤價出場。官方終止上市櫃者標為下市（delisted）；
        # 其他（資料結束時仍停牌、官方名單沒有）標為 halted，同樣以最後收盤出場
        stuck = ok & ~has
        off = self.official_delisted[c] if self.official_delisted is not None else np.ones(c.size, dtype=bool)
        delisted = stuck & off
        lr = self.last_close_row[c]
        dl_px = np.where(lr >= 0, self.close[np.maximum(lr, 0), c], np.nan)
        px = np.where(stuck, dl_px, px)
        act = np.where(stuck, np.maximum(lr, e), act)
        locked = ok & self.locked[xi, c]
        nominal = self.open[xi, c]
        with np.errstate(invalid="ignore", divide="ignore"):
            lock_loss = np.where(locked & has, px / nominal - 1, np.nan)
        return {
            "row": act,
            "px": px,
            "ok": ok,
            "locked": locked,
            "lock_loss": lock_loss,
            "delisted": delisted,
            "halted": stuck & ~delisted,
        }

    def _market_mean(self, h: int) -> np.ndarray:
        """同一進場日、同一持有期、universe 內全部股票（訊號日 t＝e−1 在 universe、進場日可進場）的平均淨報酬。"""
        T, C = self.open.shape
        out = np.full(T, np.nan)
        cols = np.arange(C)
        for e in range(1, T - h):
            m = self.universe[e - 1] & self.tradable[e] & ~self.limit_up_open[e]
            if not m.any():
                continue
            c = cols[m]
            ex = self.exits(np.full(c.size, e), c, h)
            with np.errstate(invalid="ignore", divide="ignore"):
                g = ex["px"] / self.open[e, c] - 1
            g = g[np.isfinite(g)]
            if g.size:
                out[e] = float(np.mean(net_return(g, self.fee, self.tax)))
        return out

    def etf_return(self, code: str, e: np.ndarray, x: np.ndarray, at_close: np.ndarray) -> np.ndarray:
        """v3 M2：可投資基準（0050、00631L）同一段期間的買進持有報酬（還原價、含息、不扣成本）：
        進場日開盤 → 出場日開盤（與事件同一個時點）；事件以最後收盤出場（下市、停牌）時用同一天的收盤。"""
        T = len(self.dates)
        s = (self.etf or {}).get(code)
        if s is None:
            return np.full(e.size, np.nan)
        xi = np.clip(x, 0, T - 1)
        p1 = np.where(at_close, s["close"][xi], s["open"][xi])
        with np.errstate(invalid="ignore", divide="ignore"):
            return p1 / s["open"][np.clip(e, 0, T - 1)] - 1

    def bench_return(self, e: np.ndarray, x: np.ndarray) -> np.ndarray:
        """指數報酬：進場前一日收盤（≈ 進場開盤）到出場前一日收盤（≈ 出場開盤）。"""
        b0 = self.bench[np.clip(e - 1, 0, None)]
        b1 = self.bench[np.clip(x - 1, 0, None)]
        with np.errstate(invalid="ignore", divide="ignore"):
            return b1 / b0 - 1


def market(ev: Any, universe: np.ndarray, cfg: dict[str, Any]) -> Market:
    tx = pd.Series(ev.taiex)
    tr = pd.Series(ev.taiex_tr)
    use_tr = bool(tr.notna().mean() > 0.95)
    st = cfg["stats"]
    ma = tx.rolling(int(st["regime_ma"]), min_periods=int(st["regime_ma"])).mean()
    regime = (tx > ma).to_numpy()
    trend = (tx > tx.shift(int(st["trend_days"]))).to_numpy()
    return Market(
        dates=ev.dates,
        open=ev.open,
        high=ev.high,
        low=ev.low,
        close=ev.close,
        volume=ev.volume,
        universe=universe,
        bench=(tr if use_tr else tx).to_numpy(dtype=float),
        bench_is_tr=use_tr,
        regime_up=regime,
        trend_up=trend,
        quarter_end=quarter_end_mask(ev.dates, int(st["quarter_end_days"])),
        limit_up_pct=float(cfg["entry"]["limit_up_pct"]),
        gap_pct=float(cfg["entry"]["gap_pct"]),
        limit_down_pct=float(cfg["entry"]["limit_down_pct"]),
        horizons=[int(h) for h in cfg["horizons"]],
        official_delisted=official_mask(ev),
        etf=getattr(ev, "etf", None) or None,
    )


# v3 M2 四種基準 → 事件表的超額欄位：(a) 同日等權 universe（主要，判定用）、(b) 加權報酬指數、(c) 0050、(d) 00631L
BENCH_COLS = {"ew": "exc_mkt", "tr": "exc_idx", "0050": "exc_0050", "00631L": "exc_00631L"}
BENCH_LABELS = {"ew": "等權", "tr": "加權報酬", "0050": "0050", "00631L": "00631L"}
BOOT_BENCH = ("ew", "0050")  # bootstrap 區間只對 (a)、(c) 計算


def official_mask(ev: Any) -> np.ndarray | None:
    """(C,)：官方終止上市櫃日期在資料期間內（含最後一日）。沒有名單資料時為 None（沿用 v2：無法成交即視為下市）。"""
    dd = getattr(ev, "delist_date", None)
    if not dd:
        return None
    end = ev.dates[-1]
    return np.array([bool(dd.get(c)) and dd[c] <= end for c in ev.codes])


def quarter_end_mask(dates: list[str], n: int) -> np.ndarray:
    """每季（3、6、9、12 月）最後 n 個交易日為 True（投信季底作帳期間）。"""
    s = pd.Series(pd.to_datetime(dates))
    q = s.dt.to_period("Q")
    rank_from_end = s.groupby(q).cumcount(ascending=False)
    return (rank_from_end < n).to_numpy()


# ------------------------------------------------------------------ 事件
def events_from_mask(mask: np.ndarray, universe: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(T, C) 訊號 → 訊號列與股票索引；只收訊號日在 universe 內的。"""
    t, c = np.nonzero(mask & universe)
    return t.astype(np.int64), c.astype(np.int64)


def evaluate(mk: Market, t: np.ndarray, c: np.ndarray, h: int) -> pd.DataFrame:
    """每筆訊號（未去重）的進出場與三種報酬。無法進場的列 status='limit_up'／'suspended'，未到期 'pending'。"""
    T = len(mk.dates)
    e = t + 1
    valid_e = e < T
    e_c = np.where(valid_e, e, T - 1)
    status = np.full(t.size, "ok", dtype=object)
    status[~valid_e] = "pending"
    sus = valid_e & ~mk.tradable[e_c, c]
    lu = valid_e & ~sus & mk.limit_up_open[e_c, c]
    status[sus] = "suspended"
    status[lu] = "limit_up"
    ex = mk.exits(e_c, c, h)
    status[(status == "ok") & ~ex["ok"]] = "pending"
    entry = mk.open[e_c, c]
    with np.errstate(invalid="ignore", divide="ignore"):
        gross = ex["px"] / entry - 1
        mae = np.minimum(mk.fmin[h][e_c, c], ex["px"]) / entry - 1
        mfe = np.maximum(mk.fmax[h][e_c, c], ex["px"]) / entry - 1
    net = net_return(gross, mk.fee, mk.tax)
    bench = mk.bench_return(e_c, ex["row"])
    mkt = mk.market_mean[h][e_c]
    stuck = ex["delisted"] | ex["halted"]
    b0050 = mk.etf_return("0050", e_c, ex["row"], stuck)
    b631 = mk.etf_return("00631L", e_c, ex["row"], stuck)
    df = pd.DataFrame(
        {
            "t": t,
            "c": c,
            "e": e,
            "x": ex["row"],
            "status": status,
            "net": net,
            "gross": gross,
            "exc_idx": net - bench,
            "exc_mkt": net - mkt,
            "exc_0050": net - b0050,
            "exc_00631L": net - b631,
            "mae": mae,
            "mfe": mfe,
            "locked": ex["locked"],
            "lock_loss": ex["lock_loss"],
            "delisted": ex["delisted"],
            "halted": ex["halted"],
            "gap": valid_e & mk.gap[e_c, c],
        }
    )
    ok = df["status"] == "ok"
    df.loc[ok & ~np.isfinite(df["net"]), "status"] = "no_price"
    return df


def dedupe(df: pd.DataFrame) -> pd.DataFrame:
    """首次觸發：同一檔在持有期間內（到出場日之前）的訊號略過；出場日（含）之後的訊號才再計入。

    只對可進場（status='ok'）的訊號去重；無法進場的訊號不佔用持有期間。
    """
    ok = df[df["status"] == "ok"].sort_values(["c", "t"])
    keep = np.zeros(len(ok), dtype=bool)
    last_c, busy_until = -1, -1
    for i, (c, t, x) in enumerate(zip(ok["c"].to_numpy(), ok["t"].to_numpy(), ok["x"].to_numpy(), strict=True)):
        if c != last_c:
            last_c, busy_until = c, -1
        if t >= busy_until:
            keep[i] = True
            busy_until = x
    return ok[keep].sort_values(["e", "c"]).reset_index(drop=True)


def annotate(df: pd.DataFrame, mk: Market) -> pd.DataFrame:
    """加上環境欄位（依訊號日 t）：年份、大盤年線、60 日趨勢、季底作帳。"""
    out = df.copy()
    d = np.asarray(mk.dates)
    out["date"] = d[out["t"].to_numpy()]
    out["year"] = [s[:4] for s in out["date"]]
    out["regime_up"] = mk.regime_up[out["t"].to_numpy()]
    out["trend_up"] = mk.trend_up[out["t"].to_numpy()]
    out["quarter_end"] = mk.quarter_end[out["t"].to_numpy()]
    return out
