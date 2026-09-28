"""交易日曆：以證交所休市日曆判斷（時區 Asia/Taipei）。"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import pandas as pd

TRADING_KEYWORDS = ("開始交易", "最後交易")


def classify_holidays(df: pd.DataFrame) -> set[date]:
    """由休市日曆表（date, name, description）取出「市場不交易」的日期。

    日曆中「國曆新年開始交易日」「農曆春節前最後交易日」等為交易日，其餘（含「市場無交易，
    僅辦理結算交割作業」）為休市。
    """
    closed: set[date] = set()
    for _, row in df.iterrows():
        name = str(row.get("name", ""))
        if any(k in name for k in TRADING_KEYWORDS):
            continue
        d = row["date"]
        closed.add(d if isinstance(d, date) else date.fromisoformat(str(d)))
    return closed


@dataclass
class TradingCalendar:
    closed: set[date] = field(default_factory=set)
    known_years: set[int] = field(default_factory=set)

    @classmethod
    def from_frames(cls, frames: Iterable[pd.DataFrame], extra_closed: Iterable[str] = ()) -> TradingCalendar:
        cal = cls()
        for df in frames:
            if df is None or df.empty:
                continue
            cal.closed |= classify_holidays(df)
            for d in pd.to_datetime(df["date"]).dt.year.unique():
                cal.known_years.add(int(d))
        for s in extra_closed:
            cal.closed.add(date.fromisoformat(s))
        return cal

    @classmethod
    def from_store(cls, store: Any, manifest: dict[str, Any] | None = None) -> TradingCalendar:
        """由 data 分支已存的休市日曆（raw/twse_holidays/{年}）與 manifest 的臨時休市日（closed_days）建立。"""
        frames = [store.read("twse_holidays", d) for d in store.dates("twse_holidays")]
        manifest = manifest if manifest is not None else store.load_manifest()
        return cls.from_frames([f for f in frames if f is not None], manifest.get("closed_days", []))

    def to_json(self) -> dict[str, Any]:
        """前端共用的交易日曆（meta.json 的 calendar）：規則與 is_trading_day 相同——
        週一至週五且不在 closed 中即為交易日。web/src/lib/tradingCalendar.ts 依同一份資料判斷，不另外實作假日表。"""
        return {"closed": sorted(d.isoformat() for d in self.closed), "years": sorted(self.known_years)}

    def is_trading_day(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self.closed

    def trading_days(self, start: date, end: date) -> list[date]:
        out, d = [], start
        while d <= end:
            if self.is_trading_day(d):
                out.append(d)
            d += timedelta(days=1)
        return out

    def previous(self, d: date, n: int = 1) -> date:
        cur, count = d, 0
        while count < n:
            cur -= timedelta(days=1)
            if self.is_trading_day(cur):
                count += 1
        return cur

    def latest_on_or_before(self, d: date) -> date:
        return d if self.is_trading_day(d) else self.previous(d)

    def next(self, d: date, n: int = 1) -> date:
        cur, count = d, 0
        while count < n:
            cur += timedelta(days=1)
            if self.is_trading_day(cur):
                count += 1
        return cur
