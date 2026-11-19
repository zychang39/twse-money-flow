import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AttrTags, Tailwind, WindSector, WindStyle } from '../data/types';
import {
  EMPTY_CIRCLE, allocSplit, barScale, biggestUnderweight, byState, cellKey, changed, circleOf, dominated, excessCorr, listCandidates, matrixCell,
  matrixCounts, normCircle, overweights, poolCheck, sameWindLabel, sameWindPairs, sectorCandidates, sinceInfo, stockStyles, stockWind, styleCandidates,
  styleNow, tagRows, toggleCircle, windLabel, windState,
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

// 2026-11-19（DECISIONS #475）：用詞統一、兩條線的橫條、找股票
describe('順風選股：用詞、刻度、找股票', () => {
  const tags: AttrTags = {
    date: '2026-11-13', columns: ['code', 'style', 'sector', 'styles', 'held', 'cap', 'r12'],
    rows: [
      ['A', 'quality', '資訊科技', ['quality'], { quality: 9.5 }, 900, 0.5], // 兩邊都順風、ETF 超配資訊科技 → 同一陣風
      ['B', 'quality', '金融', ['quality', 'value'], { quality: 4.2 }, 300, 0.2], // 風格順風、類股中性
      ['C', 'quality', '能源', ['quality'], null, 500, -0.1], // 不在 ETF 裡；類股逆風
      ['D', 'lowvol', '資訊科技', ['lowvol'], null, 100, 0.1], // 風格逆風 × 類股順風
      ['E', null, '工業', [], null, 50, 0.3], // 風格不突出
      ['F', 'value', null, ['value'], null, 20, 0.05], // 沒有類股指數
    ],
  };
  const rows = tagRows(tags);

  it('狀態只有一種寫法：順風／中性／逆風，未滿 12 個月的在後面加（暫定）', () => {
    expect(windLabel('tail')).toBe('順風');
    expect(windLabel('tail', true)).toBe('順風（暫定）');
    expect(windLabel('head')).toBe('逆風');
    expect(windLabel(null)).toBe('資料不足');
    expect([sameWindLabel(true), sameWindLabel(false)]).toEqual(['同一陣風', '不同陣風']);
    // 矩陣每一格的說明只用這三個詞
    for (const a of ['tail', 'neutral', 'head', null] as const) {
      for (const b of ['tail', 'neutral', 'head', null] as const) {
        const c = matrixCell(a, b);
        if (!c) continue;
        expect(`${c.short}${c.text}`).not.toMatch(/逆著風|兩陣風|風幫忙|暫定順風/);
      }
    }
    expect(matrixCell('tail', 'tail')?.short).toBe('兩邊都順風');
    expect(matrixCell('neutral', 'head')?.short).toBe('類股逆風');
  });

  it('畫面的原始碼不再出現舊的變體用詞', () => {
    for (const f of ['../pages/AttributionWind.tsx', '../pages/AttributionPick.tsx', '../pages/Attribution.tsx', '../components/stock/AttrCard.tsx', './tailwind.ts']) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/.*$/gm, '$1');
      expect(text, f).not.toMatch(/逆著風|比較像兩陣風|暫定順風|趨勢為正|趨勢為負/);
    }
  });

  it('橫條的刻度：包含 0 與大盤；極端值截在大盤的 2.2 倍', () => {
    const sc = barScale([0.57, 0.33, 0.31, 1.7, -0.01], 0.47);
    expect(sc.lo).toBeCloseTo(-0.01);
    expect(sc.hi).toBeCloseTo(0.47 * 2.2);
    expect(sc.over(1.7)).toBe(true);
    expect(sc.over(0.57)).toBe(false);
    expect(sc.x(1.7)).toBe(1); // 夾在最右邊
    expect(sc.x(0)).toBeGreaterThan(0); // 有負值時 0 不在最左邊
    expect(sc.x(0.47)).toBeGreaterThan(sc.x(0.33)); // 大盤那條線在中性的右邊
    const flat = barScale([null, null], null); // 沒有資料也不會除以 0
    expect(Number.isFinite(flat.x(0))).toBe(true);
  });

  it('tags.json：新版 7 欄；舊版只有前三欄時補空值', () => {
    expect(rows[0]).toEqual({ code: 'A', main: 'quality', sector: '資訊科技', styles: ['quality'], held: { quality: 9.5 }, cap: 900, r12: 0.5 });
    const old = tagRows({ date: '', columns: ['code', 'style', 'sector'], rows: [['A', 'quality', '資訊科技'], ['E', null, '工業']] });
    expect(old[0]).toEqual({ code: 'A', main: 'quality', sector: '資訊科技', styles: ['quality'], held: {}, cap: null, r12: null });
    expect(old[1].styles).toEqual([]);
    expect(tagRows(null)).toEqual([]);
  });

  it('從風格找：預設只列 ETF 的持股（依權重）；wide 加上特徵也屬於這一類的（依市值）', () => {
    const held = styleCandidates(tw, rows, 'quality');
    expect(held.map((c) => c.code)).toEqual(['A', 'B']);
    expect(held[0]).toMatchObject({ via: 'quality', weight: 9.5 });
    expect(held[0].wind.sameWind).toMatchObject({ same: true }); // 00938 超配資訊科技 8 個百分點
    expect(held[0].wind.cell?.tone).toBe('prior');
    expect(held[1].wind.cell?.short).toBe('風格順風');
    const wide = styleCandidates(tw, rows, 'quality', true);
    expect(wide.map((c) => c.code)).toEqual(['A', 'B', 'C']);
    expect(wide[2].weight).toBeNull();
    // B 也屬於價值：從價值找時用價值的狀態（不是它的主要風格）
    expect(styleCandidates(tw, rows, 'value', true).map((c) => [c.code, c.via, c.wind.styleState])).toEqual([['B', 'value', 'neutral'], ['F', 'value', 'neutral']]);
  });

  it('從類股找：同產業依市值；風格看各自的主要風格', () => {
    const cs = sectorCandidates(tw, rows, '資訊科技');
    expect(cs.map((c) => [c.code, c.wind.styleState, c.wind.sectorState])).toEqual([['A', 'tail', 'tail'], ['D', 'head', 'tail']]);
    expect(cs[1].wind.cell?.tone).toBe('mixed');
    expect(sectorCandidates(tw, rows, '沒有這個類股')).toEqual([]);
  });

  it('我的名單：矩陣各格的檔數、名單檢查', () => {
    const cs = listCandidates(tw, rows, ['A', 'D', 'B', 'E', 'ZZZ']);
    expect(cs.map((c) => c.code)).toEqual(['A', 'D', 'B', 'E']); // 沒有資料的代號不列
    expect(matrixCounts(cs)).toEqual({ cells: { 'tail-tail': 1, 'head-tail': 1, 'tail-neutral': 1 }, one: 1 });
    expect(cellKey(cs[0])).toBe('tail-tail');
    expect(cellKey(cs[3])).toBeNull();
    const chk = poolCheck(cs);
    expect(chk).toMatchObject({ n: 4, sizeOk: false, top: ['資訊科技', 2], crowded: false, both: 1, same: 1, head: 1 });
    // 超過一半在同一個類股（至少 4 檔）→ 集中
    const crowd = poolCheck(listCandidates(tw, [...rows, { ...rows[0], code: 'A2' }, { ...rows[0], code: 'A3' }], ['A', 'A2', 'A3', 'D', 'B']));
    expect(crowd).toMatchObject({ n: 5, sizeOk: true, crowded: true, top: ['資訊科技', 4] });
    expect(poolCheck([])).toMatchObject({ n: 0, sizeOk: false, top: null, crowded: false });
  });

  it('能力圈：一個類股只會在熟悉或不碰其中一邊；再點一次取消', () => {
    let c = toggleCircle(EMPTY_CIRCLE, 'know', '金融');
    expect(c).toEqual({ know: ['金融'], skip: [] });
    c = toggleCircle(c, 'skip', '金融');
    expect(c).toEqual({ know: [], skip: ['金融'] });
    expect(circleOf(c, '金融')).toBe('skip');
    c = toggleCircle(c, 'skip', '金融');
    expect(c).toEqual(EMPTY_CIRCLE);
    expect(circleOf(c, null)).toBeNull();
    expect(normCircle({ know: ['a', 1 as unknown as string] })).toEqual({ know: ['a'], skip: [] });
    expect(normCircle(null)).toEqual(EMPTY_CIRCLE);
  });

  it('未滿 12 個月：已有幾個月、哪一天滿（舊版資料由起點推算）', () => {
    expect(sinceInfo(tw.styles[2], '2026-11-19')).toEqual({ months: 11.6, full: '2026-12-01' });
    expect(sinceInfo({ since: { start: '2025-12-01', r: 0, rm: 0, state: 'tail', months: 11.9, full: '2026-12-02' } }, '2026-11-19')).toEqual({ months: 11.9, full: '2026-12-02' });
    expect(sinceInfo(tw.styles[0], '2026-11-19')).toBeNull();
  });
});
