import { describe, expect, it } from 'vitest';
import type { AttrFactors, AttrStock, Tailwind, WindStyle } from '../data/types';
import { annualAlpha, compound, decompose, exposureText, factorCorr, factorTrend, periodRange, rulerFit, rulers, yearsToTell } from './attribution';

const n = 14;
const fill = (v: number | null) => Array.from({ length: n }, () => v);
const f: AttrFactors = {
  months: Array.from({ length: n }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`),
  end_dates: [], partial: true, rf_annual: 0.012, rf: fill(0.001), mkt: fill(0.02),
  f: { smb: fill(0.01), hml: fill(-0.01), umd: fill(0.02), rmw: fill(null), lv: fill(0) },
  start: { smb: null, hml: null, umd: null, rmw: null, lv: null }, labels: {},
  universe: [], window_months: 60, min_months: 24, exposure_weeks: 104, exposure_min_weeks: 78, peer_min: 5, peer_max: 10,
  peer_min_corr: 0.2, peer_weeks: 104, liquidity_pctile: 20,
};
const style = (key: WindStyle['key'], etf: string, x: number | null, m = 0.03): WindStyle => ({
  key, label: key, etf, name: null, index: null, mix: null, char: null, note: null, source: 'etf', listed: null, start: null,
  r: { 12: 0.3, 6: 0.1, 3: 0.05 }, state: 'tail', prev: 'tail', m: fill(m), x: x === null ? null : fill(x), beta: 0.8,
});
const tw: Tailwind = {
  date: '2026-02-27', prev_date: '2026-01-30', months: [12, 6, 3], near_pp: 1, style_pct: 70, top_weight_warn: 30, same_wind_corr: 0.6,
  market: { name: '加權報酬指數', r: { 12: 0.2, 6: 0.1, 3: 0.02 }, etf: null },
  styles: [style('value', '00940', -0.01), style('quality', '00938', 0.01, 0.04), style('momentum', '009816', null), style('size', '0051', 0.02), style('lowvol', '00713', 0)],
  sectors: [{ key: '半導體', index: '半導體類報酬指數', r: { 12: 0.34 }, state: 'tail', prev: 'tail', m: fill(0.025), x: fill(0.004), beta: 1.1, w: 56, n: 96 }],
};
const s: AttrStock = {
  code: '9999', r: fill(0.05), peer: fill(0.03), ind: fill(0.005), sector: '半導體',
  peers: { kind: 'peer', codes: ['1', '2', '3', '4', '5'], corr: [0.5, 0.4, 0.3, 0.3, 0.2], cross: [false, false, false, false, true] },
  fit: { market: { r2: 0.3, n: 40 }, peer: { r2: 0.6, n: 40 }, sector: { r2: 0.5, n: 40 }, official: { r2: 0.4, n: 40 }, fine: null },
  window: ['2022-01', '2025-12'],
  capm: { alpha: 0.02, alpha_t: 2.5, b: { mkt: 1.5 }, t: { mkt: 8 }, r2: 0.5, resid_sd: 0.06, n: 40 },
  full: { alpha: 0.01, alpha_t: 1.2, b: { ind: 1, value: 0.2, quality: 0.5, size: 0.1, lowvol: 0 }, t: { ind: 3, value: 0.4, quality: 2.5, size: 1, lowvol: 0 }, r2: 0.7, resid_sd: 0.05, n: 30, weeks: 104 },
  dropped: ['momentum'], styles: { value: 20, quality: 88, momentum: 75, size: 5, lowvol: 40 }, held: { quality: 3.2 }, main: 'quality',
};

describe('報酬拆解', () => {
  it('期間與複利', () => {
    expect(periodRange(f, 12)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(periodRange(f, 60)).toHaveLength(13); // 第一個月沒有報酬
    expect(compound([0.1, 0.1], [0, 1])).toBeCloseTo(0.21);
    expect(compound([0.1, null], [0, 1])).toBeNull();
  });

  it('尺：大盤、類股報酬指數、同業籃子、主要風格的 ETF', () => {
    const r = rulers(f, s, tw, periodRange(f, 3));
    expect(r.stock).toBeCloseTo(1.05 ** 3 - 1);
    expect(r.market).toBeCloseTo(1.02 ** 3 - 1);
    expect(r.sector).toBeCloseTo(1.025 ** 3 - 1);
    expect(r.sectorLabel).toBe('半導體');
    expect(r.peer).toBeCloseTo(1.03 ** 3 - 1);
    expect(r.style).toBeCloseTo(1.04 ** 3 - 1); // 主要風格＝品質（00938）
    expect([r.styleKey, r.styleEtf]).toEqual(['quality', '00938']);
    // 沒有順風檢查的資料、或沒有主要風格：那兩把尺不出現
    const none = rulers(f, { ...s, main: null, sector: null }, tw, periodRange(f, 3));
    expect([none.sector, none.style, none.styleKey]).toEqual([null, null, null]);
    expect(rulers(f, s, null, periodRange(f, 3)).sector).toBeNull();
  });

  it('拆成三層：第二層＝同業籃子＋風格 ETF；各層加起來等於各月報酬加總', () => {
    const d = decompose(f, s, tw, periodRange(f, 12))!;
    expect(d.total).toBeCloseTo(0.6);
    expect(d.rf).toBeCloseTo(0.012);
    expect(d.market).toBeCloseTo(1.5 * (0.24 - 0.012));
    expect(d.ind).toBeCloseTo(0.06);
    expect(d.factors.value).toBeCloseTo(0.2 * -0.12);
    expect(d.factors.quality).toBeCloseTo(0.5 * 0.12);
    expect(d.factors.size).toBeCloseTo(0.1 * 0.24);
    expect(d.factors.momentum).toBeUndefined(); // 掛牌太短，沒有放進模型
    const parts = d.rf + d.market + (d.ind ?? 0) + Object.values(d.factors).reduce((a, b) => a + (b ?? 0), 0) + d.alpha;
    expect(parts).toBeCloseTo(d.total);
    expect(d.alphaCapm).toBeCloseTo(0.6 - 0.012 - 0.342);
    expect(d.alpha).toBeLessThan(d.alphaCapm);
    expect(decompose(f, { ...s, capm: null }, tw, periodRange(f, 12))).toBeNull();
    // 沒有順風檢查的資料（舊版）：風格那幾項算不出來，併入 Alpha 並列出
    const old = decompose(f, s, null, periodRange(f, 12))!;
    expect(old.missing).toEqual(['value', 'quality', 'size', 'lowvol']);
    expect(old.alpha).toBeCloseTo(old.alphaCapm - 0.06);
  });

  it('年化 Alpha、分辨所需年數、曝險白話', () => {
    expect(annualAlpha(s.full)).toBeCloseTo(0.12);
    expect(yearsToTell(s.full)).toBeCloseTo(((2 * 0.05) / 0.01) ** 2 / 12);
    expect(yearsToTell({ ...s.full!, alpha: 0 })).toBe(Infinity);
    expect(exposureText('mkt', 1.5, 8)).toBe('比大盤敏感');
    expect(exposureText('quality', 0.5, 2.5)).toBe('跟品質型同進退');
    expect(exposureText('value', -0.6, -3)).toBe('跟價值型反向（偏成長）');
    expect(exposureText('value', 0.2, 0.4)).toBe('不明顯');
  });

  it('多空因子（對照）的趨勢、相關；尺的貼合度排序', () => {
    const t = factorTrend(f, 'umd');
    expect(t.r12).toBeCloseTo(1.02 ** 12 - 1);
    expect(t.tailwind).toBe(true);
    expect(factorTrend(f, 'rmw').tailwind).toBeNull();
    expect(factorCorr(f, 'smb', 'umd')).toBeNull(); // 常數序列沒有變異
    expect(rulerFit(s).map((x) => x.key)).toEqual(['peer', 'sector', 'official', 'market']);
  });
});
