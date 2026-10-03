import { describe, expect, it } from 'vitest';
import { backtestCustom, decodeConditions, encodeConditions, matches, sameConditions, screen, screenIdentity, testCondition } from './screener';
import { screenerConfig, type Condition } from './config';

const rows = [
  { code: 'A', composite: 70, rs_percentile: 70, trust_streak: 4, revenue_yoy_3m: 25 },
  { code: 'B', composite: 80, rs_percentile: 80, trust_streak: 1, revenue_yoy_3m: 30 },
  { code: 'C', composite: 60, trust_streak: 5, revenue_yoy_3m: null },
];

describe('screener', () => {
  it('單一條件與運算子', () => {
    expect(testCondition(rows[0], { field: 'trust_streak', op: '>=', value: 4 })).toBe(true);
    expect(testCondition(rows[0], { field: 'trust_streak', op: '>', value: 4 })).toBe(false);
    expect(testCondition(rows[0], { field: 'composite', op: 'between', value: [60, 70] })).toBe(true);
    expect(testCondition(rows[2], { field: 'revenue_yoy_3m', op: '<', value: 100 })).toBe(false); // 缺值不成立
  });
  it('AND 組合並依 RS 百分位排序（綜合分已移除）', () => {
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

describe('#11 條件是否等於內建組合', () => {
  const presets = [
    { id: 'chip', label: '籌碼集中', conditions: [{ field: 'trust_streak', op: '>=', value: 3 }, { field: 'foreign_net_5d', op: '>', value: 0 }, { field: 'whale_change', op: '>', value: 0 }, { field: 'value_million', op: '>=', value: 20 }] as Condition[] },
    { id: 'rev', label: '營收加速', conditions: [{ field: 'revenue_yoy_3m', op: '>=', value: 20 }] as Condition[] },
  ];
  const chip = presets[0].conditions;
  it('相同條件（順序不同、數值為字串也算）→ 用內建名稱', () => {
    expect(sameConditions(chip, [...chip].reverse())).toBe(true);
    expect(sameConditions(chip, chip.map((c) => ({ ...c, value: String(c.value) as unknown as number })))).toBe(true);
    expect(screenIdentity([...chip].reverse(), 'chip', presets, [])).toEqual({ name: '籌碼集中', presetId: 'chip', savedId: null, modifiedFrom: null });
  });
  it('刪除兩個條件後 → 「自訂條件」、不選取內建組合，記下從哪個組合修改', () => {
    const edited = chip.filter((c) => c.field !== 'foreign_net_5d' && c.field !== 'whale_change');
    expect(sameConditions(chip, edited)).toBe(false);
    expect(screenIdentity(edited, 'chip', presets, [])).toEqual({ name: '自訂條件', presetId: null, savedId: null, modifiedFrom: '籌碼集中' });
    // 門檻改變也算不同
    expect(screenIdentity(chip.map((c) => (c.field === 'trust_streak' ? { ...c, value: 5 } : c)), 'chip', presets, []).presetId).toBeNull();
  });
  it('改回和另一個內建組合相同 → 用那個組合的名稱', () => {
    expect(screenIdentity(presets[1].conditions, 'chip', presets, []).presetId).toBe('rev');
  });
  it('我的組合：相同 → 原名；改過 →「名稱（已修改）」', () => {
    const saved = [{ id: 's1', label: '我的', conditions: [{ field: 'composite', op: '>=', value: 60 }] as Condition[] }];
    expect(screenIdentity(saved[0].conditions, 's1', presets, saved).name).toBe('我的');
    expect(screenIdentity([{ field: 'composite', op: '>=', value: 70 }], 's1', presets, saved)).toMatchObject({ name: '我的（已修改）', savedId: 's1' });
  });
  it('回測頁：網址名稱和內建組合同名但條件不同 →「籌碼集中（已修改）」；條件相同 → 直接用內建組合', () => {
    const edited = chip.slice(0, 2);
    expect(backtestCustom(edited, '籌碼集中', presets)).toEqual({ name: '籌碼集中（已修改）', presetId: null });
    expect(backtestCustom(chip, '籌碼集中', presets)).toEqual({ name: '籌碼集中', presetId: 'chip' });
    expect(backtestCustom(edited, null, presets).name).toBe('自訂條件');
  });
});
