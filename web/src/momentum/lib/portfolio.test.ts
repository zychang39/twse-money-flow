import { describe, expect, it } from 'vitest';
import { plan } from './portfolio';

describe('組合試算（與 pipeline/momentum_flow/portfolio.py 同一套規則）', () => {
  it('族群最多 3 檔、沒有價格＝資料不足、未填滿＝現金；張數與零股', () => {
    const picks = [
      { code: 'A1', name: 'a1', group: 'g1', price: 100 },
      { code: 'A2', name: 'a2', group: 'g1', price: 100 },
      { code: 'A3', name: 'a3', group: 'g1', price: 100 },
      { code: 'A4', name: 'a4', group: 'g1', price: 100 },
      { code: 'B1', name: 'b1', group: 'g2', price: 250 },
      { code: 'C1', name: 'c1', group: null, price: null },
    ];
    const out = plan(picks, 1_000_000, 10, 0.6);
    expect(out.usable).toBe(6);
    expect(out.perSlot).toBe(100_000);
    expect(out.rows.map((r) => r.code)).toEqual(['A1', 'A2', 'A3', 'B1', null, null]);
    expect(out.skipped.map((s) => s.code)).toEqual(['A4', 'C1']);
    expect(out.rows[0]).toMatchObject({ lots: 1, odd: 0, amount: 100_000 });
    expect(out.rows[3]).toMatchObject({ lots: 0, odd: 400, amount: 100_000 });
    expect(out.rows[4].name).toBe('現金');
  });

  it('族群金額上限 35%：超過者跳過，繼續看下一檔', () => {
    const picks = [0, 1, 2].map((i) => ({ code: `X${i}`, name: 'x', group: 'g', price: 100 })).concat([{ code: 'Y', name: 'y', group: 'g2', price: 100 }]);
    const out = plan(picks, 300_000, 3, 1);
    expect(out.rows.map((r) => r.code)).toEqual(['X0', 'Y', null]);
    expect(out.skipped[0].why).toContain('同一主族群試算金額');
  });

  it('資金或名額為 0 → 空', () => {
    expect(plan([], 0, 10, 1).rows).toEqual([]);
  });
});
