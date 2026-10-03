import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countDatesBetween, rangeReturn } from './rangeReturn';
import { makeCalendar } from './tradingCalendar';
import { weeklyIndices, pick } from './periods';
import { addDays } from './dates';

const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'];

describe('兩指區間報酬', () => {
  it('手算：100 → 110＝+10（+10.00%），相隔 3 個交易日；手指順序不影響', () => {
    const v = [100, 104, 99, 110, 108];
    const r = rangeReturn(dates, v, 0, 3)!;
    expect(r).toMatchObject({ from: 0, to: 3, fromDate: '2026-09-01', toDate: '2026-09-04', abs: 10, days: 3, dir: 'up' });
    expect(r.pct).toBeCloseTo(10);
    expect(rangeReturn(dates, v, 3, 0)).toEqual(r);
  });
  it('下跌、同一點、超出範圍的索引夾到邊界', () => {
    const v = [100, 104, 99, 110, 108];
    const r = rangeReturn(dates, v, 1, 2)!;
    expect(r.abs).toBe(-5);
    expect(r.pct).toBeCloseTo(-4.8077, 3);
    expect(r.dir).toBe('down');
    expect(rangeReturn(dates, v, 2, 2)).toMatchObject({ days: 0, abs: 0, dir: 'flat' });
    expect(rangeReturn(dates, v, -5, 99)).toMatchObject({ from: 0, to: 4, days: 4 });
  });
  it('還原價與原始價不同：除息後原始價下跌、還原價不變', () => {
    // 9/3 除息 4 元：原始 100 → 96；還原價把除息前的價格乘上 96/100
    const raw = [100, 100, 96, 96, 96];
    const adj = [96, 96, 96, 96, 96];
    expect(rangeReturn(dates, raw, 0, 4)!.pct).toBeCloseTo(-4);
    expect(rangeReturn(dates, adj, 0, 4)!.pct).toBeCloseTo(0);
  });
  it('少於 2 點 → null', () => {
    expect(rangeReturn(['2026-09-01'], [100], 0, 0)).toBeNull();
  });
});

describe('區間交易日數（M1-8）：週線取樣的視窗不能用索引差', () => {
  const golden = JSON.parse(
    readFileSync(new URL('../../../tests/fixtures/golden/calendar_2026.json', import.meta.url), 'utf8'),
  ) as { closed: string[]; years: number[] };
  const cal = makeCalendar(golden);
  // 2026 全年的日資料（交易日）
  const daily: string[] = [];
  for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) if (cal.isTradingDay(d)) daily.push(d);
  const values = daily.map((_, i) => 100 + i);

  it('日資料視窗：countDatesBetween 與索引差相同', () => {
    const r = rangeReturn(daily, values, 10, 60, (a, b) => countDatesBetween(daily, a, b))!;
    expect(r.days).toBe(50);
    expect(rangeReturn(daily, values, 10, 60)!.days).toBe(50);
    expect(countDatesBetween(daily, daily[10], daily[10])).toBe(0);
  });
  it('週線取樣的視窗：索引差只是週數，交易日數要用日資料或交易日曆計', () => {
    const idx = weeklyIndices(daily);
    const wDates = pick(daily, idx);
    const wValues = pick(values, idx);
    const a = 0, b = wDates.length - 1;
    const naive = rangeReturn(wDates, wValues, a, b)!;
    const byDaily = rangeReturn(wDates, wValues, a, b, (x, y) => countDatesBetween(daily, x, y))!;
    const byCal = rangeReturn(wDates, wValues, a, b, (x, y) => cal.tradingDaysBetween(x, y))!;
    expect(naive.days).toBeLessThan(60); // 約 52 週
    expect(byDaily.days).toBe(daily.length - 1); // 全年交易日數 − 起點
    expect(byCal.days).toBe(byDaily.days);
    // 金額與報酬率不受計日方式影響
    expect(byDaily.abs).toBe(naive.abs);
    expect(byDaily.pct).toBe(naive.pct);
  });
  it('交易日曆計數跳過週末與休市日：9/24 → 10/2 只有 4 個交易日', () => {
    expect(cal.tradingDaysBetween('2026-09-24', '2026-10-02')).toBe(4);
    expect(countDatesBetween(daily, '2026-09-24', '2026-10-02')).toBe(4);
  });
});
