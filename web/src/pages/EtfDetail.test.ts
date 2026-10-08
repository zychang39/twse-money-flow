import { describe, expect, it } from 'vitest';
import { changeSub, clampRange, quickOf, quickOptions } from './EtfDetail';
import type { PairRow } from '../lib/etfDetail';

const row = (p: Partial<PairRow>): PairRow => ({ code: '2330', name: '台積電', w0: 1, w1: 2, dWeight: 1, s0: 0, s1: 0, kind: 'hold', tradeShares: 0, ...p });

describe('ETF 詳細頁：期間', () => {
  it('快速選項：往回次數超過可用天數的不列', () => {
    expect(quickOptions(3)).toEqual(['1', 'all', 'custom']);
    expect(quickOptions(30)).toEqual(['1', '5', '20', 'all', 'custom']);
  });
  it('目前區間對應的快速選項', () => {
    expect(quickOf(30, 28, 29)).toBe('1');
    expect(quickOf(30, 24, 29)).toBe('5');
    expect(quickOf(30, 0, 29)).toBe('all');
    expect(quickOf(30, 3, 20)).toBe('custom');
    expect(quickOf(2, 0, 1)).toBe('all'); // 只有兩天：選項只有「全部｜自訂」
  });
  it('滑桿：起日至少比迄日早一次，碰到時推著另一個走', () => {
    expect(clampRange(8, 7, 7, 'from')).toEqual([6, 7]);
    expect(clampRange(8, 5, 3, 'from')).toEqual([5, 6]);
    expect(clampRange(8, 4, 0, 'to')).toEqual([0, 1]);
    expect(clampRange(8, 4, 2, 'to')).toEqual([1, 2]);
  });
});

describe('ETF 詳細頁：列的副資訊', () => {
  it('分類與股數變化（張）', () => {
    expect(changeSub(row({ kind: 'add', s0: 50_000, s1: 80_000 }))).toBe('加碼・+30 張');
    expect(changeSub(row({ kind: 'reduce', s0: 60_000, s1: 30_000 }))).toBe('減碼・−30 張');
    expect(changeSub(row({ kind: 'new', s0: 0, s1: 20_000 }))).toBe('新增・20 張');
    expect(changeSub(row({ kind: 'exit', s0: 40_000, s1: 0 }))).toBe('剔除・40 張');
    expect(changeSub(row({ kind: 'hold', s0: 100_000, s1: 110_000 }))).toBe('不變（申購買回 +10 張）');
    expect(changeSub(row({ kind: 'hold', s0: 5_000, s1: 5_000 }))).toBe('股數不變');
  });
  it('文字不用買賣建議用語', () => {
    const all = ['add', 'reduce', 'new', 'exit', 'hold', null].map((k) => changeSub(row({ kind: k as PairRow['kind'], s0: 1000, s1: 3000 })));
    for (const t of all) expect(t).not.toMatch(/買進|賣出/);
  });
});
