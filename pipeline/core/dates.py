"""日期工具：民國／西元轉換、台北時間。"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TPE = ZoneInfo("Asia/Taipei")

_ROC_SEP = re.compile(r"^\s*(\d{2,3})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?\s*$")
_WEST_SEP = re.compile(r"^\s*(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?\s*$")
_MDY = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$")


def now_tpe() -> datetime:
    return datetime.now(TPE)


def today_tpe() -> date:
    return now_tpe().date()


def parse_date(value: object) -> date | None:
    """解析各種日期格式：1150924、115/09/24、115年09月24日、115.09.24、2026/09/24、20260924、09/24/2026。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text in {"-", "--", "N/A"}:
        return None
    try:
        if text.isdigit():
            if len(text) == 8:
                return date(int(text[:4]), int(text[4:6]), int(text[6:]))
            if len(text) == 7:  # 民國 1150924
                return date(int(text[:3]) + 1911, int(text[3:5]), int(text[5:]))
            if len(text) == 6:  # 民國 991231（兩位數年）
                return date(int(text[:2]) + 1911, int(text[2:4]), int(text[4:]))
            return None
        m = _WEST_SEP.match(text)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3]))
        m = _ROC_SEP.match(text)
        if m:
            return date(int(m[1]) + 1911, int(m[2]), int(m[3]))
        m = _MDY.match(text)
        if m:
            return date(int(m[3]), int(m[1]), int(m[2]))
    except ValueError:
        return None
    return None


def parse_ym(value: object) -> date | None:
    """解析年月：11508（民國）、202608、115/08 → 該月 1 日。"""
    text = str(value).strip()
    if text.isdigit():
        if len(text) == 5:
            return date(int(text[:3]) + 1911, int(text[3:]), 1)
        if len(text) == 6:
            return date(int(text[:4]), int(text[4:]), 1)
    m = re.match(r"^(\d{2,4})\s*[/.\-年]\s*(\d{1,2})", text)
    if m:
        year = int(m[1])
        return date(year + 1911 if year < 1000 else year, int(m[2]), 1)
    return None


def roc_year(d: date) -> int:
    return d.year - 1911


def ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def iso(d: date) -> str:
    return d.isoformat()


def slash(d: date) -> str:
    return d.strftime("%Y/%m/%d")


def month_start(d: date) -> date:
    return d.replace(day=1)


def prev_month(d: date) -> date:
    first = d.replace(day=1)
    return (first - timedelta(days=1)).replace(day=1)


def next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def daterange(start: date, end: date) -> list[date]:
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]
