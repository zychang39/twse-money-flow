"""E-02：前端與 pipeline 共用同一份交易日曆。

tests/fixtures/golden/calendar_2026.json 由 TradingCalendar 以真實休市日曆（官方 OpenAPI 樣本）產生，
web/src/lib/tradingCalendar.test.ts 讀同一份檔案，確認前端依 meta.json 的 calendar 判斷出完全相同的交易日。
若日曆規則改變，重跑本檔 test_golden_matches_pipeline 的產生邏輯更新 golden。
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from pipeline.core.calendar import TradingCalendar
from pipeline.derive.demo import build_store
from pipeline.derive.export import build_web
from pipeline.sources.twse import parse_holidays

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def _calendar() -> TradingCalendar:
    df = parse_holidays((FIX / "raw" / "twse_holidaySchedule.json").read_bytes()).df
    return TradingCalendar.from_frames([df])


def test_golden_matches_pipeline():
    golden = json.loads((FIX / "golden" / "calendar_2026.json").read_text())
    cal = _calendar()
    assert cal.to_json() == {"closed": golden["closed"], "years": golden["years"]}
    d, trading = date(2026, 1, 1), []
    while d <= date(2026, 12, 31):
        if cal.is_trading_day(d):
            trading.append(d.isoformat())
        d += timedelta(days=1)
    assert trading == golden["trading"]


def test_holiday_cases():
    cal = _calendar()
    # 9/25 中秋、9/28 教師節休市；9/29 為交易日；9/24 之後的第一個交易日是 9/29
    assert not cal.is_trading_day(date(2026, 9, 25)) and not cal.is_trading_day(date(2026, 9, 28))
    assert cal.is_trading_day(date(2026, 9, 29)) and cal.next(date(2026, 9, 24)) == date(2026, 9, 29)
    # 春節：2/11 最後交易日（交易）、2/12–2/20 休市、2/23 開始交易
    assert cal.is_trading_day(date(2026, 2, 11)) and cal.is_trading_day(date(2026, 2, 23))
    assert cal.trading_days(date(2026, 2, 12), date(2026, 2, 22)) == []


def test_meta_json_exports_calendar(tmp_path):
    build_store(tmp_path / "data", days=80)
    build_web(tmp_path / "data", tmp_path / "out", demo=True)
    meta = json.loads((tmp_path / "out" / "meta.json").read_text())
    assert "2026-09-28" in meta["calendar"]["closed"] and "2026-09-25" in meta["calendar"]["closed"]
    assert meta["calendar"]["years"] == [2026]
    assert "2026-09-29" not in meta["calendar"]["closed"]
