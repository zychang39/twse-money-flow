import { describe, expect, it } from 'vitest';
import { sma, toOhlc } from './history';
import type { StockHistory } from '../data/types';

const h = {
  code: 'T', name: 'T', market: 'twse', industry: null, shares: null,
  d: ['2026-01-01', '2026-01-02', '2026-01-03'],
  o: [10, 9.5, 10], h: [10.5, 10, 10.2], l: [9.8, 9.4, 9.9], c: [10, 9.6, 10.1],
  v: [1, 2, 3], val: [1, 1, 1], af: [0.9, 0.9, 1], fn: [], tn: [], dn: [], mb: [], sb: [], pe: [], pb: [], dy: [], metrics: {},
} as unknown as StockHistory;

describe('history', () => {
  it('raw ohlc 保持原價', () => {
    expect(toOhlc(h, 'raw')[1]).toEqual({ time: '2026-01-02', open: 9.5, high: 10, low: 9.4, close: 9.6 });
  });
  it('還原價以因子相乘（除權息日前）', () => {
    const adj = toOhlc(h, 'adj');
    expect(adj[0].close).toBeCloseTo(9.0);
    expect(adj[2].close).toBeCloseTo(10.1);
  });
  it('sma', () => {
    expect(sma([1, 2, 3, null, 5], 2)).toEqual([null, 1.5, 2.5, null, null]);
  });
});
