import { describe, expect, it } from 'vitest';
import { sortDaily } from './today';
import type { StockRow } from '../data/types';

const row = (code: string, extra: Partial<StockRow>): StockRow => ({ code, name: code, flags: [], ...extra }) as StockRow;

describe('今日日報排序', () => {
  it('新旗標 > 漲跌；綜合分變化不參與排序（SPEC §5.7）', () => {
    const rows = [
      row('A', { change_pct: 9 }),
      row('B', { composite_chg: -8 }),
      row('C', { new_flags: ['attention'] }),
    ];
    expect(sortDaily(rows).map((r) => r.code)).toEqual(['C', 'A', 'B']);
  });
});
