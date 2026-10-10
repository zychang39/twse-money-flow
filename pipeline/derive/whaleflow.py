"""族群大戶週流向（2026-10-10）：持股市值 ≥ 5,000 萬的集保戶每週淨增減的金額，依官方產業與主要細產業加總（億元）。

每一檔、每一週 w 與前一週 w0 比較（METHODOLOGY §4.7.7）：
1. 門檻股數 T＝min_value ÷ w0 的收盤價（原始價）。前後兩週用同一個 T：股價上漲不會讓中實戶自動「升級」成大戶。
2. 大戶股數＝Σ 分級股數 × 權重：分級下限 ≥ T 的權重 1、上限 ≤ T 的權重 0；T 落在分級內時，假設該級的人在股數區間內
   均勻分布，權重＝(上限² − T²) ÷ (上限² − 下限²)。最高一級（1,000 張以上）一律算大戶：T 超過 1,000 張
   （股價低於 50 元）時集保分級切不開，等於用千張大戶代替（low＝1）。
3. 流向＝(本週大戶占比 − 上週大戶占比) × 本週集保總股數 × 本週收盤價。用占比相減，除權、可轉債轉換讓每一級的股數
   一起變多時不會算成大戶增加；集保總股數單週變動超過 max_share_change 的那一週不計（除權、增資、減資）。
4. 族群＝成員流向加總，一檔只算一次：官方產業、主要細產業（每檔的第一個細產業）。只算普通股。

限制：集保的大戶包含外資保管帳戶、ETF、政府基金，不等於單一主力；集保資料日的持股反映 T+2 交割。
"""

from __future__ import annotations

import logging
from itertools import pairwise
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock
from pipeline.derive.export import arr, write_json

if TYPE_CHECKING:
    from pipeline.derive.build import Panels
    from pipeline.derive.sectors import Layers

log = logging.getLogger(__name__)

LEVELS = list(range(1, 16))
TOTAL = 17
YI = 1e8  # 億元
PRICE_FILL = 5  # 集保資料日沒有收盤（停牌）時，往前找幾個交易日


def settings() -> dict[str, Any]:
    h = config.ui().get("holders", {})
    v = h.get("value_whale", {})
    return {
        "min_value": float(v.get("min_value", 5e7)),
        "weeks": int(v.get("weeks", 13)),
        "max_share_change": float(v.get("max_share_change", 0.03)),
        "breakpoints": [
            int(b) for b in h.get("breakpoints", [1, 5, 10, 15, 20, 30, 40, 50, 100, 200, 400, 600, 800, 1000])
        ],
    }


