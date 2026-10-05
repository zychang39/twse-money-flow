import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCalendar } from './tradingCalendar';
import { addDays } from './dates';

const golden = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/golden/calendar_2026.json', import.meta.url), 'utf8'),
) as { closed: string[]; years: number[]; trading: string[] };

describe('交易日曆（與 pipeline 共用，E-02）', () => {
  const cal = makeCalendar(golden);
  it('2026 全年交易日與 pipeline TradingCalendar 完全相同', () => {
    const trading: string[] = [];
    for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) if (cal.isTradingDay(d)) trading.push(d);
    expect(trading).toEqual(golden.trading);
  });
  it('休市、春節與下一個交易日', () => {
    expect(cal.isTradingDay('2026-09-25')).toBe(false);
    expect(cal.isTradingDay('2026-09-28')).toBe(false);
    expect(cal.onOrAfter('2026-09-26')).toBe('2026-09-29');
    expect(cal.onOrAfter('2026-09-24')).toBe('2026-09-24');
    expect(cal.previous('2026-09-29')).toBe('2026-09-24');
    expect(cal.tradingDaysBetween('2026-02-11', '2026-02-23')).toBe(1);
  });
  it('沒有日曆資料時只排除週末', () => {
    const plain = makeCalendar(null);
    expect(plain.isTradingDay('2026-09-28')).toBe(true);
    expect(plain.isTradingDay('2026-09-27')).toBe(false);
  });
});
