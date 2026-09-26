import { describe, expect, it } from 'vitest';
import { correlation, equityCurve, maxDrawdown, monthlyReturns } from './portfolio';
import type { Trade } from '../db/db';

const base = { name: 'X', reasonType: '籌碼', checklist: {} as Trade['checklist'], stop: 90, target: 130 };

describe('投資組合', () => {
  it('權益曲線計入除息現金股利與除權配股', () => {
    const cal = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06'];
    const trades: Trade[] = [{ ...base, id: '1', code: 'A', status: 'open', openedAt: '2026-07-01', entry: 100, shares: 1000 }];
    const prices = { A: { dates: cal, close: [100, 102, 95, 96] } };
    // 7/03 除權息：現金股利 2 元、配股率 0.1
    const divs = { A: [{ date: '2026-07-03', cash: 2, stockRatio: 0.1 }] };
    const eq = equityCurve(1_000_000, trades, prices, divs, cal);
    expect(eq[0].equity).toBe(1_000_000);
    expect(eq[1].equity).toBe(1_002_000);
    // 7/03：現金 900000 + 2000 股利；股數 1100 × 95
    expect(eq[2].cash).toBe(902_000);
    expect(eq[2].holdings).toBe(1100 * 95);
  });
  it('平倉後現金入帳（扣費用）', () => {
    const cal = ['2026-07-01', '2026-07-02'];
    const trades: Trade[] = [{ ...base, id: '1', code: 'A', status: 'closed', openedAt: '2026-07-01', closedAt: '2026-07-02', entry: 100, exit: 110, shares: 1000, fees: 500 }];
    const eq = equityCurve(100_000, trades, { A: { dates: cal, close: [100, 110] } }, {}, cal);
    expect(eq[1].equity).toBe(100_000 + 10_000 - 500);
    expect(eq[1].holdings).toBe(0);
  });
  it('最大回撤', () => {
    expect(maxDrawdown([100, 120, 90, 130, 117])).toBeCloseTo(0.25);
  });
  it('月報酬', () => {
    const r = monthlyReturns([{ date: '2026-01-02', equity: 100 }, { date: '2026-01-30', equity: 110 }, { date: '2026-02-27', equity: 99 }]);
    expect(r.map((x) => x.month)).toEqual(['2026-01', '2026-02']);
    expect(r[0].ret).toBeCloseTo(0.1);
    expect(r[1].ret).toBeCloseTo(-0.1);
  });
  it('相關性', () => {
    const a = Array.from({ length: 70 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i)) ** i);
    expect(correlation(a, a.map((x) => x * 3))).toBeCloseTo(1);
    expect(correlation(a.slice(0, 10), a.slice(0, 10))).toBeNull();
  });
});
