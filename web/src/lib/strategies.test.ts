import { describe, expect, it } from 'vitest';
import { basisText } from './strategies';

describe('觸發依據（v3 M5-5）', () => {
  it('數值、單位與正負號', () => {
    expect(basisText({ label: '投信連買', value: 6, unit: '日' })).toBe('投信連買 6 日');
    expect(basisText({ label: '千張大戶週變化', value: 0.42, unit: '百分點' })).toBe('千張大戶週變化 +0.42 百分點');
    expect(basisText({ label: '千張大戶週變化', value: -0.1, unit: '百分點' })).toBe('千張大戶週變化 −0.1 百分點');
    expect(basisText({ label: '當日成交值', value: 2281, unit: '百萬元' })).toBe('當日成交值 2,281 百萬元');
    expect(basisText({ label: '融資 5 日', value: 3.4, unit: '%' })).toBe('融資 5 日 +3.4%');
    expect(basisText({ label: 'RS 百分位', value: 91.5, unit: '' })).toBe('RS 百分位 91.5');
    expect(basisText({ label: 'K 值', value: null, unit: '' })).toBe('K 值 —');
  });
});
