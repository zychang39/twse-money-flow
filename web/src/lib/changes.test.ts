import { describe, expect, it } from 'vitest';
import { instReasonText } from './changes';

describe('#8 清單列理由：數字在前、格式精簡', () => {
  it('M3：「外資＋投信 −24,000 張・量 70%」：完整張數（不縮寫成萬）', () => {
    expect(instReasonText(-24_000, 34_286)).toBe('外資＋投信 −24,000\u00a0張・量\u00a070%');
    expect(instReasonText(315, 1_000)).toBe('外資＋投信 +315\u00a0張・量\u00a032%');
  });
  it('大數字也不出現萬', () => {
    expect(instReasonText(-2_400_000, 3_428_600)).not.toContain('萬');
  });
});

describe('stock 2026-10-03：自選股異動的法人理由改成「佔 20 日均量」＋量比倍數', () => {
  it('summary 有 vol20_lots／vol_ratio 時用新格式', async () => {
    const { diffRow } = await import('./changes');
    const r = { code: '2330', name: '台積電', flags: [], close: 100, change: 0, change_pct: 0, foreign_streak: 0, trust_streak: 0, margin_balance: null, margin_change: null,
      volume_lots: 10_000, foreign_net_lots: 5_000, trust_net_lots: 887, vol20_lots: 7_576, vol_ratio: 1.32 } as never;
    const c = diffRow(r, undefined);
    const inst = c.reasons.find((x) => x.kind === 'inst');
    expect(inst?.text).toBe('外資+投信 +5,887 張（佔 20 日均量 78%）・量 1.32×');
  });
});
