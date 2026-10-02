import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, STRATEGY_DEFAULT_SORT, STRATEGY_SORT, STRATEGY_SORT_OPTIONS, defaultDir, sortItems, sortLabel, verdictTier } from './sorting';

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

/** 策略庫（2026-10-02 分級版）：有效性排名預設、校正後 t、40 日扣成本超額、勝率、每月觸發數、類別 */
const st = [
  { label: '甲', rank: 3, t_corr: 3.2, excess: 1.1, win: 55, per_month: 12, family: '籌碼' },
  { label: '乙', rank: 1, t_corr: 4.1, excess: 0.9, win: 58, per_month: 20, family: '動能' },
  { label: '丙', rank: null, t_corr: 1.2, excess: -0.4, win: 48, per_month: 3, family: '基本面' },
  { label: '丁', rank: 2, t_corr: 3.6, excess: 2.4, win: 52, per_month: 11, family: '動能' },
  { label: '戊', rank: null, t_corr: null, excess: null, win: null, per_month: null, family: '動能' },
];

describe('策略庫排序（分級版）', () => {
  it('六個選項、預設有效性排名由前到後', () => {
    expect(STRATEGY_SORT_OPTIONS.map((o) => o.label)).toEqual(['有效性排名（預設）', '校正後 t', '40 日扣成本超額', '勝率', '每月觸發數', '類別']);
    expect(STRATEGY_DEFAULT_SORT).toEqual({ key: 'rank', dir: 'asc' });
    expect(defaultDir('rank')).toBe('asc');
    expect(defaultDir('family')).toBe('asc');
    expect(defaultDir('t_corr')).toBe('desc');
  });
  it('排名 1 在前、沒有排名的在後（不論方向）', () => {
    expect(sortItems(st, STRATEGY_DEFAULT_SORT).map((r) => r.label)).toEqual(['乙', '丁', '甲', '丙', '戊']);
    expect(sortItems(st, { key: 'rank', dir: 'desc' }).map((r) => r.label)).toEqual(['甲', '丁', '乙', '丙', '戊']);
  });
  it('校正後 t、40 日扣成本超額、勝率、每月觸發數；空值排最後', () => {
    expect(sortItems(st, { key: 't_corr', dir: 'desc' }).map((r) => r.label)).toEqual(['乙', '丁', '甲', '丙', '戊']);
    expect(sortItems(st, { key: 'excess', dir: 'desc' }).map((r) => r.label)).toEqual(['丁', '甲', '乙', '丙', '戊']);
    expect(sortItems(st, { key: 'win', dir: 'asc' }).map((r) => r.label)).toEqual(['丙', '丁', '甲', '乙', '戊']);
    expect(sortItems(st, { key: 'per_month', dir: 'desc' }).map((r) => r.label)).toEqual(['乙', '甲', '丁', '丙', '戊']);
  });
  it('類別：筆畫順序，同類別內依排名、再依名稱', () => {
    expect(sortItems(st, { key: 'family', dir: 'asc' }).map((r) => r.label)).toEqual(['乙', '丁', '戊', '丙', '甲']);
    expect(sortItems(st, { key: 'family', dir: 'desc' }).map((r) => r.label)).toEqual(['甲', '丙', '乙', '丁', '戊']);
  });
  it('標頭文字與方向說法', () => {
    expect(sortLabel(STRATEGY_DEFAULT_SORT, STRATEGY_SORT)).toBe('有效性排名・排名前的在前');
    expect(sortLabel({ key: 'excess', dir: 'desc' }, STRATEGY_SORT)).toBe('40 日扣成本超額・由高到低');
    expect(sortLabel({ key: 'family', dir: 'asc' }, STRATEGY_SORT)).toBe('類別・筆畫少到多');
  });
});
