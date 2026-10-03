"""Yahoo Finance chart API（非官方、免金鑰）：個股 5 分鐘 K 與加權指數 1 分鐘備援（2026-10 改版）。

端點：`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=5m&range=5d`
（上市 `{code}.TW`、上櫃 `{code}.TWO`、加權指數 `^TWII`）。回應的 timestamp 是 K 棒起始時間（UTC 秒），
以 meta.gmtoffset 換成台北時間。

已知限制（2026-10-03 實測 2330）：
- 13:25 那一根全部是空值（13:25–13:30 是收盤前集合競價、沒有逐筆成交）→ 略過。
- 09:00 與 13:30 兩根（開盤、收盤集合競價）的成交量回傳 0，但價格有變動 → 成交量記為空值（不知道），不是 0。
  其餘 K 棒的成交量單位是股。
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pandas as pd

from pipeline.sources.base import ParseError, ParseResult, load_json

KBAR_COLS = ["date", "code", "time", "open", "high", "low", "close", "volume"]
INDEX_COLS = ["date", "time", "taiex"]
SESSION = ("09:00", "13:30")
# 集合競價的 K 棒：Yahoo 回傳成交量 0（實際有成交）→ 記為空值
AUCTION_BARS = ("09:00", "13:30")


def symbol(code: str, market: str) -> str:
    """上市 → 2330.TW；上櫃 → 6488.TWO。"""
    return f"{code}.TWO" if market == "tpex" else f"{code}.TW"


def _num(v: Any, digits: int | None = None) -> float | None:
    """Yahoo 回傳 float32 轉成的數值（112.349998）→ 四捨五入到台股價格的 2 位小數。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return round(f, digits) if digits is not None else f


def _result(payload: bytes | str | dict[str, Any]) -> dict[str, Any] | None:
    obj = load_json(payload)
    if not isinstance(obj, dict) or "chart" not in obj:
        raise ParseError("Yahoo chart：回應缺少 chart")
    chart = obj["chart"] or {}
    err = chart.get("error")
    if err:
        code = str((err or {}).get("code", ""))
        if code in ("Not Found", "No data found"):
            return None
        raise ParseError(f"Yahoo chart 錯誤：{err}")
    results = chart.get("result") or []
    return results[0] if results else None


def parse_chart(payload: bytes | str | dict[str, Any], code: str) -> ParseResult:
    """chart API → 標準欄位（date, code, time "HH:MM" 為 K 棒起始時間, open, high, low, close, volume 股）。

    只保留 09:00–13:30 的 K 棒；四價全空的 K 棒略過；集合競價 K 棒的成交量 0 記為空值。
    """
    res = _result(payload)
    if res is None:
        return ParseResult(pd.DataFrame(columns=KBAR_COLS), no_data=True, message="查無資料")
    meta = res.get("meta") or {}
    if meta.get("exchangeTimezoneName") not in (None, "Asia/Taipei"):
        raise ParseError(f"Yahoo chart：時區 {meta.get('exchangeTimezoneName')} 不是台北")
    offset = timezone(timedelta(seconds=int(meta.get("gmtoffset", 28800))))
    stamps = res.get("timestamp") or []
    quotes = ((res.get("indicators") or {}).get("quote") or [{}])[0]
    for key in ("open", "high", "low", "close", "volume"):
        if key not in quotes:
            raise ParseError(f"Yahoo chart：缺少 {key}")
    rows = []
    for i, ts in enumerate(stamps):
        t = datetime.fromtimestamp(int(ts), UTC).astimezone(offset)
        hm = t.strftime("%H:%M")
        if not SESSION[0] <= hm <= SESSION[1]:
            continue
        o, h, lo, c = (_num(quotes[k][i], 2) for k in ("open", "high", "low", "close"))
        if c is None and o is None:
            continue
        v = _num(quotes["volume"][i])
        if hm in AUCTION_BARS and not v:
            v = None
        rows.append(
            {
                "date": t.date().isoformat(),
                "code": code,
                "time": hm,
                "open": o,
                "high": h,
                "low": lo,
                "close": c,
                "volume": v,
            }
        )
    df = pd.DataFrame(rows, columns=KBAR_COLS)
    if df.empty:
        return ParseResult(df, no_data=True, message="查無 K 棒")
    df = df.drop_duplicates(["date", "time"], keep="last").reset_index(drop=True)
    return ParseResult(df, response_date=datetime.fromisoformat(str(df["date"].max())).date())


def parse_index_chart(payload: bytes | str | dict[str, Any]) -> ParseResult:
    """^TWII 1 分鐘 K → 每 5 秒指數統計的同格式（date, time "HH:MM:59", taiex＝該分鐘收盤）。"""
    res = parse_chart(payload, "^TWII")
    if res.no_data:
        return ParseResult(pd.DataFrame(columns=INDEX_COLS), no_data=True, message=res.message)
    df = res.df.dropna(subset=["close"])
    # 1 分 K 的收盤是該分鐘最後一筆 → 標成 HH:MM:59（降採樣仍落在同一分鐘；開高低收不會被當成開盤前那一筆）
    out = pd.DataFrame({"date": df["date"], "time": df["time"] + ":59", "taiex": df["close"]})
    return ParseResult(out.reset_index(drop=True), response_date=res.response_date)
