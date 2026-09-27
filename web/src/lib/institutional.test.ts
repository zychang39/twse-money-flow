import { describe, expect, it } from 'vitest';
import type { ChipBlock } from './chips';
import { buySellSince, headline, partyFlow, partyTotal, reportCsv, reportRows, signedLots, streakOf } from './institutional';
import { niceScale, niceStep } from './scale';

// 4 個交易日（第一筆是種子列）；股數
function block(): ChipBlock {
  const n = 4;
  const z = () => Array(n).fill(0);
  return {
    d: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'],
    c: [100, 101, 99, 102], chg: [null, 1, -1.98, 3.03], v: [1e6, 2e6, 1e6, 2e6], avg: [100, 101, 99, 102], af: [1, 1, 1, 1],
    mb: z(), sb: z(),
    fn: [0, 300_000, -100_000, 200_000], ffd: [0, 0, 5_000, 0],
    tn: [0, 10_000, 20_000, 30_000],
    dn: [0, 1_000, -2_000, 3_000], dself: [0, 500, -1_000, 1_000], dhedge: [0, 500, -1_000, 2_000],
    tot: [0, 311_000, -77_000, 233_000],
    sbls: z(), dt: z(),
    fb: [0, 500_000, 100_000, 400_000], fs: [0, 200_000, 195_000, 200_000],
    tb: [0, 10_000, 20_000, 30_000], ts: [0, 0, 0, 0],
    // 自營商買賣股數只有最後兩天（舊檔只存買賣超）
    dsb: [null, null, 0, 1_000], dss: [null, null, 1_000, 0], dhb: [null, null, 0, 2_000], dhs: [null, null, 1_000, 0],
  };
}

describe('法人買賣超報表', () => {
  it('外資＝外陸資＋外資自營商；買進 − 賣出 ＝ 買賣超', () => {
    const f = partyFlow(block(), 'foreign', 2);
    expect(f).toEqual({ buy: 100_000, sell: 195_000, net: -95_000 });
  });

  it('三大法人：買賣超用官方合計；任一法人缺買賣股數 → 買張為空值', () => {
    expect(partyFlow(block(), 'total', 1)).toEqual({ buy: null, sell: null, net: 311_000 });
    expect(partyFlow(block(), 'total', 3)).toEqual({ buy: 433_000, sell: 200_000, net: 233_000 });
  });

  it('逐日列：張、累計從期間第一天起算、不含種子列', () => {
    const rows = reportRows(block(), 'foreign', 60);
    expect(rows.map((r) => r.date)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
    expect(rows.map((r) => r.net)).toEqual([300, -95, 200]);
    expect(rows.map((r) => r.cum)).toEqual([300, 205, 405]);
    expect(reportRows(block(), 'foreign', 2).map((r) => r.cum)).toEqual([-95, 105]);
  });

  it('區間合計：買張只加總有資料的日子；佔量＝買賣超 ÷ 成交量', () => {
    const t = partyTotal(reportRows(block(), 'dealer', 60), 'dealer');
    expect(t.net).toBe(2);
    expect(t.buy).toBe(3);
    expect(t.sell).toBe(2);
    expect(t.bsDays).toBe(2);
    expect(t.days).toBe(3);
    expect(t.pctVolume).toBeCloseTo((2 / 5000) * 100, 6);
    expect(buySellSince(reportRows(block(), 'dealer', 60))).toBe('2026-09-23');
  });

  it('連買／連賣天數與結論句（中性字眼）', () => {
    expect(streakOf([1, -1, 2, 3])).toBe(2);
    expect(streakOf([1, -1, -2, -3])).toBe(-3);
    expect(streakOf([1, 0])).toBe(0);
    const s = headline(reportRows(block(), 'trust', 60), 'trust');
    expect(s).toBe('投信近 3 日累計買超 60 張（佔成交量 1.2%），已連買 3 日');
    expect(s).not.toMatch(/買進|賣出|建議/);
  });

  it('張數文字：≥ 10 萬張縮寫為「萬」，四捨五入為 0 時不加符號', () => {
    expect(signedLots(123_456).text).toBe('▲12.3 萬');
    expect(signedLots(-1234).text).toBe('▼1,234');
    expect(signedLots(0.2)).toEqual({ text: '0', dir: 'flat' });
    expect(signedLots(null).dir).toBe('none');
  });

  it('CSV：四個法人的買張、賣張、買賣超，第一列為區間合計，逐日新到舊', () => {
    const csv = reportCsv(block(), 60, { code: '2330', name: '台積電' }).trim().split('\n');
    expect(csv[1].split(',')).toHaveLength(3 + 12);
    expect(csv[2].startsWith('區間合計(3日),,5000,')).toBe(true);
    expect(csv[3].startsWith('2026-09-24,102.00,2000,400,200,200,')).toBe(true);
    expect(csv).toHaveLength(6);
  });
});

describe('座標軸取整', () => {
  it('間距取 1、2、2.5、5 × 10ⁿ', () => {
    expect(niceStep(46)).toBe(50);
    expect(niceStep(0.3)).toBeCloseTo(0.5);
    expect(niceStep(2400)).toBe(2500);
  });
  it('柱狀圖對稱、線圖取整並可包含 0', () => {
    expect(niceScale([-3872, 1200], 'bars')).toEqual({ lo: -5000, hi: 5000, ticks: [5000, 0, -5000] });
    expect(niceScale([499.5, 591.6], 'lines')).toEqual({ lo: 450, hi: 600, ticks: [600, 550, 500, 450] });
    expect(niceScale([120, 4697], 'lines', { zero: true }).ticks).toEqual([5000, 2500, 0]);
  });
});
