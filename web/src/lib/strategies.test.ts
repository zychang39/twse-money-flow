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

describe('2026-10-02 健檢：參數中文標籤與基準切換整組一起換', () => {
  it('paramRows：原始參數字串 → 中文標籤與單位；解析不了的原樣一列', async () => {
    const { paramRows } = await import('./strategies');
    expect(paramRows('rs_min=70、vol_ratio=1.5、hold=40')).toEqual([
      { key: 'rs_min', label: 'RS 門檻', value: '70' },
      { key: 'vol_ratio', label: '量比門檻', value: '1.5 倍' },
      { key: 'hold', label: '持有日數', value: '40 日' },
    ]);
    expect(paramRows('value_min=100000000、bias_max=0.1')).toEqual([
      { key: 'value_min', label: '成交值下限', value: '1 億元' },
      { key: 'bias_max', label: '乖離上限', value: '10%' },
    ]);
    expect(paramRows('投信連買=5／外資門檻=0.1')).toEqual([{ key: '投信連買=5／外資門檻=0.1', label: '投信連買=5／外資門檻=0.1', value: '' }]);
    expect(paramRows(null)).toEqual([]);
  });
  it('judged：等權＝判定用的數字（超額勝率來自 bench.ew）；0050 時超額、t、超額勝率整組換', async () => {
    const { judged, benchTable } = await import('./strategies');
    const s = {
      id: 'a', test: 'ta', label: 'A', subtitle: '', verdict: '有效', enabled: true, reasons: [], env: null,
      t: 4.0, t_corr: 4.0, win: 51.6, excess_h: { '40': 1.681, '20': 0.9 },
      h: { '40': { n: 100, mean_excess: 1.681, t: 4.0, bench: { ew: { mean_excess: 1.681, t: 4.0, win: 42.47 }, '0050': { mean_excess: 1.235, t: 1.58, win: 41.79 } } } },
    } as never;
    expect(judged(s, 'ew')).toEqual({ hold: 40, excess: 1.681, t: 4.0, win: 42.47 });
    expect(judged(s, '0050')).toEqual({ hold: 40, excess: 1.235, t: 1.58, win: 41.79 });
    expect(judged(s, 'tr')).toEqual({ hold: 40, excess: null, t: null, win: null });
    expect(benchTable(s)?.['0050']?.t).toBe(1.58);
  });
});
