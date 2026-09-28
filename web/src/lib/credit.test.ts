import { describe, expect, it } from 'vitest';
import { PV_LABELS, basisText, creditAnswer, creditSummary, deltaOver, lotsDelta, marginUsageText, priceMarginLabel, shortAnswer, shortRatio, shortRatioHigh } from './credit';

// 8 個交易日（手算用）
const d = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

describe('比較基準', () => {
  it('與 5 個交易日前相比（手算）：融資 1,000 → 1,100 張 = ▲100 張（+10.0%），基準日 9/17', () => {
    const mb = [900, 950, 1000, 1020, 1040, 1060, 1080, 1100];
    const x = deltaOver(d, mb, 5);
    expect(x).toMatchObject({ now: 1100, then: 1000, thenDate: '2026-09-17', abs: 100 });
    expect(x.pct).toBeCloseTo(10);
    expect(basisText(x)).toBe('與 5 個交易日前（9/17）相比');
    expect(lotsDelta(x)).toBe('▲100 張（+10.0%）');
  });
  it('最新一天缺值時以最後一個有值的日子為準；基準缺值 → 變化為「—」', () => {
    const mb = [null, 950, 1000, 1020, 1040, 1060, 1080, null];
    const x = deltaOver(d, mb, 5);
    expect(x.now).toBe(1080);
    expect(x.thenDate).toBe('2026-09-16');
    expect(deltaOver(d, [null, null, null, 1, 1, 1, 1, 1], 5).abs).toBeNull();
    expect(lotsDelta(deltaOver(d, [null, null, null, 1, 1, 1, 1, 1], 5))).toBe('—');
    expect(basisText(deltaOver(d, [1, 2], 5))).toBe('與 5 個交易日前相比（資料不足）');
  });
});

describe('價量解讀（股價 × 融資 5 日方向）', () => {
  it('四種標籤', () => {
    expect(priceMarginLabel(2.1, 300)?.label).toBe('價漲資增');
    expect(priceMarginLabel(2.1, 300)?.tag).toBe('散戶追價');
    expect(priceMarginLabel(1, -50)).toBe(PV_LABELS.up_down);
    expect(priceMarginLabel(1, -50)?.tag).toBe('籌碼沉澱');
    expect(priceMarginLabel(-3, 10)?.tag).toBe('散戶攤平');
    expect(priceMarginLabel(-3, -10)?.tag).toBe('融資退場');
  });
  it('任一方持平或缺資料 → 不套標籤', () => {
    expect(priceMarginLabel(0, 10)).toBeNull();
    expect(priceMarginLabel(1, 0)).toBeNull();
    expect(priceMarginLabel(null, 10)).toBeNull();
  });
  it('說明句中性（不出現買進／賣出／建議）', () => {
    for (const l of Object.values(PV_LABELS)) expect(l.note).not.toMatch(/買進|賣出|建議|應該/);
  });
  it('彙整（手算）：還原價 100 → 104（+4%）、融資 1,000 → 1,100（+10%）→ 價漲資增', () => {
    const adj = [98, 99, 100, 101, 102, 103, 103.5, 104];
    const mb = [900, 950, 1000, 1020, 1040, 1060, 1080, 1100];
    const sb = [200, 210, 220, 230, 240, 250, 300, 330];
    const s = creditSummary({ d, adj, mb, sb, marginUsage: 12.34, sbl: [5, 5, 5, 5, 5, 5, 5, 6], qfii: [70, 70.1, 70.2, 70.3, 70.3, 70.4, 70.5, 70.6], lastCover: '2026-10-20' }, { compare_days: [5, 20], pv_days: 5, short_ratio_high: 30, foreign_change_days: 5 });
    expect(s.pv.label?.label).toBe('價漲資增');
    expect(s.pv.price.pct).toBeCloseTo(4);
    // 券資比 = 330 ÷ 1,100 = 30.0% → 偏高（≥ 30%）
    expect(s.short.ratio).toBeCloseTo(30);
    expect(s.short.high).toBe(true);
    expect(s.short.bal.abs).toBe(110);
    expect(s.foreign.chg.abs).toBeCloseTo(0.4); // 70.6 − 70.2（5 個交易日前 9/17）
    expect(s.margin.d20.abs).toBeNull(); // 只有 8 天，20 日變化 —
    expect(creditAnswer(s)).toBe('價漲資增（散戶追價），融資 5 日 +10.0%');
    expect(shortAnswer(s, { compare_days: [5, 20], pv_days: 5, short_ratio_high: 30, foreign_change_days: 5 })).toBe('券資比 30.0%，偏高（≥ 30%），留意軋空');
  });
});

describe('空方與融資使用率', () => {
  it('券資比＝融券 ÷ 融資；融資 0 或缺值 → null', () => {
    expect(shortRatio(50, 1000)).toBeCloseTo(5);
    expect(shortRatio(50, 0)).toBeNull();
    expect(shortRatio(null, 1000)).toBeNull();
    expect(shortRatioHigh(29.9, { compare_days: [5, 20], pv_days: 5, short_ratio_high: 30, foreign_change_days: 20 })).toBe(false);
  });
  it('融資使用率取不到時說明原因', () => {
    expect(marginUsageText(null)).toMatchObject({ text: '—' });
    expect(marginUsageText(null).reason).toMatch(/融資限額/);
    expect(marginUsageText(12.345)).toEqual({ text: '12.3%', reason: null });
  });
});
