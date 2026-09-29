import { describe, expect, it } from 'vitest';
import { screenerConfig } from './config';
import { backtestCustom, canonicalName, presetScreens, savedDisplayName, screenIdentity } from './screener';

// 內建策略命名規則（CLAUDE.md）：主標最多 5 個字、讓人一看就知道條件；不用比喻或術語；副標列出條件。
const JARGON = ['共振', '集中', '突破', '低估', '強勢', '主力', '起漲', '飆', '黃金', '爆發'];

describe('內建策略命名規則', () => {
  for (const p of screenerConfig.presets) {
    it(`${p.id}：「${p.label}」`, () => {
      expect([...p.label].length).toBeLessThanOrEqual(5);
      for (const w of JARGON) expect(p.label).not.toContain(w);
      expect(p.subtitle.split('・').length).toBeGreaterThanOrEqual(2); // 副標列出條件
      expect(p.aliases ?? []).not.toContain(p.label);
    });
  }
  it('「籌碼集中」改名為「三方同買」，副標是三個條件', () => {
    const p = screenerConfig.presets.find((x) => x.id === 'chip_concentration')!;
    expect(p.label).toBe('三方同買');
    expect(p.subtitle).toBe('投信連買・外資買超・大戶增加');
  });
});

describe('舊名稱自動對應到新名稱', () => {
  const presets = presetScreens();
  it('canonicalName：籌碼集中／籌碼共振 → 三方同買；其他名稱不變', () => {
    expect(canonicalName('籌碼集中', presets)).toBe('三方同買');
    expect(canonicalName('籌碼共振', presets)).toBe('三方同買');
    expect(canonicalName('強勢突破', presets)).toBe('近高點放量');
    expect(canonicalName('我的條件', presets)).toBe('我的條件');
  });
  it('網址參數 name=籌碼集中：條件相同 → 直接用三方同買；條件不同 →「三方同買（已修改）」', () => {
    const chip = screenerConfig.presets.find((x) => x.id === 'chip_concentration')!.conditions;
    expect(backtestCustom(chip, '籌碼集中', presets)).toEqual({ name: '三方同買', presetId: 'chip_concentration' });
    expect(backtestCustom(chip.slice(0, 2), '籌碼集中', presets)).toEqual({ name: '三方同買（已修改）', presetId: null });
  });
  it('以舊名稱儲存的「我的組合」顯示新名稱；條件和內建不同時加「（已修改）」', () => {
    const chip = screenerConfig.presets.find((x) => x.id === 'chip_concentration')!.conditions;
    const saved = [{ id: 's', label: '籌碼集中', conditions: [{ field: 'composite', op: '>=' as const, value: 60 }] }];
    expect(screenIdentity(saved[0].conditions, 's', presets, saved).name).toBe('三方同買（已修改）');
    expect(savedDisplayName('籌碼集中', chip, presets)).toBe('三方同買');
    expect(savedDisplayName('我的', chip, presets)).toBe('我的');
  });
});
