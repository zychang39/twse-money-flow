import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holdingsAt, pairChanges, quickRange, sortByChange, type EtfDetail } from './etfDetail';

/** pipeline（tests/pipeline/test_etf_detail.py）產生的同一份 golden：前端分類必須與 _pair 一致。 */
const golden = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/golden/etf_pair.json', import.meta.url), 'utf8'),
) as {
  detail: EtfDetail;
  pairs: { i0: number; i1: number; basis: string | null; flow: number | null; rows: Record<string, { kind: string | null; d_weight: number; trade_shares: number | null }> }[];
};

describe('任兩次揭露的加碼／減碼（與 pipeline _pair 相同）', () => {
  for (const p of golden.pairs) {
    it(`${golden.detail.dates[p.i0]} → ${golden.detail.dates[p.i1]}（${p.basis}）`, () => {
      const res = pairChanges(golden.detail, p.i0, p.i1);
      expect(res.basis).toBe(p.basis);
      if (p.flow === null) expect(res.flow).toBeNull();
      else expect(res.flow).toBeCloseTo(p.flow, 6);
      expect(new Set(res.rows.map((r) => r.code))).toEqual(new Set(Object.keys(p.rows)));
      for (const r of res.rows) {
        const e = p.rows[r.code];
        expect(r.kind, r.code).toBe(e.kind);
        expect(r.dWeight, r.code).toBeCloseTo(e.d_weight, 4);
        if (e.trade_shares === null) expect(r.tradeShares).toBeNull();
        else expect(r.tradeShares, r.code).toBeCloseTo(e.trade_shares, 6);
      }
    });
  }
});

describe('排序與區間', () => {
  it('權重增加最多在上、減少最多在下', () => {
    const rows = sortByChange(pairChanges(golden.detail, 0, 1).rows);
    const dw = rows.map((r) => r.dWeight ?? 0);
    expect(dw).toEqual([...dw].sort((a, b) => b - a));
    expect(rows[0].code).toBe('2330');
    expect(rows.at(-1)!.code).toBe('2412');
  });
  it('快速區間：往回 n 次揭露，超出時取最早一天', () => {
    expect(quickRange(4, 1)).toEqual([2, 3]);
    expect(quickRange(4, 20)).toEqual([0, 3]);
    expect(quickRange(4, null)).toEqual([0, 3]);
  });
  it('迄日持股依權重排序，不含當天沒有持有的', () => {
    const h = holdingsAt(golden.detail, 3);
    expect(h[0].code).toBe('2330');
    expect(h.find((x) => x.code === '2412')).toBeUndefined();
  });
});
