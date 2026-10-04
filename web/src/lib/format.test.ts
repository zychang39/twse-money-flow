import { describe, expect, it } from 'vitest';
import { fmtCount, fmtLots, fmtLotsAbs, fmtLotsUnit, fmtYiUnit, glueNumbers, md, missing, orMissing, pctPlain, pctSigned, ratioPct, ratioText, tText } from './format';
import { formatUnit } from './format';

describe('圖表單位格式', () => {
  it('M3：張數一律完整的千分位整數（不縮寫、不帶小數）、帶正負號，0 不帶符號', () => {
    expect(fmtLotsUnit(-40123)).toBe('−40,123 張');
    expect(fmtLotsUnit(1_234_567)).toBe('+1,234,567 張');
    expect(fmtLotsUnit(812.4)).toBe('+812 張');
    expect(fmtLotsUnit(-4668)).toBe('−4,668 張');
    expect(fmtLotsUnit(0.4)).toBe('0 張');
    expect(fmtLotsUnit(125000, false)).toBe('125,000 張');
    expect(fmtLots(-12_345.6)).toBe('−12,346');
    expect(fmtLots(0.3)).toBe('0');
    expect(fmtLots(-0.4)).toBe('0');
    expect(fmtLotsAbs(1_234_567)).toBe('1,234,567');
    for (const v of [12_345, 999_999, 12_345_678]) expect(fmtLotsUnit(v)).not.toMatch(/萬|千|K|M|\./);
    expect(fmtLotsUnit(null)).toBe('—');
  });
  it('億元與其他單位', () => {
    expect(fmtYiUnit(-12.345)).toBe('−12.3 億元');
    expect(formatUnit(-40123, '張', true)).toBe('−40,123 張');
    expect(formatUnit(12.34, '%')).toBe('12.3%');
    expect(formatUnit(15.26, '倍')).toBe('15.3 倍');
  });
});

describe('glueNumbers', () => {
  it('數字與後面的單位之間改為不換行空白，數字前的空白保留', () => {
    expect(glueNumbers('最新月營收創 12 個月新高')).toBe('最新月營收創 12\u00a0個月新高');
    expect(glueNumbers('近 26 週增加 2.52 個百分點')).toBe('近 26\u00a0週增加 2.52\u00a0個百分點');
    expect(glueNumbers('佔成交量 4.9%）')).toBe('佔成交量 4.9%）');
  });
});

