import { describe, expect, it } from 'vitest';
import type { Tailwind, WindSector, WindStyle } from '../data/types';
import {
  allocSplit, biggestUnderweight, byState, changed, dominated, excessCorr, matrixCell, overweights, sameWindPairs, stockStyles, stockWind,
  styleNow, windState,
} from './tailwind';

const m12 = (v: number[]) => v;
const sector = (key: string, r12: number, extra: Partial<WindSector> = {}): WindSector => ({
  key, index: `${key}類報酬指數`, r: { 12: r12 }, state: windState(r12, 0.2), prev: windState(r12, 0.2), m: [], x: null, beta: 1, w: 10, n: 20, ...extra,
});
const style = (key: WindStyle['key'], etf: string, r12: number | null, extra: Partial<WindStyle> = {}): WindStyle => ({
  key, label: { value: '價值', quality: '品質', momentum: '動能', size: '規模', lowvol: '低波動' }[key], etf, name: null, index: null, mix: null, char: null, note: null,
  source: 'etf', listed: null, start: null, r: { 12: r12 }, state: windState(r12, 0.2), prev: windState(r12, 0.2), m: [], x: null, beta: 0.8, ...extra,
});
const up = m12([0.05, 0.01, 0.04, -0.02, 0.06, 0.03, 0.05, -0.01, 0.04, 0.02, 0.06, 0.03]);
const mkt = m12([0.02, 0.01, 0.02, 0.00, 0.03, 0.01, 0.02, 0.00, 0.02, 0.01, 0.03, 0.01]);
const tw: Tailwind = {
  date: '2026-11-13', prev_date: '2026-10-30', months: [12, 6, 3], near_pp: 1, style_pct: 70, top_weight_warn: 30, same_wind_corr: 0.6,
  market: { name: '發行量加權股價報酬指數', r: { 12: 0.2 }, etf: null },
  styles: [
    style('value', '00940', 0.15),
    style('quality', '00938', 0.24, { weights: { date: '2026-11-13', alloc: 0.011, rows: [{ s: '資訊科技', w: 38, wm: 30, d: 8 }, { s: '金融', w: 16, wm: 13, d: 3 }, { s: '能源', w: 0, wm: 6, d: -6 }] } }),
    style('momentum', '009816', null, { since: { start: '2025-12-01', r: 0.3, rm: 0.25, state: 'tail' } }),
    style('size', '0051', 0.02, { prev: 'tail' }),
    style('lowvol', '00713', -0.03),
  ],
  sectors: [
    sector('資訊科技', 0.34, { m: up, top: { code: '2330', name: '台積電', w: 76 }, ex_top: { r12: 0.2, n: 30 }, w: 30 }),
    sector('工業', 0.23, { m: up.map((v) => v * 0.9 + 0.001) }),
    sector('金融', 0.15, { m: mkt.map((v, i) => v + (i % 2 ? 0.01 : -0.01)), w: 13 }),
    sector('能源', -0.11, { w: 6 }),
  ],
};

