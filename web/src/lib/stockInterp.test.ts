import { describe, expect, it } from 'vitest';
import { atrInterp, biasAtrInterp, gapWord, high52Interp, instInterp, marginInterp, rsInterp, slopeWord, trendSummary, volRatioInterp } from './stockInterp';
import type { StockSectorItem, StockTrend } from '../data/types';

const fine = (rank: number, of: number) => ({ id: 'f-x', name: '晶圓製造', rank, of } as StockSectorItem);
const len = (s: string | null) => [...(s ?? '')].length;

describe('解讀行（B2 ≤ 28 字）與提醒（B4）', () => {
  it('RS：PR ≥ 80 且細產業在後三分之一 → 提醒', () => {
    expect(rsInterp(84, 85, fine(10, 30))).toEqual({ text: '高於 84% 的股票，20 日前 85', alert: false });
    const r = rsInterp(84, 85, fine(25, 30));
    expect(r.alert).toBe(true);
    expect(r.text).toContain('晶圓製造');
    expect(rsInterp(70, null, fine(25, 30)).alert).toBe(false);
  });
  it('52 週高：在高點不寫 0.00%', () => {
    expect(high52Interp({ at_high: true } as StockTrend['y52'], 0).text).toBe('今天收在 52 週高點');
    expect(high52Interp({ at_high: false, hi: 2510, hi_date: '2026-10-01' } as StockTrend['y52'], -0.4).text).toBe('高點 2,510(10/1)，差 0.4%');
  });
  it('乖離 > 3 ATR、量比 > 3、融資 5 日 > 10%、ATR% 前 10% → 提醒', () => {
    expect(biasAtrInterp(1.57)).toEqual({ text: '收盤在 20 日線上方 1.6 倍 ATR', alert: false });
    expect(biasAtrInterp(3.2).alert).toBe(true);
    expect(volRatioInterp(3.4).alert).toBe(true);
    expect(volRatioInterp(0.71).text).toBe('成交量是 20 日均量的 0.71 倍');
    expect(marginInterp(12, 3000).alert).toBe(true);
    expect(marginInterp(7.3, 281).text).toBe('融資 5 日增加 281 張');
    expect(atrInterp(1.4, 0.95).alert).toBe(true);
    expect(atrInterp(1.4, 0.2).text).toBe('波動在自身近 1 年的第 20 百分位');
  });
  it('法人：賣超用「淨賣」', () => {
    expect(instInterp(-10525, -4.1).text).toBe('法人 20 日淨賣 10,525 張，佔量 4.1%');
  });
  it('B5 固定用語：加快／放慢、擴大／收斂', () => {
    expect(slopeWord(1.66, 0.67)).toBe('加快');
    expect(slopeWord(0.3, 1.2)).toBe('放慢');
    expect(slopeWord(-2, -1)).toBe('加快');
    expect(gapWord(1.93, 0.7)).toBe('擴大');
    expect(gapWord(0.5, 1.4)).toBe('收斂');
  });
  it('趨勢摘要', () => {
    const t = { align: { state: 'bull', days: 10 }, ma: { 20: { slope: 1.66, slope_prev: 0.67 } } } as unknown as StockTrend;
    expect(trendSummary(t)).toEqual({ concl: '多頭排列 10 天', interp: '20 日線 10 日斜率 +1.66%，加快' });
  });
  it('每一行 ≤ 28 字', () => {
    for (const s of [rsInterp(84, 85, fine(25, 30)).text, biasAtrInterp(-3.4).text, instInterp(-123456, -12.3).text, marginInterp(12.5, 123456).text, atrInterp(3.21, 0.95).text,
      high52Interp({ at_high: false, hi: 12345.5, hi_date: '2026-12-31' } as StockTrend['y52'], -35.2).text]) {
      expect(len(s)).toBeLessThanOrEqual(28);
    }
  });
});
