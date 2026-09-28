import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataPhase, makeCalendar } from './tradingCalendar';
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

describe('dataPhase：休市不是資料問題（E-02）', () => {
  const cal = makeCalendar(golden);
  // 台北時間 → UTC（-8 小時）
  const at = (iso: string, hh: number) => new Date(`${iso}T${String(hh).padStart(2, '0')}:00:00+08:00`);

  it('9/28 教師節：顯示休市，不是「尚未更新」', () => {
    expect(dataPhase('2026-09-24', cal, at('2026-09-28', 10))).toEqual({ phase: 'holiday', lag: 0 });
    expect(dataPhase('2026-09-24', cal, at('2026-09-28', 21))).toEqual({ phase: 'holiday', lag: 0 });
  });
  it('9/29 上午：今天的資料尚未更新（不是琥珀色過期）', () => {
    expect(dataPhase('2026-09-24', cal, at('2026-09-29', 9))).toEqual({ phase: 'pending', lag: 1 });
    expect(dataPhase('2026-09-29', cal, at('2026-09-29', 22))).toEqual({ phase: 'fresh', lag: 0 });
  });
  it('春節：整段休市；春節後第一個交易日上午只差 1 個交易日', () => {
    for (const d of ['2026-02-12', '2026-02-14', '2026-02-18', '2026-02-20', '2026-02-22']) {
      expect(dataPhase('2026-02-11', cal, at(d, 12)).phase).toBe('holiday');
    }
    expect(dataPhase('2026-02-11', cal, at('2026-02-23', 9))).toEqual({ phase: 'pending', lag: 1 });
  });
  it('真的落後超過 2 個交易日才顯示過期', () => {
    expect(dataPhase('2026-09-24', cal, at('2026-10-01', 9))).toEqual({ phase: 'stale', lag: 3 });
    expect(dataPhase('2026-09-24', cal, at('2026-09-30', 20))).toEqual({ phase: 'pending', lag: 2 });
  });
});
