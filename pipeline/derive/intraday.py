"""盤中走勢的前端檔（2026-10 改版）：加權指數 1D／1W（intraday.json）與個股 5 分 K（intraday/{code}.json）。

- intraday.json：最近一個有盤中資料的交易日每分鐘一點（09:00–13:30，約 271 點；該分鐘最後一筆）、
  當日開高低收（由每 5 秒統計算：開＝09:00:00 第一筆、收＝最後一筆）、前一交易日收盤，
  以及最近 ≤5 個交易日的 5 分鐘點（09:00、09:05…13:30，給 1W）。休市日一樣輸出最近交易日。
  來源優先證交所「每 5 秒指數統計」；某日取不到才用 Yahoo ^TWII 1 分 K（fallback: true，標示非官方）。
- intraday/index.json＋intraday/{code}.json：Yahoo 5 分 K（非官方），只為有 K 棒的股票產生檔案。
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.derive.export import clean, write_json

log = logging.getLogger(__name__)

TWSE_SOURCE = "證交所每 5 秒指數統計（盤後取得）"
YAHOO_INDEX_SOURCE = "Yahoo Finance ^TWII（非官方）"
KBAR_SOURCE = "Yahoo Finance（非官方）"
DAYS = 5


def downsample_minutes(df: pd.DataFrame) -> list[dict[str, Any]]:
    """每 5 秒 → 每分鐘一點（該分鐘最後一筆；13:30:00 收盤那一筆自成一點）。"""
    if df.empty:
        return []
    d = df.dropna(subset=["taiex"]).copy()
    d["minute"] = d["time"].astype(str).str.slice(0, 5)
    last = d.groupby("minute", sort=True)["taiex"].last()
    return [{"t": str(t), "v": clean(float(v), 2)} for t, v in last.items()]


def every5(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """每分鐘點 → 每 5 分鐘一點（09:00、09:05…13:30；取該分鐘的值）。"""
    return [p for p in points if int(str(p["t"])[3:5]) % 5 == 0]


def ohlc(df: pd.DataFrame) -> dict[str, Any] | None:
    """當日開高低收。每 5 秒統計 09:00:00 那一筆是開盤前的指數（＝前一日收盤），不列入；
    開＝09:00:05 起第一筆（與證交所「每日市場成交資訊」開盤指數同一個定義），收＝13:30:00。"""
    d = df.dropna(subset=["taiex"]).sort_values("time")
    s = d[d["time"].astype(str) > "09:00:00"]["taiex"]
    if s.empty:
        return None
    return {
        "o": clean(float(s.iloc[0]), 2),
        "h": clean(float(s.max()), 2),
        "l": clean(float(s.min()), 2),
        "c": clean(float(s.iloc[-1]), 2),
    }


def _day_frame(store: Any, d: str) -> tuple[pd.DataFrame, bool] | None:
    """某交易日的指數盤中資料：(資料, 是否為備援)。"""
    key = date.fromisoformat(d)
    for sid, fallback in (("twse_intraday_index", False), ("yahoo_twii", True)):
        df = store.read(sid, key)
        if df is not None and not df.empty:
            return df.assign(time=df["time"].astype(str)), fallback
    return None


def index_intraday(store: Any, dates: list[str], taiex: pd.Series) -> dict[str, Any] | None:
    """dates：交易日（舊→新）；taiex：以日期為索引的加權指數收盤。"""
    found: list[tuple[str, pd.DataFrame, bool]] = []
    for d in reversed(dates[-(DAYS + 5) :]):
        got = _day_frame(store, d)
        if got is not None:
            found.append((d, got[0], got[1]))
        if len(found) >= DAYS:
            break
    if not found:
        return None
    found.reverse()
    closes = taiex.dropna()

    def prev_of(d: str) -> tuple[float | None, str | None]:
        prev = closes[closes.index < d]
        return (clean(float(prev.iloc[-1]), 2), str(prev.index[-1])) if len(prev) else (None, None)

    last_d, last_df, last_fb = found[-1]
    points = downsample_minutes(last_df)
    pc, pd_ = prev_of(last_d)
    days = []
    for d, df, _fb in found:
        dpc, _ = prev_of(d)
        days.append({"date": d, "prev_close": dpc, "points": every5(downsample_minutes(df))})
    data: dict[str, Any] = {
        "date": last_d,
        "name": "發行量加權股價指數",
        "prev_close": pc,
        "prev_date": pd_,
        "source": YAHOO_INDEX_SOURCE if last_fb else TWSE_SOURCE,
        "points": points,
        "ohlc": ohlc(last_df),
        "days": days,
    }
    if any(fb for _d, _df, fb in found):
        data["fallback"] = True
        data["fallback_dates"] = [d for d, _df, fb in found if fb]
    return data


def intraday_file(store: Any, dates: list[str], taiex: pd.Series, out: Path) -> dict[str, Any] | None:
    data = index_intraday(store, dates, taiex)
    if data is not None:
        write_json(out / "intraday.json", data)
    return data


# ------------------------------------------------------------------ 個股 5 分 K
def _bars(part: pd.DataFrame) -> list[list[Any]]:
    part = part.sort_values("time")
    return [
        [
            str(t),
            clean(o, 2),
            clean(h, 2),
            clean(lo, 2),
            clean(c, 2),
            None if v != v or v is None else int(v),
        ]
        for t, o, h, lo, c, v in zip(
            part["time"], part["open"], part["high"], part["low"], part["close"], part["volume"], strict=True
        )
    ]


def kbar_files(store: Any, dates: list[str], close: pd.DataFrame, codes: set[str], out: Path) -> dict[str, Any]:
    """dates：交易日（舊→新）；close：原始收盤寬表（index=date, columns=code），算各日前收；codes：有個股頁的代號。"""
    have = [d for d in dates[-(DAYS + 5) :] if store.exists("yahoo_kbar", date.fromisoformat(d))]
    have = have[-DAYS:]
    if not have:
        return {"kbar_codes": 0}
    frames = []
    for d in have:
        df = store.read("yahoo_kbar", date.fromisoformat(d))
        if df is not None and not df.empty:
            frames.append(df.assign(code=df["code"].astype(str), time=df["time"].astype(str), date=d))
    if not frames:
        return {"kbar_codes": 0}
    allk = pd.concat(frames, ignore_index=True)
    latest = have[-1]
    covered = sorted(set(allk.loc[allk["date"] == latest, "code"]) & codes)
    pos = {d: i for i, d in enumerate(dates)}
    by_code = {c: g for c, g in allk[allk["code"].isin(covered)].groupby("code")}
    written = []
    for code in covered:
        g = by_code[code]
        col = close[code] if code in close.columns else None
        days = []
        for d, part in g.groupby("date", sort=True):
            i = pos.get(str(d))
            prev = None
            if col is not None and i:
                before = col.iloc[:i].dropna()
                prev = clean(float(before.iloc[-1]), 2) if len(before) else None
            days.append({"date": str(d), "prev_close": prev, "bars": _bars(part)})
        write_json(
            out / "intraday" / f"{code}.json", {"code": code, "date": latest, "source": KBAR_SOURCE, "days": days}
        )
        written.append(code)
    write_json(out / "intraday" / "index.json", {"date": latest, "source": KBAR_SOURCE, "codes": written})
    return {"kbar_codes": len(written), "kbar_date": latest}
