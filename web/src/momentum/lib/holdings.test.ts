import { describe, expect, it } from 'vitest';
import { factorAt, parseVals, report } from './holdings';

const vals = parseVals([92, 65, -3, 20, -3, 20, 'f-a', 1.5, -0.5, 7, 1, 100])!;

describe('持股條件監看', () => {
  it('進場日的還原因子（之前最近交易日）；沒有進場日＝null', () => {
    const dates = ['2026-01-02', '2026-01-05', '2026-01-06'];
    const af = [0.5, 0.5, 1];
    expect(factorAt(dates, af, '2026-01-05')).toBe(0.5);
    expect(factorAt(dates, af, '2026-01-04')).toBe(0.5); // 假日 → 1/2
    expect(factorAt(dates, af, '2026-01-07')).toBe(1);
    expect(factorAt(dates, af, '2025-12-31')).toBeNull();
    expect(factorAt(dates, af, null)).toBeNull();
  });

  it('D2 以進場日還原因子調整成本（除權息）；沒有進場日 f＝1 並標示', () => {
    // 成本 100、進場日 f＝0.5（之後配股使還原因子加倍）→ 調整後成本 50；收盤 42 ≤ 42.5 → 觸發
    const r = report({ code: '1', name: 'x', entry: 100, shares: 1000, openedAt: '2026-01-05' }, vals, 42, 0.5, 42_000);
    expect(r.adjustedCost).toBe(50);
    expect(r.conds.find((c) => c.id === 'D2')?.result).toBe('hit');
    const r2 = report({ code: '1', name: 'x', entry: 100, shares: 1000, openedAt: null }, vals, 90, null, 90_000);
    expect(r2.conds.find((c) => c.id === 'D2')?.result).toBe('ok');
    expect(r2.costNote).toContain('未調整除權息');
  });

  it('D1 三日位元、M1 用 R 日 RS、M2 年增 < 0、M3 中位數 < 0；權重提示與緩衝區', () => {
    const r = report({ code: '1', name: 'x', entry: 80, shares: 1000, openedAt: null }, vals, 100, null, 400_000);
    const by = Object.fromEntries(r.conds.map((c) => [c.id, c.result]));
    expect(by).toEqual({ D1: 'hit', D2: 'ok', M1: 'hit', M2: 'hit', M3: 'hit' });
    expect(r.weight).toBeCloseTo(0.25);
    expect(r.weightAlert).toBe(true);
    expect(r.buffer).toBe(false); // RS 92 不在 70–85
    expect(r.passToday).toBe(true);
    const v2 = parseVals([78, 75, 10, 30, 10, null, null, null, null, 3, 0, 100])!;
    const r2 = report({ code: '2', name: 'y', entry: 80, shares: 1000, openedAt: null }, v2, 100, null, 1_000_000);
    const by2 = Object.fromEntries(r2.conds.map((c) => [c.id, c.result]));
    expect(by2).toEqual({ D1: 'ok', D2: 'ok', M1: 'ok', M2: 'na', M3: 'na' }); // 前 3 月平均無值 → M2 資料不足
    expect(r2.buffer).toBe(true);
    expect(report({ code: '3', name: 'z', entry: 80, shares: 1000, openedAt: null }, null, null, null, null).conds.every((c) => c.result === 'na')).toBe(true);
  });
});
