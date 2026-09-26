import { describe, expect, it } from 'vitest';
import { categoryScore, composite, mapScore, weightedMean } from './scores';

describe('mapScore', () => {
  it('linear：x0→0、x1→100、中間線性、超出截斷', () => {
    const m = { type: 'linear' as const, x0: -5, x1: 5 };
    expect(mapScore(-5, m)).toBe(0);
    expect(mapScore(0, m)).toBe(50);
    expect(mapScore(3, m)).toBe(80);
    expect(mapScore(99, m)).toBe(100);
    expect(mapScore(null, m)).toBeNull();
  });
  it('linear 反向（x0 > x1：越小越好）', () => {
    expect(mapScore(0.25, { type: 'linear', x0: 0.5, x1: -0.5 })).toBe(25);
  });
  it('identity / inverse', () => {
    expect(mapScore(83, { type: 'identity' })).toBe(83);
    expect(mapScore(83, { type: 'inverse' })).toBe(17);
    expect(mapScore(120, { type: 'inverse' })).toBe(0);
  });
  it('margin_matrix 四象限', () => {
    const m = { type: 'margin_matrix' as const, threshold_pct: 2, scores: { up_price_down: 15, up_price_up: 40, flat: 50, down_price_down: 55, down_price_up: 80 } };
    expect(mapScore(5, m, -1)).toBe(15);
    expect(mapScore(5, m, 1)).toBe(40);
    expect(mapScore(-5, m, 2)).toBe(80);
    expect(mapScore(-5, m, -2)).toBe(55);
    expect(mapScore(1, m, -2)).toBe(50);
    expect(mapScore(5, m, null)).toBeNull();
  });
});

describe('weights', () => {
  it('缺值不計並重新正規化', () => {
    expect(weightedMean([{ value: 80, weight: 1 }, { value: null, weight: 1 }, { value: 40, weight: 3 }])).toBe(50);
    expect(weightedMean([{ value: null, weight: 1 }])).toBeNull();
  });
  it('綜合分：至少兩個類別', () => {
    expect(composite({ chip: 80, momentum: 40 })).toBe(60);
    expect(composite({ chip: 80 })).toBeNull();
    expect(composite({ chip: 80, momentum: 40, fundamental: 60, valuation: 20 }, { chip: 2, momentum: 1, fundamental: 1, valuation: 0 })).toBe(65);
  });
  it('類別分：籌碼分手算', () => {
    // 外資連買 3 → 80；投信連賣 5 → 0；融資 +5% 且股價下跌 → 15；其他缺 → (80+0+15)/3
    const s = categoryScore('chip', { foreign_streak: 3, trust_streak: -5, margin_change: 5 }, -2);
    expect(s).toBeCloseTo(95 / 3);
  });
});
