import { describe, expect, it } from 'vitest';
import { byReason, closedStats, countBy, expectancy, lossIfAllStopped, positionSize, rMultiple, rewardRisk } from './sizing';
import type { Trade } from '../db/db';

describe('部位大小', () => {
  it('張數：無條件捨去', () => {
    // 100 萬 × 1% = 1 萬；每股風險 5 元 → 2000 股 → 2 張
    expect(positionSize(1_000_000, 1, 100, 95)).toEqual({ shares: 2000, lots: 2, riskAmount: 10000 });
    // 每股風險 3 元 → 3333 股 → 3 張（3000 股）
    expect(positionSize(1_000_000, 1, 100, 97).lots).toBe(3);
  });
  it('零股模式回傳股數', () => {
    expect(positionSize(1_000_000, 1, 100, 97, true).shares).toBe(3333);
  });
  it('停損不低於進場價 → 0', () => {
    expect(positionSize(1_000_000, 1, 100, 100).shares).toBe(0);
  });
  it('風險報酬比', () => {
    expect(rewardRisk(100, 95, 115)).toBe(3);
    expect(rewardRisk(100, 100, 115)).toBeNull();
  });
});

describe('期望值', () => {
  it('勝率 × 平均獲利 − 敗率 × 平均虧損', () => {
    expect(expectancy(0.4, 3000, 1000)).toBeCloseTo(600);
  });
  const base = { name: 'X', reasonType: '籌碼', checklist: {} as Trade['checklist'], status: 'closed' as const, shares: 1000, stop: 95, target: 120 };
  const trades: Trade[] = [
    { ...base, id: '1', code: 'A', openedAt: '2026-01-01', closedAt: '2026-01-11', entry: 100, exit: 110, errorTags: ['追高'] },
    { ...base, id: '2', code: 'B', openedAt: '2026-01-01', closedAt: '2026-01-06', entry: 100, exit: 95, errorTags: ['追高', '未守停損'] },
    { ...base, id: '3', code: 'C', openedAt: '2026-01-01', closedAt: '2026-01-21', entry: 100, exit: 115, reasonType: '營收' },
  ];
  it('交易統計（金額與 R 倍數）', () => {
    const s = closedStats(trades);
    expect(s.n).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.avgWin).toBe(12500);
    expect(s.avgLoss).toBe(5000);
    expect(s.evAmount).toBeCloseTo((2 / 3) * 12500 - (1 / 3) * 5000);
    // R：+2、−1、+3 → EV_R = 2/3 × 2.5 − 1/3 × 1
    expect(s.evR).toBeCloseTo((2 / 3) * 2.5 - 1 / 3);
    expect(s.avgHoldDays).toBeCloseTo((10 + 5 + 20) / 3);
    expect(rMultiple(trades[1])).toBe(-1);
  });
  it('錯誤標籤頻率與理由類型績效', () => {
    expect(countBy(trades, (t) => t.errorTags)).toEqual({ 追高: 2, 未守停損: 1 });
    const g = byReason(trades);
    expect(g.find((x) => x.reason === '營收')?.stats.n).toBe(1);
  });
  it('全部觸及停損的總虧損', () => {
    expect(lossIfAllStopped([{ shares: 1000, stop: 95, price: 100 }, { shares: 2000, stop: 50, price: 48 }])).toBe(5000);
  });
});
