import { describe, expect, it } from 'vitest';
import { fmtLots, fmtLotsAbs, fmtLotsUnit, fmtYiUnit, glueNumbers } from './format';
import { formatUnit } from '../components/KChart';

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
