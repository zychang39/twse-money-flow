import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, sortItems, sortLabel, verdictTier } from './sorting';

const rows = [
  { label: '甲', verdict: '無效', t: 3.5, excess: 2.0, health: 0.1, today: 0 },
  { label: '乙', verdict: '有效', t: 2.6, excess: 0.7, health: 1.2, today: 3 },
  { label: '丙', verdict: '環境依賴', t: 2.2, excess: 0.5, health: null, today: 1 },
  { label: '丁', verdict: '有效', t: 3.7, excess: 0.6, health: -0.2, today: 5 },
  { label: '戊', verdict: '樣本範圍受限', t: 3.1, excess: 3.6, health: 0.3, today: 0 },
  { label: '己', verdict: '不穩定', t: 3.5, excess: 0.8, health: 0.4, today: 2 },
];

describe('列表排序（v3 M5-2）', () => {
  it('預設：判定分級，同級依 t 由高到低；不依超額', () => {
    expect(sortItems(rows, DEFAULT_SORT).map((r) => r.label)).toEqual(['丁', '乙', '丙', '己', '戊', '甲']);
    expect(verdictTier('樣本不足')).toBe(verdictTier('樣本範圍受限'));
  });
  it('方向可切換', () => {
    expect(sortItems(rows, { key: 'verdict', dir: 'asc' }).map((r) => r.label)).toEqual(['甲', '戊', '己', '丙', '乙', '丁']);
  });
  it('t、超額、健康度、今日觸發；空值排最後', () => {
    expect(sortItems(rows, { key: 't', dir: 'desc' }).map((r) => r.label)).toEqual(['丁', '己', '甲', '戊', '乙', '丙']);
    expect(sortItems(rows, { key: 'excess', dir: 'desc' })[0].label).toBe('戊');
    expect(sortItems(rows, { key: 'health', dir: 'desc' }).at(-1)!.label).toBe('丙');
    expect(sortItems(rows, { key: 'health', dir: 'asc' }).at(-1)!.label).toBe('丙');
    expect(sortItems(rows, { key: 'today', dir: 'desc' }).map((r) => r.today)).toEqual([5, 3, 2, 1, 0, 0]);
  });
  it('標頭文字', () => {
    expect(sortLabel(DEFAULT_SORT)).toBe('判定分級・由高到低');
    expect(sortLabel({ key: 't', dir: 'asc' })).toBe('證據強度（t）・由低到高');
  });
});
