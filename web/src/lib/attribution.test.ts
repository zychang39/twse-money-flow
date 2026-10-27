import { describe, expect, it } from 'vitest';
import type { AttrFactors, AttrStock } from '../data/types';
import { annualAlpha, compound, decompose, exposureText, factorCorr, factorTrend, periodRange, rulerFit, rulers, yearsToTell } from './attribution';

const n = 14;
const fill = (v: number | null) => Array.from({ length: n }, () => v);
const f: AttrFactors = {
  months: Array.from({ length: n }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`),
  end_dates: [], partial: true, rf_annual: 0.012, rf: fill(0.001), mkt: fill(0.02),
  f: { smb: fill(0.01), hml: fill(-0.01), umd: fill(0.02), rmw: fill(null), lv: fill(0) },
  start: { smb: null, hml: null, umd: null, rmw: null, lv: null }, labels: {},
  style_labels: ['小型・成長', '小型・中性', '小型・價值', '中型・成長', '中型・中性', '中型・價值', '大型・成長', '大型・中性', '大型・價值'],
  style_ret: Array.from({ length: 9 }, () => fill(0.015)), universe: [], window_months: 60, min_months: 24, peer_min: 5, peer_max: 10,
  peer_min_corr: 0.2, peer_weeks: 104, liquidity_pctile: 20,
};
const s: AttrStock = {
  code: '9999', r: fill(0.05), peer: fill(0.03), ind: fill(0.005), style: fill(8),
  peers: { kind: 'peer', codes: ['1', '2', '3', '4', '5'], corr: [0.5, 0.4, 0.3, 0.3, 0.2], cross: [false, false, false, false, true] },
  fit: { market: { r2: 0.3, n: 40 }, peer: { r2: 0.6, n: 40 }, official: { r2: 0.4, n: 40 }, fine: null },
  window: ['2022-01', '2025-12'],
  capm: { alpha: 0.02, alpha_t: 2.5, b: { mkt: 1.5 }, t: { mkt: 8 }, r2: 0.5, resid_sd: 0.06, n: 40 },
  full: { alpha: 0.01, alpha_t: 1.2, b: { ind: 1, smb: 0.5, hml: 0.2, umd: 0.1, lv: 0 }, t: { ind: 3, smb: 2.5, hml: 0.4, umd: 1, lv: 0 }, r2: 0.7, resid_sd: 0.05, n: 40 },
  dropped: ['rmw'],
};

describe('報酬拆解', () => {
  it('期間與複利', () => {
    expect(periodRange(f, 12)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(periodRange(f, 60)).toHaveLength(13); // 第一個月沒有報酬
    expect(compound([0.1, 0.1], [0, 1])).toBeCloseTo(0.21);
    expect(compound([0.1, null], [0, 1])).toBeNull();
  });

  it('三把尺：大盤、同業、同風格（期初分組）', () => {
    const r = rulers(f, s, periodRange(f, 3));
    expect(r.stock).toBeCloseTo(1.05 ** 3 - 1);
    expect(r.market).toBeCloseTo(1.02 ** 3 - 1);
    expect(r.peer).toBeCloseTo(1.03 ** 3 - 1);
    expect(r.styleLabel).toBe('大型・價值');
  });

  it('拆成三層：各層加起來等於各月報酬加總；模型越完整 Alpha 越少', () => {
    const d = decompose(f, s, periodRange(f, 12))!;
    expect(d.total).toBeCloseTo(0.6);
    expect(d.rf).toBeCloseTo(0.012);
    expect(d.market).toBeCloseTo(1.5 * (0.24 - 0.012));
    expect(d.ind).toBeCloseTo(0.06);
    expect(d.factors.smb).toBeCloseTo(0.06);
    expect(d.factors.hml).toBeCloseTo(-0.024);
    expect(d.factors.umd).toBeCloseTo(0.024);
    expect(d.factors.rmw).toBeUndefined(); // 沒有放進模型
    const parts = d.rf + d.market + (d.ind ?? 0) + Object.values(d.factors).reduce((a, b) => a + (b ?? 0), 0) + d.alpha;
    expect(parts).toBeCloseTo(d.total);
    expect(d.alphaCapm).toBeCloseTo(0.6 - 0.012 - 0.342);
    expect(d.alpha).toBeLessThan(d.alphaCapm);
    expect(decompose(f, { ...s, capm: null }, periodRange(f, 12))).toBeNull();
  });

  it('年化 Alpha、分辨所需年數、曝險白話', () => {
    expect(annualAlpha(s.full)).toBeCloseTo(0.12);
    expect(yearsToTell(s.full)).toBeCloseTo(((2 * 0.05) / 0.01) ** 2 / 12);
    expect(yearsToTell({ ...s.full!, alpha: 0 })).toBe(Infinity);
    expect(exposureText('mkt', 1.5, 8)).toBe('比大盤敏感');
    expect(exposureText('smb', 0.5, 2.5)).toBe('偏小型股');
    expect(exposureText('hml', 0.2, 0.4)).toBe('不明顯');
  });

  it('因子順逆風、相關、尺的貼合度排序', () => {
    const t = factorTrend(f, 'umd');
    expect(t.r12).toBeCloseTo(1.02 ** 12 - 1);
    expect(t.tailwind).toBe(true);
    expect(factorTrend(f, 'rmw').tailwind).toBeNull();
    expect(factorCorr(f, 'smb', 'umd')).toBeNull(); // 常數序列沒有變異
    expect(rulerFit(s).map((x) => x.key)).toEqual(['peer', 'official', 'market']);
  });
});
