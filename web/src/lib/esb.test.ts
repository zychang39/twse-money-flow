import { describe, expect, it } from 'vitest';
import type { StockHistory } from '../data/types';
import { esbFacts, isEsb } from './esb';

/** n 天的興櫃個股檔：均價從 100 起每天 +1；可指定沒有成交的日子（均價為 null） */
function hist(n: number, gaps: number[] = []): StockHistory {
  const d = Array.from({ length: n }, (_, i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  const c = d.map((_, i) => (gaps.includes(i) ? null : 100 + i));
  const nul = d.map(() => null);
  return {
    code: '6930', name: '盛新', market: 'esb', industry: null, shares: null, d, o: c, c,
    h: c.map((v) => (v === null ? null : v + 2)), l: c.map((v) => (v === null ? null : v - 2)),
    v: c.map((v) => (v === null ? null : 50)), val: c.map((v) => (v === null ? null : 5.5)), af: d.map(() => 1),
    fn: nul, tn: nul, dn: nul, mb: nul, sb: nul, pe: nul, pb: nul, dy: nul, metrics: {},
  } as StockHistory;
}

describe('興櫃個股頁的數字', () => {
  it('只有 market＝esb 才是興櫃', () => {
    expect(isEsb({ market: 'esb' })).toBe(true);
    expect(isEsb({ market: 'tpex' })).toBe(false);
    expect(isEsb(null)).toBe(false);
  });

  it('最近成交日的均價、高低、量（個股檔的量已經是張、金額是百萬元）與期間高低', () => {
    const f = esbFacts(hist(30))!;
    expect(f).toMatchObject({ date: '2026-02-02', avg: 129, high: 131, low: 127, lots: 50, valueM: 5.5, rangeHigh: 129, rangeLow: 100, days: 30, since: '2026-01-01' });
    // 近 5、20 個成交日的均價變化；60 個成交日資料不夠 → 空值（畫面顯示「—」）
    expect(f.ret.map((r) => r.n)).toEqual([5, 20, 60]);
    expect(f.ret[0].pct).toBeCloseTo((129 / 124 - 1) * 100, 6);
    expect(f.ret[1].pct).toBeCloseTo((129 / 109 - 1) * 100, 6);
    expect(f.ret[2].pct).toBeNull();
  });

  it('沒有成交的日子跳過：最後一天沒有成交時用前一個成交日；「近 5 個成交日」往回數的是成交日', () => {
    const f = esbFacts(hist(30, [29, 27]))!;
    expect(f.date).toBe('2026-02-01'); // 第 29 天（索引 28）
    expect(f.avg).toBe(128);
    expect(f.days).toBe(28);
    // 成交日：…122,123,124,125,126,(127 缺),128 → 往回 5 個成交日是 122
    expect(f.ret[0].pct).toBeCloseTo((128 / 122 - 1) * 100, 6);
  });

  it('完全沒有成交紀錄 → null（畫面說明資料累積中）', () => {
    expect(esbFacts(hist(5, [0, 1, 2, 3, 4]))).toBeNull();
  });
});
