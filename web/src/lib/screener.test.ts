import { describe, expect, it } from 'vitest';
import { decodeConditions, encodeConditions, matches, screen, testCondition } from './screener';
import { screenerConfig } from './config';

const rows = [
  { code: 'A', composite: 70, trust_streak: 4, revenue_yoy_3m: 25 },
  { code: 'B', composite: 80, trust_streak: 1, revenue_yoy_3m: 30 },
  { code: 'C', composite: 60, trust_streak: 5, revenue_yoy_3m: null },
];

describe('screener', () => {
  it('單一條件與運算子', () => {
    expect(testCondition(rows[0], { field: 'trust_streak', op: '>=', value: 4 })).toBe(true);
    expect(testCondition(rows[0], { field: 'trust_streak', op: '>', value: 4 })).toBe(false);
    expect(testCondition(rows[0], { field: 'composite', op: 'between', value: [60, 70] })).toBe(true);
    expect(testCondition(rows[2], { field: 'revenue_yoy_3m', op: '<', value: 100 })).toBe(false); // 缺值不成立
  });
  it('AND 組合並依綜合分排序', () => {
    const out = screen(rows, [{ field: 'trust_streak', op: '>=', value: 1 }, { field: 'revenue_yoy_3m', op: '>=', value: 20 }]);
    expect(out.map((r) => r.code)).toEqual(['B', 'A']);
    expect(matches(rows[2], [])).toBe(true);
  });
  it('網址編碼往返', () => {
    const cs = [{ field: 'rs_percentile', op: '>=' as const, value: 80 }];
    expect(decodeConditions(encodeConditions(cs))).toEqual(cs);
    expect(decodeConditions('%%%')).toBeNull();
  });
  it('內建預設組合的欄位都存在於欄位定義', () => {
    for (const p of screenerConfig.presets) for (const c of p.conditions) expect(screenerConfig.fields[c.field]).toBeDefined();
  });
});
