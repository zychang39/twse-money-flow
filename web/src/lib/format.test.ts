import { describe, expect, it } from 'vitest';
import { fmtLotsUnit, fmtYiUnit, glueNumbers } from './format';
import { formatUnit } from '../components/KChart';

describe('圖表單位格式', () => {
  it('張數不顯示小數、1 萬張以上縮寫為萬張、帶正負號', () => {
    expect(fmtLotsUnit(-40123)).toBe('−4.0 萬張');
    expect(fmtLotsUnit(812.4)).toBe('+812 張');
    expect(fmtLotsUnit(-4668)).toBe('−4,668 張');
    expect(fmtLotsUnit(0.4)).toBe('0 張');
    expect(fmtLotsUnit(125000, false)).toBe('12.5 萬張');
    expect(fmtLotsUnit(null)).toBe('—');
  });
  it('億元與其他單位', () => {
    expect(fmtYiUnit(-12.345)).toBe('−12.3 億元');
    expect(formatUnit(-40123, '張', true)).toBe('−4.0 萬張');
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
