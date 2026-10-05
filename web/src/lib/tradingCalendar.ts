/**
 * 交易日曆（E-02）：資料來自 pipeline 輸出的 meta.json `calendar`（證交所休市日曆＋臨時休市日），
 * 規則與 pipeline/core/calendar.py 的 TradingCalendar.is_trading_day 相同：週一至週五且不在 closed 中。
 * 前端不另外維護假日表；golden 測試（tests/fixtures/golden/calendar_2026.json）確認兩邊結果一致。
 * 沒有日曆資料（舊版 meta.json）時退回只看週末，與 pipeline 對未知年份的處理相同。
 */
import { addDays } from './dates';

export interface CalendarData { closed: string[]; years?: number[] }

export interface TradingCalendar {
  isTradingDay(iso: string): boolean;
  /** iso 之後（不含）到 until（含）之間的交易日數 */
  tradingDaysBetween(after: string, until: string): number;
  /** iso 當天（含）之後的第一個交易日 */
  onOrAfter(iso: string): string;
  /** iso 之前（不含）的最近一個交易日 */
  previous(iso: string): string;
}

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function makeCalendar(data?: CalendarData | null): TradingCalendar {
  const closed = new Set(data?.closed ?? []);
  const isTradingDay = (iso: string) => {
    const wd = weekday(iso);
    return wd !== 0 && wd !== 6 && !closed.has(iso);
  };
  return {
    isTradingDay,
    tradingDaysBetween(after, until) {
      let n = 0;
      let d = after;
      for (let i = 0; i < 4000; i++) {
        d = addDays(d, 1);
        if (d > until) break;
        if (isTradingDay(d)) n++;
      }
      return n;
    },
    onOrAfter(iso) {
      let d = iso;
      for (let i = 0; i < 60 && !isTradingDay(d); i++) d = addDays(d, 1);
      return d;
    },
    previous(iso) {
      let d = addDays(iso, -1);
      for (let i = 0; i < 60 && !isTradingDay(d); i++) d = addDays(d, -1);
      return d;
    },
  };
}

// 2026-10-06：舊的 dataPhase（以「資料日 < 今天」判斷尚未更新）已移除，改用 lib/freshness（各資料集的預期公布時間）。
