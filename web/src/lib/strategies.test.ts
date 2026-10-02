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

describe('分級（2026-10-02）', () => {
  it('舊資料沒有 grade 時由 enabled 推回；標籤語氣', async () => {
    const { gradeOf, gradeTone, judgeHold, netExcess, allowedTests, gradeByTest } = await import('./strategies');
    expect(gradeOf({ grade: '有效', enabled: true })).toBe('有效');
    expect(gradeOf({ enabled: true })).toBe('觀察中');
    expect(gradeOf({ enabled: false })).toBe('停用');
    expect(gradeTone('有效')).toBe('strong');
    expect(gradeTone('觀察中')).toBe('plain');
    expect(gradeTone('停用')).toBe('muted');
    expect(judgeHold({})).toBe(40);
    expect(judgeHold({ swing: { hold: 20, params: {}, segments: {}, gates: { checks: {}, labels: {}, passed: false } } })).toBe(20);
    const base = { id: 'a', test: 'ta', label: 'A', subtitle: '', verdict: '有效', enabled: true, reasons: [], env: null };
    expect(netExcess({ ...base, excess_h: { '40': 1.2, '20': 0.5 }, mean_excess: 9 })).toBe(1.2);
    expect(netExcess({ ...base, h: { '40': { mean_excess: 0.7 } }, mean_excess: 9 })).toBe(0.7);
    expect(netExcess({ ...base, mean_excess: 9 })).toBe(9);
    const list = [
      { ...base, grade: '有效' as const, grade_label: '有效・待前瞻驗證' },
      { ...base, id: 'b', test: 'tb', grade: '停用' as const },
      { ...base, id: 'c', test: 'tc', enabled: true },
    ];
    expect([...allowedTests(list)!]).toEqual(['ta', 'tc']);
    expect(gradeByTest(list)!.get('ta')).toEqual({ grade: '有效', label: '有效・待前瞻驗證' });
    expect(allowedTests(null)).toBeNull();
  });
});
