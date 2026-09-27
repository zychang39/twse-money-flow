import { describe, expect, it } from 'vitest';
import { fmtLotsUnit, fmtYiUnit } from './format';
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
