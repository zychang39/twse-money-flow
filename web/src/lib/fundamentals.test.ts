import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { high52w, momentumFacts } from './fundamentals';
import { adjClose } from './history';
import type { StockHistory } from '../data/types';

// #2：距 52 週高點用還原價。golden 與 pytest（tests/pipeline/test_split_52w.py）共用。
const golden = JSON.parse(readFileSync(new URL('../../../tests/fixtures/golden/split_52w.json', import.meta.url), 'utf8')) as {
  window: number; dates: string[]; close: (number | null)[]; af: number[];
  expected: { dist_52w_high_pct: number; high_date: string; high_adj: number; raw_dist_pct_wrong: number };
};

describe('距 52 週高點（區間內有 1:4 分割）', () => {
  const h = { d: golden.dates, c: golden.close, af: golden.af } as unknown as StockHistory;
  const adj = adjClose(h);

  it('分割前的高點先乘上還原因子（480 × 0.25 = 120）再和現價比較', () => {
    const r = high52w(adj, golden.dates, golden.window)!;
    expect(r.value).toBeCloseTo(golden.expected.high_adj, 6);
    expect(r.date).toBe(golden.expected.high_date);
    expect(r.dist).toBeCloseTo(golden.expected.dist_52w_high_pct, 6);
  });

  it('對照：用原始價會得到假的大幅落後', () => {
    const r = high52w(golden.close, golden.dates, golden.window)!;
    expect(r.dist).toBeCloseTo(golden.expected.raw_dist_pct_wrong, 6);
  });

  it('momentumFacts：pipeline 的值優先；缺少時用還原價計算，並帶出高點與日期', () => {
    const withMetric = momentumFacts(adj, { dist_52w_high: -8.4 }, golden.dates);
    expect(withMetric.dist52).toBe(-8.4);
    expect(withMetric.high52).toEqual({ value: golden.expected.high_adj, date: golden.expected.high_date });
    const fallback = momentumFacts(adj, {}, golden.dates);
    expect(fallback.dist52).toBeCloseTo(golden.expected.dist_52w_high_pct, 6);
  });

  it('有效資料少於 60 天 → null', () => {
    expect(high52w([1, 2, 3], ['a', 'b', 'c'])).toBeNull();
  });
});

import { FAIR_BASIS, fairPosition } from './fundamentals';
describe('合理價區間的位置（2026-10-02 健檢）', () => {
  const combined = { cheap: 1123.59, fair: 1402.19, expensive: 1749.32 };
  it('position 超過 1（2330：2.2）→ 寫「收盤高於區間上緣 X%」，不寫 100%；標記夾在 1', () => {
    const r = fairPosition({ combined, position: 2.2, price: 2500 });
    expect(r.marker).toBe(1);
    // 手算：2500 ÷ 1749.32 − 1 ＝ 42.91%
    expect(r.text).toBe(`合理價區間（${FAIR_BASIS}）：收盤高於區間上緣 42.91%`);
    expect(r.text).not.toContain('100%');
  });
  it('區間內 → 「位於區間 62%」；低於下緣 → 「收盤低於區間下緣 X%」', () => {
    expect(fairPosition({ combined, position: 0.62, price: 1511.5 }).text).toBe(`合理價區間（${FAIR_BASIS}）：位於區間 62%`);
    const low = fairPosition({ combined, position: -0.1, price: 1011.231 });
    expect(low.marker).toBe(0);
    expect(low.text).toContain('收盤低於區間下緣 10.00%');
  });
  it('沒有合併區間 → 附原因的「—」', () => {
    expect(fairPosition({ combined: null, position: null, price: 100 }).text).toContain('—（');
    expect(fairPosition(null).text).toContain('—（');
  });
});
