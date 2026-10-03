import { describe, expect, it } from 'vitest';
import { MARGIN_USAGE_MISSING, PV_LABELS, basisText, deltaMissingReason, foreignHoldLine, creditAnswer, creditSummary, deltaOver, lotsDelta, marginUsageText, priceMarginLabel, shortAnswer, shortRatio, shortRatioHigh } from './credit';

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

describe('#5 不套用價量標籤時寫出原因（2026-10-02 健檢）', () => {
  const cfg = { compare_days: [5, 20] as [number, number], pv_days: 5, short_ratio_high: 30, foreign_change_days: 5 };
  it('股價 5 日持平、融資 5 日 −6.40% → 「股價 5 日 0.00%（持平）、融資 5 日 −6.40%」', () => {
    const adj = [100, 100, 100, 100, 100, 100, 100, 100];
    const mb = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 936]; // 936 ÷ 1000 − 1 ＝ −6.4%
    const s = creditSummary({ d, adj, mb, sb: mb.map(() => 10) }, cfg);
    expect(s.pv.label).toBeNull();
    expect(s.pv.reason).toBe('股價 5 日 0.00%（持平）、融資 5 日 −6.40%');
    expect(s.pv.reason).not.toMatch(/持平或資料不足/);
    expect(creditAnswer(s)).toBe('價量不套用標籤，融資 5 日 −6.4%');
  });
  it('基準日缺融資資料 → 「融資 9/17 無資料」；有標籤時 reason 為 null', () => {
    const adj = [98, 99, 100, 101, 102, 103, 103.5, 104];
    const mb = [900, 950, null, 1020, 1040, 1060, 1080, 1100];
    const s = creditSummary({ d, adj, mb, sb: mb.map(() => 10) }, cfg);
    expect(s.pv.label).toBeNull();
    expect(s.pv.reason).toBe('股價 5 日 +4.00%、融資 9/17 無資料');
    const ok = creditSummary({ d, adj, mb: [900, 950, 1000, 1020, 1040, 1060, 1080, 1100], sb: mb.map(() => 10) }, cfg);
    expect(ok.pv.label?.label).toBe('價漲資增');
    expect(ok.pv.reason).toBeNull();
  });
  it('資料不足 5 日 → 「股價資料不足 5 日」', () => {
    const s = creditSummary({ d: d.slice(0, 3), adj: [1, 2, 3], mb: [10, 11, 12], sb: [0, 0, 0] }, cfg);
    expect(s.pv.reason).toBe('股價資料不足 5 日、融資資料不足 5 日');
  });
});

describe('空方與融資使用率', () => {
  it('券資比＝融券 ÷ 融資；融資 0 或缺值 → null', () => {
    expect(shortRatio(50, 1000)).toBeCloseTo(5);
    expect(shortRatio(50, 0)).toBeNull();
    expect(shortRatio(null, 1000)).toBeNull();
    expect(shortRatioHigh(29.9, { compare_days: [5, 20], pv_days: 5, short_ratio_high: 30, foreign_change_days: 20 })).toBe(false);
  });
  it('融資使用率取不到時說明原因：pipeline 已回看 5 日補值，仍為 null → 「非融資標的或官方未提供融資限額」（不再寫「當日資料未公布」）', () => {
    expect(marginUsageText(null)).toEqual({ text: `—（${MARGIN_USAGE_MISSING}）`, reason: '非融資標的或官方未提供融資限額' });
    expect(marginUsageText(null).reason).not.toMatch(/當日|未公布/);
    expect(marginUsageText(12.345)).toEqual({ text: '12.3%', reason: null });
  });
  it('變化值缺值的原因：沒有資料／基準日無資料／資料不足 N 日', () => {
    expect(deltaMissingReason(deltaOver(d, [null, null, null, null, null, null, null, null], 5), '融資')).toBe('沒有融資資料');
    expect(deltaMissingReason(deltaOver(d, [900, 950, null, 1020, 1040, 1060, 1080, 1100], 5), '融資')).toBe('9/17 無融資資料');
    expect(deltaMissingReason(deltaOver(d.slice(0, 3), [1, 2, 3], 5), '融券')).toBe('融券資料不足 5 日');
  });
});

describe('#5 外資持股比與 20 個交易日前相比', () => {
  const d = ['2026-08-27', '2026-08-28', '2026-09-24'];
  it('沒有前值：顯示「變化：資料累積中」，不是持平的破折號', () => {
    const line = foreignHoldLine(deltaOver(d, [null, 69.1, 69.2], 2))!;
    expect(line).toEqual({ value: '69.20%', change: '變化：資料累積中', dir: 'na' });
  });
  it('持平', () => {
    expect(foreignHoldLine(deltaOver(d, [69.2, 69.1, 69.2], 2))).toEqual({ value: '69.20%', change: '持平', dir: 'flat' });
  });
  it('上升與下降：百分點，數值在前', () => {
    expect(foreignHoldLine(deltaOver(d, [68.85, 69.1, 69.2], 2))).toEqual({ value: '69.20%', change: '▲0.35 百分點', dir: 'up' });
    expect(foreignHoldLine(deltaOver(d, [69.5, 69.1, 69.2], 2))).toEqual({ value: '69.20%', change: '▼0.30 百分點', dir: 'down' });
  });
  it('沒有持股比 → 不顯示這一行', () => {
    expect(foreignHoldLine(deltaOver(d, [null, null, null], 2))).toBeNull();
  });
});
