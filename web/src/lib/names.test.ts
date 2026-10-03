import { describe, expect, it } from 'vitest';
import { STRATEGY_NAMES, canonicalStrategyName, displayName, strategyByTest } from './names';

describe('策略／指標名稱表：全站同一個名字（2026-10-02 健檢 M1-1）', () => {
  it('有策略的指標顯示策略名，指標名改為副標', () => {
    expect(displayName('rev_high12', '營收創 12 個月新高')).toEqual({ label: '營收一年高', sub: '指標：營收創 12 個月新高' });
    expect(displayName('lead_up', '公布前先漲・營收轉強')).toEqual({ label: '先漲營收升', sub: '指標：公布前先漲・營收轉強' });
    // 名字相同時不重複副標
    expect(displayName('combo_three', '三方同買')).toEqual({ label: '三方同買', sub: null });
  });
  it('沒有策略的指標維持指標名', () => {
    expect(displayName('macd', 'MACD 柱狀轉正')).toEqual({ label: 'MACD 柱狀轉正', sub: null });
  });
  it('波段策略也在名稱表（test＝自己的 id）', () => {
    expect(strategyByTest('rev_confirm')?.label).toBe('營收高帶量');
    expect(STRATEGY_NAMES.some((n) => n.kind === 'swing')).toBe(true);
  });
  it('主標不重複、都符合命名規則（≤ 5 字、不用術語、副標列條件；含波段策略）', () => {
    const JARGON = ['共振', '集中', '突破', '低估', '強勢', '主力', '起漲', '飆', '黃金', '爆發'];
    const labels = STRATEGY_NAMES.map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const n of STRATEGY_NAMES) {
      expect([...n.label].length, n.id).toBeLessThanOrEqual(5);
      for (const w of JARGON) expect(n.label, n.id).not.toContain(w);
      expect(n.subtitle.split('・').length).toBeGreaterThanOrEqual(2);
      expect(n.aliases).not.toContain(n.label);
    }
  });
  it('舊名稱自動對應；不是舊名稱時原樣回傳', () => {
    expect(canonicalStrategyName('我的條件')).toBe('我的條件');
    const withAlias = STRATEGY_NAMES.find((n) => n.aliases.length);
    if (withAlias) expect(canonicalStrategyName(withAlias.aliases[0])).toBe(withAlias.label);
  });
});
