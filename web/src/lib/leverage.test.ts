import { describe, expect, it } from 'vitest';
import { BREAKER_TEXT, leverage, nearestSlots } from './leverage';

const rules = { ceiling: 2.5, margin_loan_ratio: 0.6, maintenance_call: 130, lock_days: 2, limit_pct: 10 };
const base = { capital: 1_000_000, maxDd: 20, slots: 5, interest: 6, breaker: 10, accountDd: null };

describe('槓桿風險計算（手算）', () => {
  it('回撤限制：L_dd = 20% ÷ 40% = 0.5；半凱利 = 0.5 × (30% − 6%) ÷ 40%² = 0.75 → 取 0.5', () => {
    const r = leverage(base, { mdd: -40, mu_ann: 30, vol_ann: 40, ann_return: 25 }, {}, rules);
    expect(r.lDd).toBe(0.5);
    expect(r.lKelly).toBe(0.75);
    expect(r.multiple).toBe(0.5);
    expect(r.limitedBy).toBe('drawdown');
    expect(r.loan).toBe(0);
    expect(r.scenarios[0].loss).toBeCloseTo(200_000); // 50 萬 × 40%
    expect(r.scenarios[1].loss).toBeCloseTo(19_000); // 50 萬 ÷ 5 × 19%（沒有不利波動資料時只有回撤與跌停情境）
    expect(r.scenarios[2].loss).toBeCloseTo(95_000);
    expect(r.scenarios[0].maintenance).toBeNull();
  });
  it('2 倍：融資 100 萬、融資買進市值 166.7 萬；最大回撤 10% → 維持率 150%；全部連續 2 日跌停 → 135%', () => {
    const r = leverage(base, { mdd: -10, mu_ann: 50, vol_ann: 30, ann_return: 20 }, {}, rules);
    expect(r.lKelly).toBeCloseTo(2.44, 2);
    expect(r.multiple).toBe(2);
    expect(r.loan).toBe(1_000_000);
    expect(r.interestYear).toBe(60_000);
    expect(r.scenarios[0].maintenance).toBeCloseTo(150, 1);
    expect(r.scenarios[1].maintenance).toBeCloseTo(160.33, 1);
    expect(r.scenarios[2].maintenance).toBeCloseTo(135, 1);
    expect(r.scenarios[2].call).toBe(false);
    expect(r.netReturn).toBe(34); // 20% × 2 − 6% × 1
  });
  it('天花板 2.5 倍；跌破 130% 標示追繳', () => {
    const r = leverage({ ...base, maxDd: 50 }, { mdd: -5, mu_ann: 80, vol_ann: 20, ann_return: 60 }, {}, rules);
    expect(r.multiple).toBe(2.5);
    expect(r.limitedBy).toBe('ceiling');
    const big = leverage({ ...base, maxDd: 50 }, { mdd: -30, mu_ann: 80, vol_ann: 20 }, {}, rules);
    expect(big.multiple).toBeCloseTo(1.67, 2);
    expect(big.scenarios[0].maintenance! < 130).toBe(true);
    expect(big.scenarios[0].call).toBe(true);
  });
  it('報酬低於利率 → 半凱利 0 倍', () => {
    const r = leverage(base, { mdd: -10, mu_ann: 4, vol_ann: 30 }, {}, rules);
    expect(r.lKelly).toBe(0);
    expect(r.multiple).toBe(0);
  });
  it('回撤斷路器：帳戶或策略回撤超過門檻', () => {
    expect(leverage({ ...base, accountDd: 12 }, { mdd: -20 }, {}, rules).breaker).toBe(true);
    expect(leverage(base, { mdd: -20, current_dd: -15 }, {}, rules).breakerReason).toContain('策略');
    expect(leverage({ ...base, accountDd: 12 }, { mdd: -20 }, {}, rules).breakerReason).not.toMatch(/你/);
    expect(leverage(base, { mdd: -20, current_dd: -5 }, {}, rules).breaker).toBe(false);
    expect(BREAKER_TEXT).toBe('回撤斷路器：依設定的規則，槓桿倍數為 1 倍');
  });
  it('最接近的模擬組合', () => {
    expect(nearestSlots(4, [1, 3, 5, 10])).toBe(3);
    expect(nearestSlots(8, [1, 3, 5, 10])).toBe(10);
  });
});

describe('組合層級風險（2026-10-03）', () => {
  it('組合最大回撤優先於組合資料的 mdd；最大不利波動 30%、回撤 50% → L_dd = min(20/50, 20/30) = 0.4', () => {
    const r = leverage(base, { mdd: -10, mu_ann: 80, vol_ann: 20 }, { port_mdd: -50, port_max_adverse: -30, window: 40 }, rules);
    expect(r.lDd).toBeCloseTo(0.4, 2);
    expect(r.scenarios[0].label).toContain('組合最大回撤');
    expect(r.scenarios[0].loss).toBeCloseTo(200_000); // 40 萬 × 50%
    expect(r.scenarios[1].label).toContain('40 日內最大不利波動');
    expect(r.scenarios[1].loss).toBeCloseTo(120_000); // 40 萬 × 30%
  });
  it('只有最大不利波動時用它限制倍數：20% ÷ 10% = 2 倍', () => {
    const r = leverage(base, { mu_ann: 80, vol_ann: 20 }, { port_max_adverse: -10 }, rules);
    expect(r.lDd).toBeCloseTo(2, 2);
  });
});
