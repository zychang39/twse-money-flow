"""評估用的全期間面板（不截衍生計算視窗）：還原價、量、籌碼、集保、月營收、大盤。

資料生效日（1.2）一律換成「訊號列」：訊號在該列收盤後產生，下一個交易日開盤進場。
- 收盤價、量、三大法人、融資融券：資料日 T 就是訊號列。
- 集保股權分散：資料日（週五）次日公布（週六）→ v3 M0-2 起訊號列＝下週第一個交易日（通常週一），進場＝週二開盤；
  訊號日 T 只引用 T 之前一週（含）以前已公布的週，不引用 T 當週（見 whale_usable_from）。
- 月營收：公布日（取不到則為次月 10 日）→ 訊號列＝公布日（含）之前最後一個交易日，進場＝公布日之後第一個交易日。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from pipeline.core import config
from pipeline.core.normalize import is_common_stock
from pipeline.core.store import DataStore

log = logging.getLogger(__name__)

TAIEX = "發行量加權股價指數"
TAIEX_TR = "發行量加權股價報酬指數"
# v3 M2 基準：0050（買進持有，大型股）、00631L（2 倍槓桿 ETF，每日再平衡）
BENCH_ETFS = ("0050", "00631L")


def cfg() -> dict[str, Any]:
    return config.load("evidence")


def signal_row(dates: list[str], effective: str) -> int:
    """生效日 → 訊號列：生效日（含）之前最後一個交易日的索引（-1 表示在資料之前）。

    進場＝訊號列的下一個交易日開盤＝生效日之後第一個交易日（生效日本身是交易日時，當天收盤後產生訊號）。
    """
    return int(np.searchsorted(np.asarray(dates), effective, side="right")) - 1


@dataclass
class EvData:
    dates: list[str]
    codes: list[str]
    names: dict[str, str]
    open: np.ndarray  # (T, C) 還原開盤
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray  # 還原收盤
    raw_close: np.ndarray  # 未還原收盤（價格門檻用）
    volume: np.ndarray  # 股
    value: np.ndarray  # 元
    foreign: np.ndarray  # 外陸資（不含外資自營商）淨買超股數
    trust: np.ndarray
    hedge: np.ndarray  # 自營商（避險）
    margin: np.ndarray  # 融資餘額（張）
    disposition: np.ndarray  # (T, C) bool：處置期間
    taiex: np.ndarray  # (T,)
    taiex_tr: np.ndarray  # (T,) 報酬指數（取不到時為 nan，改用加權指數並註明）
    whale_pct: np.ndarray = field(default_factory=lambda: np.zeros((0, 0)))  # 千張大戶比例（訊號列；週資料延用）
    whale_chg: np.ndarray = field(default_factory=lambda: np.zeros((0, 0)))  # 週變化（只在訊號列有值）
    whale_chg4: np.ndarray = field(default_factory=lambda: np.zeros((0, 0)))  # 4 週變化（延用）
    revenue: pd.DataFrame = field(default_factory=pd.DataFrame)  # code, ym, revenue, yoy, row
    starts: dict[str, str | None] = field(default_factory=dict)  # 各資料的起始日
    # v3 M1：官方終止上市櫃日期（不含轉上市）、變更交易（全額交割）逐日標記
    delist_date: dict[str, str] = field(default_factory=dict)
    full_delivery: np.ndarray = field(default_factory=lambda: np.zeros((0, 0), dtype=bool))
    status_note: dict[str, Any] = field(default_factory=dict)
    # v3 M2：可投資的基準（還原價，含息、已處理分割）：代號 → {"open": (T,), "close": (T,)}
    etf: dict[str, dict[str, np.ndarray]] = field(default_factory=dict)

    @property
    def T(self) -> int:
        return len(self.dates)

    @property
    def C(self) -> int:
        return len(self.codes)


def _pivot(df: pd.DataFrame, col: str, dates: list[str], codes: list[str]) -> np.ndarray:
    if df.empty or col not in df.columns:
        return np.full((len(dates), len(codes)), np.nan)
    wide = df.pivot_table(index="date", columns="code", values=col, aggfunc="last")
    return wide.reindex(index=dates, columns=codes).to_numpy(dtype=float)


def _first_date(df: pd.DataFrame, col: str) -> str | None:
    if df.empty or col not in df.columns:
        return None
    d = df.loc[df[col].notna(), "date"]
    return str(d.min()) if len(d) else None


def whale_frames(tdcc: pd.DataFrame) -> pd.DataFrame:
    """集保 → 每週每檔：千張（分級 15）、800 張以上（14–15）、400 張以上（12–15）比例與週變化、公布日。"""
    if tdcc.empty:
        return pd.DataFrame(columns=["date", "code", "w1000", "w800", "w400", "chg", "published"])
    t = tdcc[tdcc["level"].between(1, 15)]
    wide = t.pivot_table(index=["date", "code"], columns="level", values="pct", aggfunc="last")
    out = pd.DataFrame(index=wide.index)
    out["w1000"] = wide.get(15)
    out["w800"] = wide.reindex(columns=[14, 15]).sum(axis=1, min_count=2)
    out["w400"] = wide.reindex(columns=[12, 13, 14, 15]).sum(axis=1, min_count=4)
    out = out.reset_index().sort_values(["code", "date"])
    out["chg"] = out.groupby("code")["w1000"].diff()
    # 相鄰兩筆必須是連續的週（相差 ≤ 8 天），缺週時週變化為空值
    gap = pd.to_datetime(out["date"]).groupby(out["code"]).diff().dt.days
    out.loc[gap > 8, "chg"] = np.nan
    out["published"] = [(date.fromisoformat(str(d)) + timedelta(days=1)).isoformat() for d in out["date"]]
    return out


def whale_usable_from(data_date: str) -> str:
    """v3 M0-2：集保週資料最早可被引用的日子。

    基準日為該週最後一個營業日（通常週五；週五休市時為週四），次日（週六）公布。訊號日 T 只能引用
    「T 之前最近一個已公布的週」：T 為週一到週五時一律用上週的資料，不得引用 T 當週（即使 T 是週五、
    當週資料要到週六才公布）。所以最早可用日＝max(下週一, 公布日次日)。
    """
    d = date.fromisoformat(data_date[:10])
    next_monday = d + timedelta(days=7 - d.weekday())
    return max(next_monday, d + timedelta(days=2)).isoformat()


def whale_signal_rows(data_dates: list[str], dates: list[str]) -> np.ndarray:
    """週資料日 → 第一次可引用的訊號列（最早可用日當天或之後的第一個交易日；在資料之後為 len(dates)）。

    訊號列當天收盤後產生訊號、下一個交易日開盤進場（週資料 → 最早週一收盤訊號、週二開盤進場，
    與分數系統 §4.5 的「週二進場」一致）。
    """
    usable = [whale_usable_from(d) for d in data_dates]
    return np.searchsorted(np.asarray(dates), np.asarray(usable, dtype=str), side="left")


def whale_panels(
    w: pd.DataFrame, dates: list[str], codes: list[str], weeks: int = 4, max_age: int = 7
) -> dict[str, np.ndarray]:
    T, C = len(dates), len(codes)
    pos = {c: i for i, c in enumerate(codes)}
    pct = np.full((T, C), np.nan)
    chg = np.full((T, C), np.nan)
    chg4 = np.full((T, C), np.nan)
    if w.empty:
        return {"pct": pct, "chg": chg, "chg4": chg4}
    w = w.copy()
    w["chg4"] = w.groupby("code")["w1000"].diff(weeks)
    span = pd.to_datetime(w["date"]).groupby(w["code"]).diff(weeks).dt.days
    w.loc[span > weeks * 7 + 1, "chg4"] = np.nan
    w["row"] = whale_signal_rows(w["date"].astype(str).tolist(), dates)
    w = w[(w["row"] >= 0) & (w["row"] < T) & w["code"].isin(pos)]
    for col, arr in (("w1000", pct), ("chg4", chg4)):
        upd = np.full((T, C), np.nan)
        for code, part in w.groupby("code"):
            c = pos[code]
            arr[part["row"].to_numpy(), c] = part[col].to_numpy(dtype=float)
            upd[part["row"].to_numpy(), c] = part["row"].to_numpy()
        # 延用到下一次更新；超過 max_age 個交易日沒有更新就視為缺值
        filled = pd.DataFrame(arr).ffill().to_numpy()
        last = pd.DataFrame(upd).ffill().to_numpy()
        age = np.arange(T)[:, None] - last
        arr[:] = np.where(age > max_age, np.nan, filled)
    for code, part in w.groupby("code"):
        chg[part["row"].to_numpy(), pos[code]] = part["chg"].to_numpy(dtype=float)
    return {"pct": pct, "chg": chg, "chg4": chg4}


def revenue_table(rev: pd.DataFrame, dates: list[str], codes: list[str], fallback_day: int) -> pd.DataFrame:
    """月營收（每檔每月）＋訊號列。生效日＝次月 fallback_day 日（官方沒有逐月的公司公布日歷史，一律用法定期限）。"""
    if rev.empty:
        return pd.DataFrame(columns=["code", "ym", "revenue", "yoy", "row"])
    r = rev[rev["code"].isin(set(codes))].copy()
    r["revenue"] = pd.to_numeric(r["revenue"], errors="coerce")
    if "yoy" in r.columns:
        r["yoy"] = pd.to_numeric(r["yoy"], errors="coerce")
    elif "revenue_last_year" in r.columns:  # 舊格式沒有年增率欄：以去年同月營收計算（%）
        last = pd.to_numeric(r["revenue_last_year"], errors="coerce")
        r["yoy"] = (r["revenue"] / last.where(last > 0) - 1) * 100
    else:
        r["yoy"] = np.nan
    r = r[["code", "ym", "revenue", "yoy"]]
    r = r.drop_duplicates(["code", "ym"], keep="last").sort_values(["code", "ym"])
    ym = pd.PeriodIndex(r["ym"].astype(str), freq="M")
    eff = [date((p + 1).year, (p + 1).month, fallback_day).isoformat() for p in ym]
    r["effective"] = eff
    r["row"] = np.searchsorted(np.asarray(dates), np.asarray(eff), side="right") - 1
    # 審查修正 2026-10-01（截斷測試發現）：生效日在資料最後一天之後的月份（提早公布、還沒到次月 10 日）
    # 不能落在最後一列當訊號，否則訊號會出現在生效日之前；設為資料之外（len(dates)），事件與逐日面板都略過
    if dates:
        r.loc[r["effective"] > dates[-1], "row"] = len(dates)
    return r.reset_index(drop=True)


def disposition_mask(disp: pd.DataFrame, dates: list[str], codes: list[str]) -> np.ndarray:
    mask = np.zeros((len(dates), len(codes)), dtype=bool)
    if disp.empty:
        return mask
    pos = {c: i for i, c in enumerate(codes)}
    arr = np.asarray(dates)
    for code, start, end in disp.dropna(subset=["start", "end"])[["code", "start", "end"]].itertuples(index=False):
        c = pos.get(str(code))
        if c is not None:
            mask[(arr >= str(start)) & (arr <= str(end)), c] = True
    return mask


def official_delistings(delisted: pd.DataFrame) -> dict[str, str]:
    """代號 → 官方終止上市／上櫃日期（兩所公告；「轉上市」不是下市，排除）。同一代號多次時取最後一次。"""
    if delisted.empty:
        return {}
    d = delisted[delisted["kind"].astype(str) == "delisted"].dropna(subset=["date"])
    d = d.assign(code=d["code"].astype(str)).sort_values("date")
    return {str(c): str(x) for c, x in zip(d["code"], d["date"], strict=True)}


def full_delivery_mask(
    cmode: pd.DataFrame,
    additions: pd.DataFrame,
    delist: dict[str, str],
    dates: list[str],
    codes: list[str],
    assume_days: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    """(T, C) 變更交易（全額交割）或管理股票的逐日標記。

    1. 目前名單的每日快照（v3 起累積，內容變動才存）：快照日 d_i 的名單適用到下一份快照前一日（該來源）。
    2. 快照開始前：證交所「新增之變更交易證券」歷史（只有新增日）→ 自新增日起標記，到官方終止上市日；
       在第一份快照名單內 → 標記到第一份快照；其他（已恢復普通交易，但官方沒有恢復日期的歷史）→ 假設 assume_days 個交易日。
       櫃買沒有歷史新增紀錄，快照開始前無法標記（限制，寫在 METHODOLOGY §10.1）。
    """
    T, C = len(dates), len(codes)
    mask = np.zeros((T, C), dtype=bool)
    pos = {c: i for i, c in enumerate(codes)}
    arr = np.asarray(dates)
    note: dict[str, Any] = {"snapshots": 0, "additions": 0, "assumed": 0, "first_snapshot": None}
    first_snap: dict[str, str] = {}
    if not cmode.empty:
        cm = cmode.assign(code=cmode["code"].astype(str))
        flagged = cm[
            cm.get("altered", False).astype(str).isin(["True", "true", "1"])
            | cm.get("managed", False).astype(str).isin(["True", "true", "1"])
        ]
        for sid, part in cm.groupby("source"):
            snaps = sorted(part["asof"].unique())
            first_snap[str(sid)] = snaps[0]
            for i, asof in enumerate(snaps):
                hi = snaps[i + 1] if i + 1 < len(snaps) else "9999-12-31"
                rows = (arr >= asof) & (arr < hi)
                for code in flagged.loc[(flagged["source"] == sid) & (flagged["asof"] == asof), "code"]:
                    c = pos.get(code)
                    if c is not None:
                        mask[rows, c] = True
        note["snapshots"] = int(cm["asof"].nunique())
        note["first_snapshot"] = min(first_snap.values())
    snap0 = first_snap.get("twse_cmode")
    in_snap0 = set()
    if snap0 is not None:
        cm0 = cmode[(cmode["source"] == "twse_cmode") & (cmode["asof"] == snap0)]
        in_snap0 = set(cm0["code"].astype(str))
    if not additions.empty:
        for code, add in additions[["code", "date"]].astype(str).drop_duplicates().itertuples(index=False):
            c = pos.get(code)
            if c is None:
                continue
            i0 = int(np.searchsorted(arr, add, side="left"))
            stop = snap0 or "9999-12-31"
            if delist.get(code, "") > add:
                i1 = int(np.searchsorted(arr, min(delist[code], stop), side="left"))
            elif code in in_snap0:
                i1 = int(np.searchsorted(arr, stop, side="left"))
            else:
                i1 = min(i0 + assume_days, int(np.searchsorted(arr, stop, side="left")))
                note["assumed"] += 1
            mask[i0:i1, c] = True
            note["additions"] += 1
    return mask, note


def load(store: DataStore) -> EvData:
    from pipeline.derive import dataset as dsmod

    return from_dataset(dsmod.load(store))


def from_dataset(ds: Any) -> EvData:
    """由（未截視窗的）Dataset 建立評估資料；build-web 在截衍生計算視窗之前呼叫。"""
    from pipeline.derive.build import build_panels

    p = build_panels(ds)
    names = p.names
    pat = [str(x) for x in cfg()["universe"].get("exclude_name_patterns", [])]
    codes = [c for c in p.codes if is_common_stock(c) and not any(x in str(names.get(c, "")) for x in pat)]
    dates = p.dates
    af = p.af[codes].to_numpy()

    def w(frame: pd.DataFrame) -> np.ndarray:
        return frame[codes].to_numpy(dtype=float)

    idx = ds.index
    tx = idx[idx["name"] == TAIEX].drop_duplicates("date", keep="last").set_index("date")["close"].reindex(dates)
    tr = idx[idx["name"] == TAIEX_TR].drop_duplicates("date", keep="last").set_index("date")["close"].reindex(dates)
    insti = ds.insti
    ev = EvData(
        dates=dates,
        codes=codes,
        names={c: str(names.get(c, c)) for c in codes},
        open=w(p.open) * af,
        high=w(p.high) * af,
        low=w(p.low) * af,
        close=w(p.close) * af,
        raw_close=w(p.close),
        volume=w(p.volume),
        value=w(p.value),
        foreign=w(p.foreign_net),
        trust=w(p.trust_net),
        hedge=_pivot(insti, "dealer_hedge_net", dates, codes),
        margin=w(p.margin_balance),
        disposition=disposition_mask(ds.disposition, dates, codes),
        taiex=tx.to_numpy(dtype=float),
        taiex_tr=tr.to_numpy(dtype=float),
    )
    wf = whale_frames(ds.table("tdcc"))
    wp = whale_panels(wf, dates, codes, int(cfg()["indicators"]["whale_weeks"]))
    ev.whale_pct, ev.whale_chg, ev.whale_chg4 = wp["pct"], wp["chg"], wp["chg4"]
    ev.revenue = revenue_table(ds.revenue, dates, codes, int(cfg()["indicators"]["revenue_fallback_day"]))
    for code in BENCH_ETFS:
        if code in p.af.columns:
            f = p.af[code].to_numpy(dtype=float)
            ev.etf[code] = {
                "open": p.open[code].to_numpy(dtype=float) * f,
                "close": p.close[code].to_numpy(dtype=float) * f,
            }
    ev.delist_date = official_delistings(ds.table("delisted"))
    ev.full_delivery, ev.status_note = full_delivery_mask(
        ds.table("cmode"),
        ds.table("fulldelivery"),
        ev.delist_date,
        dates,
        codes,
        int(cfg()["universe"].get("full_delivery_assume_days", 120)),
    )
    ev.starts = {
        "price": dates[0] if dates else None,
        "insti": _first_date(insti, "trust_net"),
        "hedge": _first_date(insti, "dealer_hedge_net"),
        "margin": _first_date(ds.margin, "margin_balance"),
        "disposition": str(ds.disposition["start"].min()) if not ds.disposition.empty else None,
        "whale": str(wf["date"].min()) if not wf.empty else None,
        "whale_chg": str(wf.loc[wf["chg"].notna(), "date"].min()) if wf["chg"].notna().any() else None,
        "revenue": str(ev.revenue["ym"].min()) if not ev.revenue.empty else None,
    }
    log.info("評估資料：%d 個交易日（%s～%s）、%d 檔普通股", len(dates), dates[0], dates[-1], len(codes))
    return ev