def level_bounds(breakpoints: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """分級 1–15 的股數區間（下限, 上限）；邊界以張 × 1,000 計，分級 15 的上限為無限大。"""
    edges = [0.0, *(b * 1000.0 for b in breakpoints)]
    return np.array(edges), np.array([*edges[1:], np.inf])


def level_weights(threshold: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """每檔（列）每一級（欄）算進大戶的比例；最高一級一律 1。"""
    t = np.asarray(threshold, dtype=float)[:, None]
    w = (lo[None, :] >= t).astype(float)
    inside = (lo[None, :] < t) & (hi[None, :] > t) & np.isfinite(hi)[None, :]
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = (hi[None, :] ** 2 - t**2) / (hi[None, :] ** 2 - lo[None, :] ** 2)
    w = np.where(inside, frac, w)
    w[:, -1] = 1.0
    return w


def price_at(close: pd.DataFrame, day: str, codes: pd.Index) -> pd.Series:
    """集保資料日（或往前 PRICE_FILL 個交易日內最近一天）的收盤價。"""
    pos = int(close.index.searchsorted(day, side="right")) - 1
    if pos < 0:
        return pd.Series(np.nan, index=codes)
    win = close.iloc[max(0, pos - PRICE_FILL) : pos + 1].reindex(columns=codes)
    return win.ffill().iloc[-1]


def stock_flows(
    tdcc: pd.DataFrame, close: pd.DataFrame, cfg: dict[str, Any] | None = None
) -> tuple[list[str], pd.DataFrame, pd.DataFrame]:
    """回傳（週別, 流向（元；代號 × weeks[1:]）, 千張代替旗標（同形狀））。週別含第一個比較基準週。"""
    cfg = cfg or settings()
    if tdcc.empty or not {"date", "code", "level", "shares"} <= set(tdcc.columns):
        return [], pd.DataFrame(), pd.DataFrame()
    t = tdcc[tdcc["level"].isin([*LEVELS, TOTAL])].copy()
    t["code"] = t["code"].astype(str)
    t = t[t["code"].map(is_common_stock)]
    t["date"] = t["date"].astype(str)
    grid = t.pivot_table(index=["date", "code"], columns="level", values="shares", aggfunc="last")
    weeks = sorted(grid.index.get_level_values(0).unique())[-(cfg["weeks"] + 1) :]
    if len(weeks) < 2:
        return weeks, pd.DataFrame(), pd.DataFrame()
    lo, hi = level_bounds(cfg["breakpoints"])
    flows: dict[str, pd.Series] = {}
    lows: dict[str, pd.Series] = {}
    for w0, w1 in pairwise(weeks):
        a, b = grid.loc[w0], grid.loc[w1]
        codes = a.index.intersection(b.index)
        a, b = a.reindex(codes), b.reindex(codes)
        sa = a.reindex(columns=LEVELS).fillna(0.0).to_numpy()
        sb = b.reindex(columns=LEVELS).fillna(0.0).to_numpy()
        tot_a = a.get(TOTAL, pd.Series(np.nan, index=codes)).to_numpy(dtype=float)
        tot_b = b.get(TOTAL, pd.Series(np.nan, index=codes)).to_numpy(dtype=float)
        tot_a = np.where(np.isfinite(tot_a) & (tot_a > 0), tot_a, sa.sum(1))
        tot_b = np.where(np.isfinite(tot_b) & (tot_b > 0), tot_b, sb.sum(1))
        p0 = price_at(close, w0, codes).to_numpy(dtype=float)
        p1 = price_at(close, w1, codes).to_numpy(dtype=float)
        with np.errstate(invalid="ignore", divide="ignore"):
            thr = cfg["min_value"] / p0
            wgt = level_weights(np.where(np.isfinite(thr), thr, np.inf), lo, hi)
            frac_a = (sa * wgt).sum(1) / tot_a
            frac_b = (sb * wgt).sum(1) / tot_b
            change = np.abs(tot_b / tot_a - 1)
        ok = (p0 > 0) & (p1 > 0) & (tot_a > 0) & (tot_b > 0) & (change <= cfg["max_share_change"])
        flow = np.where(ok, (frac_b - frac_a) * tot_b * p1, np.nan)
        flows[w1] = pd.Series(flow, index=codes)
        lows[w1] = pd.Series(np.where(ok, (thr > hi[-2]).astype(float), np.nan), index=codes)
    return weeks, pd.DataFrame(flows), pd.DataFrame(lows)


def group_sums(flows: pd.DataFrame, group_of: dict[str, str]) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series]:
    """族群 × 週的流向加總（至少一檔有資料才有值）、有資料的檔數、成員數（有集保資料的普通股）。"""
    g = pd.Series(group_of, dtype=object).reindex(flows.index).dropna()
    f = flows.loc[g.index]
    sums = f.groupby(g).sum(min_count=1)
    counts = f.notna().groupby(g).sum()
    return sums, counts.astype(int), g.value_counts()


def build(p: Panels, tdcc: pd.DataFrame, layers: Layers, cfg: dict[str, Any] | None = None) -> dict[str, Any] | None:
    cfg = cfg or settings()
    weeks, flows, lows = stock_flows(tdcc, p.close, cfg)
    if flows.empty:
        return None
    groups = layers.groups
    fine_primary = {c: f[0] for c, f in layers.fine_of.items() if f and f[0] in groups and groups[f[0]].listed}
    official = {c: g for c, g in layers.official_of.items() if g in groups and groups[g].listed}
    out: dict[str, Any] = {
        "date": weeks[-1],
        "weeks": weeks,
        "min_value": cfg["min_value"],
        "max_share_change": cfg["max_share_change"],
    }
    for key, mapping in (("official", official), ("fine", fine_primary)):
        sums, counts, members = group_sums(flows, mapping)
        codes_of = pd.Series(mapping, dtype=object).reindex(flows.index).dropna()
        layer = {}
        for gid in sums.index:
            grp = groups[gid]
            layer[gid] = {
                "name": grp.name,
                "path": grp.path,
                "m": int(members.get(gid, 0)),
                "n": [int(v) for v in counts.loc[gid].to_numpy()],
                "f": arr(sums.loc[gid].to_numpy() / YI, 2),
                # 成員：算進這個族群的普通股（細產業只算主要細產業）
                "c": sorted(codes_of.index[codes_of == gid].tolist()),
            }
        out[key] = layer
    covered = flows.loc[flows.index.intersection(list(official))]
    out["total"] = arr(covered.sum(min_count=1).to_numpy() / YI, 2)
    stocks: dict[str, list[Any]] = {}
    for c in covered.index:
        row = flows.loc[c].to_numpy() / YI
        if not np.isfinite(row).any():
            continue
        low = lows.loc[c].dropna()
        stocks[c] = [p.names.get(c, c), arr(row, 2), int(low.iloc[-1]) if low.size else 0]
    out["stocks"] = stocks
    return out


def write_output(p: Panels, tdcc: pd.DataFrame, layers: Layers, out: Path) -> dict[str, Any]:
    """sector_flows.json；沒有兩週以上的集保資料時不輸出（前端顯示資料累積中）。"""
    data = build(p, tdcc, layers)
    path = out / "sector_flows.json"
    if data is None:
        path.unlink(missing_ok=True)
        return {"sector_flows_weeks": 0}
    write_json(path, data)
    return {"sector_flows_weeks": len(data["weeks"]) - 1, "sector_flows_stocks": len(data["stocks"])}
