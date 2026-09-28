import { describe, expect, it } from 'vitest';
import { rangeReturn } from './rangeReturn';

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