describe('統計數字格式器（2026-10-02 M1-3：全站唯一一套）', () => {
  it('pctSigned：帶正負號、2 位小數、負號 U+2212；0 不帶符號；空值「—」', () => {
    expect(pctSigned(1.684)).toBe('+1.68%');
    expect(pctSigned(-0.505)).toBe('−0.51%');
    expect(pctSigned(0)).toBe('0.00%');
    expect(pctSigned(-0.001)).toBe('0.00%'); // 四捨五入後為 0 → 不帶負號
    expect(pctSigned(12.3456, 1)).toBe('+12.3%');
    expect(pctSigned(null)).toBe('—');
    expect(pctSigned(undefined)).toBe('—');
    expect(pctSigned(Number.NaN)).toBe('—');
    expect(pctSigned(-3)).not.toContain('-'); // 不用 ASCII 連字號當負號
  });
  it('pctPlain：不帶正負號（勝率、涵蓋率）、2 位小數', () => {
    expect(pctPlain(53.812)).toBe('53.81%');
    expect(pctPlain(0)).toBe('0.00%');
    expect(pctPlain(100)).toBe('100.00%');
    expect(pctPlain(null)).toBe('—');
  });
  it('ratioPct：0–1 比例轉百分比', () => {
    expect(ratioPct(0.1398)).toBe('13.98%');
    expect(ratioPct(0.2573)).toBe('25.73%');
    expect(ratioPct(1)).toBe('100.00%');
    expect(ratioPct(0)).toBe('0.00%');
    expect(ratioPct(undefined)).toBe('—');
  });
  it('tText 與 ratioText：2 位小數、U+2212', () => {
    expect(tText(2.456)).toBe('2.46');
    expect(tText(-1.2)).toBe('−1.20');
    expect(tText(0)).toBe('0.00');
    expect(tText(null)).toBe('—');
    expect(ratioText(1.005)).toBe('1.00'); // 二進位浮點：1.005 → 1.00（與 toFixed 相同）
    expect(ratioText(-0.5)).toBe('−0.50');
    expect(ratioText(2.5, 1)).toBe('2.5');
    expect(ratioText(Number.POSITIVE_INFINITY)).toBe('—');
  });
  it('missing／orMissing：破折號一律附原因', () => {
    expect(missing('資料累積中')).toBe('—（資料累積中）');
    expect(orMissing(null, pctSigned, '沒有樣本')).toBe('—（沒有樣本）');
    expect(orMissing(Number.NaN, pctSigned, '沒有樣本')).toBe('—（沒有樣本）');
    expect(orMissing(0, pctSigned, '沒有樣本')).toBe('0.00%'); // 0 是有效值，不是缺值
    expect(orMissing(-2.5, pctSigned, '沒有樣本')).toBe('−2.50%');
  });
  it('md：ISO → M/D；沒有日期時附原因；不是 ISO 就原樣回傳', () => {
    expect(md('2026-09-04')).toBe('9/4');
    expect(md('2026-12-31T00:00:00Z')).toBe('12/31');
    expect(md(null)).toBe('—（沒有日期）');
    expect(md('')).toBe('—（沒有日期）');
    expect(md(undefined, '沒有訊號')).toBe('—（沒有訊號）');
    expect(md('9/4')).toBe('9/4');
  });
  it('fmtCount：整數千分位、四捨五入；空值「—」', () => {
    expect(fmtCount(1234567)).toBe('1,234,567');
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(12.6)).toBe('13');
    expect(fmtCount(null)).toBe('—');
  });
});

describe('dirClass（U-09：0 用中性色）', () => {
  it('0、空值、NaN → flat；正負 → up/down；eps 內視為持平', async () => {
    const { dirClass, dirColor } = await import('./format');
    expect(dirClass(0)).toBe('flat');
    expect(dirClass(-0)).toBe('flat');
    expect(dirClass(null)).toBe('flat');
    expect(dirClass(Number.NaN)).toBe('flat');
    expect(dirClass(0.1)).toBe('up');
    expect(dirClass(-2)).toBe('down');
    expect(dirClass(0.004, 0.005)).toBe('flat');
    expect(dirColor(0)).toBe('var(--flat)');
    expect(dirColor(3)).toBe('var(--up)');
  });
});

describe('2026-10-02 健檢 M1-3：全站唯一的統計數字格式器', () => {
  it('百分比 2 位、t 2 位、比例轉百分比、缺值附原因', async () => {
    const { pctSigned, pctPlain, ratioPct, tText, ratioText, missing, orMissing, md, fmtCount } = await import('./format');
    expect(pctSigned(18.907)).toBe('+18.91%');
    expect(pctSigned(-0.511)).toBe('−0.51%');
    expect(pctSigned(0)).toBe('0.00%');
    expect(pctSigned(null)).toBe('—');
    expect(pctPlain(53.814)).toBe('53.81%');
    expect(ratioPct(0.1398)).toBe('13.98%');
    expect(ratioPct(0.2573)).toBe('25.73%');
    expect(tText(3.914)).toBe('3.91');
    expect(tText(-1.675)).toBe('−1.68');
    expect(ratioText(1.2)).toBe('1.20');
    expect(missing('資料累積中')).toBe('—（資料累積中）');
    expect(orMissing(null, (v) => `${v}`, '沒有樣本')).toBe('—（沒有樣本）');
    expect(orMissing(2, (v) => `${v} 筆`, '沒有樣本')).toBe('2 筆');
    expect(md('2026-10-01')).toBe('10/1');
    expect(md(null, '沒有日期')).toBe('—（沒有日期）');
    expect(fmtCount(12345)).toBe('12,345');
  });
});
