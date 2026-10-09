"""資料層：唯讀取用既有模組，組成本功能需要的面板（列＝交易日、欄＝股票）。

- 行情、還原價、成交金額、法人、月營收訊號列：evidence.data.from_dataset（與指標效度評估同一套還原價與生效日規則）。
- 股票池（規格第一節）：普通股（4 碼、非 0 開頭；載入時已排除 ETF、ETN、受益憑證、存託憑證 -DR；特別股為 5 碼代號不在內；
  興櫃不在行情來源內）、當日有收盤價、不是全額交割（變更交易）或管理股票（evidence.data.full_delivery_mask 逐日標記）。
- 主族群：derive.sectors.build_layers 的細產業層。優先沿用既有資料的主要細產業標示（Layers.fine_of 第一個，
  個股頁「細產業」第一個就是它）；沒有標示時取成員數最少的細產業（成員數相同取名稱排序第一）。
- 注意／處置名單：原始列的公告日。處置以「公告日 ≤ t ≤ 處置迄日」標記（含 T 日當日公告者）；注意以當日公告標記。
  名單可用的起始日＝兩種名單都有資料的第一天（注意名單自 2023-06 起）；之前的日子 K5 判為資料不足。
- 月營收：生效日＝次月 10 日（法定期限）；官方沒有各公司逐月公布日的歷史，沿用既有定義（evidence.data.revenue_table）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.store import DataStore
from pipeline.derive import dataset as dsmod
from pipeline.derive import sectors
from pipeline.derive.dataset import industry_map
from pipeline.evidence import data as evdata
from pipeline.evidence import universe as evuni


@dataclass
class FlowData:
    dates: list[str]
    codes: list[str]
    names: dict[str, str]
    markets: dict[str, str]
    close: np.ndarray  # (T, C) 還原收盤
    raw_close: np.ndarray  # 未還原收盤
    high: np.ndarray  # 還原最高
    open: np.ndarray  # 還原開盤
    value: np.ndarray  # 成交金額（元）
    volume: np.ndarray
    trust: np.ndarray
    taiex: np.ndarray  # (T,) 加權股價指數
    universe: np.ndarray  # (T, C) 股票池
    listed: np.ndarray  # (T, C) 上市櫃天數
    in_disposition: np.ndarray  # (T, C) 處置（公告日起到迄日）
    in_attention: np.ndarray  # (T, C) 當日注意名單
    lists_from: str | None  # 注意／處置名單都可用的第一天
    group_of: dict[str, str]  # 代號 → 主族群 id
    group_names: dict[str, str]  # 族群 id → 名稱
    members: dict[str, list[str]]  # 族群 id → 全部成員（含本身）
    revenue: pd.DataFrame  # evidence.data.revenue_table：code, ym, revenue, yoy, row
    ev_universe: np.ndarray  # (T, C) 指標效度評估的 universe（策略庫訊號用）
    ev: Any = field(repr=False, default=None)

    @property
    def T(self) -> int:
        return len(self.dates)

    @property
    def C(self) -> int:
        return len(self.codes)


def primary_groups(layers: Any, codes: list[str]) -> tuple[dict[str, str], dict[str, str], dict[str, list[str]]]:
    """每檔的主族群；回傳 (代號→族群 id, 族群 id→名稱, 族群 id→成員)。

    1. 既有資料的主要細產業標示（sectors.Layers.fine_of 的第一個；個股頁「細產業」第一個就是它）。
    2. 沒有標示時：所屬細產業中成員數最少者；成員數相同取名稱排序第一（再取 id）。
    """
    want = set(codes)
    names: dict[str, str] = {}
    members: dict[str, list[str]] = {}
    best: dict[str, tuple[int, str, str]] = {}
    for g in layers.groups.values():
        if g.layer != "fine":
            continue
        names[g.id] = g.name
        members[g.id] = list(g.members)
        key = (len(g.members), g.name, g.id)
        for c in g.members:
            if c in want and (c not in best or key < best[c]):
                best[c] = key
    group_of = {c: k[2] for c, k in best.items()}
    for c, lst in (getattr(layers, "fine_of", None) or {}).items():
        if c in want and lst and lst[0] in names:
            group_of[c] = lst[0]
    used = set(group_of.values())
    return group_of, {g: names[g] for g in used}, {g: members[g] for g in used}


def lists_masks(ds: Any, dates: list[str], codes: list[str]) -> tuple[np.ndarray, np.ndarray, str | None]:
    """處置（公告日 ≤ t ≤ 迄日）與當日注意名單的 (T, C) 標記，以及兩種名單都可用的第一天。"""
    T, C = len(dates), len(codes)
    pos = {c: i for i, c in enumerate(codes)}
    arr = np.asarray(dates)
    disp = np.zeros((T, C), dtype=bool)
    attn = np.zeros((T, C), dtype=bool)
    starts: list[str] = []
    d = getattr(ds, "disposition", pd.DataFrame())
    if not d.empty:
        ann = d["announce_date"] if "announce_date" in d.columns else pd.Series([None] * len(d), index=d.index)
        rows = pd.DataFrame({"code": d["code"].astype(str), "a": ann, "start": d["start"], "end": d["end"]})
        rows["a"] = rows["a"].where(rows["a"].notna() & (rows["a"].astype(str) != ""), rows["start"])
        rows = rows.dropna(subset=["a", "end"])
        for code, a, end in rows[["code", "a", "end"]].itertuples(index=False):
            c = pos.get(code)
            if c is not None:
                disp[(arr >= str(a)) & (arr <= str(end)), c] = True
        if not rows.empty:
            starts.append(str(rows["a"].min()))
    a = getattr(ds, "attention", pd.DataFrame())
    if not a.empty:
        idx = np.searchsorted(arr, a["date"].astype(str).to_numpy(), side="left")
        for i, code, day in zip(idx, a["code"].astype(str), a["date"].astype(str), strict=True):
            c = pos.get(code)
            if c is not None and i < T and arr[i] == day:
                attn[i, c] = True
        starts.append(str(a["date"].min()))
    lists_from = max(starts) if len(starts) == 2 else None
    return disp, attn, lists_from


def from_dataset(ds: Any) -> FlowData:
    ev = evdata.from_dataset(ds)
    layers = sectors.build_layers(ev.codes, ev.names, industry_map(ds))
    group_of, group_names, members = primary_groups(layers, ev.codes)
    fd_mask = (
        ev.full_delivery
        if getattr(ev, "full_delivery", None) is not None and ev.full_delivery.shape == ev.close.shape
        else None
    )
    universe = np.isfinite(ev.raw_close)
    if fd_mask is not None:
        universe &= ~fd_mask
    disp, attn, lists_from = lists_masks(ds, ev.dates, ev.codes)
    return FlowData(
        dates=list(ev.dates),
        codes=list(ev.codes),
        names=dict(ev.names),
        markets=dict(ev.markets),
        close=ev.close,
        raw_close=ev.raw_close,
        high=ev.high,
        open=ev.open,
        value=ev.value,
        volume=ev.volume,
        trust=ev.trust,
        taiex=ev.taiex,
        universe=universe,
        listed=evuni.listed_days(ev.raw_close),
        in_disposition=disp,
        in_attention=attn,
        lists_from=lists_from,
        group_of=group_of,
        group_names=group_names,
        members=members,
        revenue=ev.revenue,
        ev_universe=evuni.build(ev, dict(config.load("evidence")["universe"])),
        ev=ev,
    )


def load(data_dir: Path | str) -> FlowData:
    return from_dataset(dsmod.load(DataStore(Path(data_dir))))
