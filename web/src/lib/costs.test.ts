import { describe, expect, it } from 'vitest';
import { commission, roundTrip, tax } from './costs';

describe('交易成本', () => {
  it('手續費：0.1425% × 六折，最低 20 元（無條件捨去到元）', () => {
    expect(commission(100_000)).toBe(85); // 100000 × 0.001425 × 0.6 = 85.5 → 85
    expect(commission(5_000)).toBe(20); // 4.275 → 最低 20
    expect(commission(5_000, { discount: 0.6, minimumEnabled: false })).toBe(4);
  });
  it('證交稅：股票 0.3%、ETF 0.1%', () => {
    expect(tax(100_000, false)).toBe(300);
    expect(tax(100_000, true)).toBe(100);
  });
  it('一買一賣（手算）', () => {
    // 買 100 元 × 1000 股 = 100000，手續費 85；賣 110 元 = 110000，手續費 94（94.05）、稅 330
    const r = roundTrip(100, 110, 1000, '2330');
    expect(r.costs).toBe(85 + 94 + 330);
    expect(r.pnl).toBe(110000 - 94 - 330 - 100085);
    expect(r.ret).toBeCloseTo(r.pnl / 100085);
  });
});