describe('順風檢查', () => {
  it('兩個數字、三種狀態（含兩個邊界情況）', () => {
    expect(windState(0.24, 0.2)).toBe('tail');
    expect(windState(0.15, 0.2)).toBe('neutral');
    expect(windState(-0.02, 0.2)).toBe('head');
    expect(windState(0.205, 0.2)).toBe('neutral'); // 幾乎一樣 → 中性
    expect(windState(-0.05, -0.1)).toBe('head'); // 大盤為負時規則不變
    expect(windState(null, 0.2)).toBeNull();
  });

  it('風格：未滿 12 個月用有資料以來的同一段期間（暫定）；分三堆、跟上個月比', () => {
    expect(styleNow(tw.styles[1], tw)).toEqual({ state: 'tail', provisional: false, r: 0.24, rm: 0.2 });
    expect(styleNow(tw.styles[2], tw)).toEqual({ state: 'tail', provisional: true, r: 0.3, rm: 0.25 });
    const piles = byState(tw.sectors);
    expect(piles.tail.map((s) => s.key)).toEqual(['資訊科技', '工業']);
    expect(piles.neutral.map((s) => s.key)).toEqual(['金融']);
    expect(piles.head.map((s) => s.key)).toEqual(['能源']);
    expect(changed(tw.styles).map((s) => s.key)).toEqual(['size']); // 順風 → 中性
  });

  it('一份順風不是兩份：風格 ETF 超配的類股在不在順風名單上；粗略的拆法', () => {
    const ow = overweights(tw.styles[1], tw);
    expect(ow.map((o) => [o.s, o.d, o.state])).toEqual([['資訊科技', 8, 'tail'], ['金融', 3, 'neutral']]);
    expect(biggestUnderweight(tw.styles[1], tw)).toMatchObject({ s: '能源', d: -6, state: 'head' });
    expect(overweights(tw.styles[0], tw)).toEqual([]); // 沒有持股資料
    const sp = allocSplit(tw.styles[1], tw)!;
    expect(sp.excess).toBeCloseTo(0.04); // 品質贏大盤 4 個百分點
    expect(sp.alloc).toBeCloseTo(0.011); // 其中類股配置約 1.1 個百分點
    expect(sp.rest).toBeCloseTo(0.029);
    expect(allocSplit(tw.styles[0], tw)).toBeNull();
  });

  it('順風的類股之間：相對大盤的月報酬高度同步的組合', () => {
    const idx = Array.from({ length: 12 }, (_, i) => i);
    expect(excessCorr(up, up.map((v) => v * 0.9 + 0.001), mkt, idx)).toBeGreaterThan(0.9);
    expect(excessCorr(up, up, mkt, [0, 1, 2])).toBeNull(); // 重疊太少
    const pairs = sameWindPairs(tw, mkt);
    expect(pairs.map((p) => `${p.a}×${p.b}`)).toEqual(['資訊科技×工業']); // 金融是中性，不在順風名單
  });

  it('3×3 矩陣與個股的兩個狀態', () => {
    expect(matrixCell('tail', 'tail')?.tone).toBe('prior');
    expect(matrixCell('neutral', 'tail')?.tone).toBe('ok'); // 風格中性 × 類股順風：可以研究，風格沒有風幫忙
    expect(matrixCell('tail', 'head')?.tone).toBe('mixed'); // 兩陣風方向相反
    expect(matrixCell('head', 'tail')?.tone).toBe('mixed');
    expect(matrixCell('neutral', 'head')?.tone).toBe('against');
    expect(matrixCell('head', 'head')?.tone).toBe('against');
    expect(matrixCell(null, 'tail')?.text).toContain('類股順風');
    expect(matrixCell(null, null)).toBeNull();
    // 品質順風 × 資訊科技順風，而且 00938 超配資訊科技 8 個百分點 → 同一陣風
    const a = stockWind(tw, { main: 'quality', sector: '資訊科技' });
    expect([a.styleState, a.sectorState, a.cell?.tone]).toEqual(['tail', 'tail', 'prior']);
    expect(a.sameWind).toEqual({ same: true, d: 8, etf: '00938' });
    // 動能（暫定順風）沒有持股資料 → 不判斷同一陣風
    const b = stockWind(tw, { main: 'momentum', sector: '工業' });
    expect([b.styleState, b.provisional, b.sameWind]).toEqual(['tail', true, null]);
    // 五種特徵都不突出、產業沒有類股指數
    const c = stockWind(tw, { main: null, sector: '文化創意' });
    expect([c.style, c.sector, c.cell]).toEqual([null, null, null]);
  });

  it('個股屬於哪幾種風格；類股指數被單一權值股主導', () => {
    const list = stockStyles(tw, { styles: { value: 20, quality: 88, momentum: null, size: 5, lowvol: 70 }, held: { size: 1.4 } });
    expect(list.filter((x) => x.belongs).map((x) => x.key)).toEqual(['quality', 'size', 'lowvol']);
    expect(dominated(tw.sectors[0], tw)).toBe(true);
    expect(dominated(tw.sectors[1], tw)).toBe(false);
  });
});
