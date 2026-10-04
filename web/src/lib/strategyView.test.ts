import { describe, expect, it } from 'vitest';
import { extremes, histogram, monthMark, periodLabel, periodNote, portBench, signalIdx, yearStripes, yearSummary, yearsIn } from './strategyView';
import type { PeriodView, YearRow } from '../data/types';

const card = (n: number) => ({ n }) as PeriodView['card'];
const view = (from: string, to: string, n: number) => ({ from, to, days: 0, card: card(n) }) as unknown as PeriodView;
const yr = (year: string, port: number | null, b: number | null): YearRow => ({ year, n: 50, excess: { ew: 1, '0050': 1, tr: 1, '00631L': 1 }, port, bench: { '0050': b } });

describe('strategyView', () => {
  it('期間文字', () => {
    expect(periodLabel('all')).toBe('全部');
    expect(periodLabel('last:3')).toBe('近 3 年');
    expect(periodLabel('from:2022')).toBe('2022 起');
    expect(periodLabel('year:2024')).toBe('2024 年');
  });
  it('期間說明：全部沒有；n < 100 樣本不足', () => {
    expect(periodNote('all', view('2017-01-01', '2026-10-02', 708), 708)).toBeNull();
    expect(periodNote('from:2022', view('2022-01-03', '2026-10-02', 406), 708)).toEqual({ text: '檢視 2022 起・406／708 筆・分級以全期間為準', small: false });
    expect(periodNote('year:2024', view('2024-01-02', '2024-12-31', 86), 708)?.small).toBe(true);
    expect(periodNote('last:3', view('2023-10-02', '2026-10-02', 286), 708)?.text).toContain('近 3 年（2023/10 起）');
  });
  it('等權沒有組合基準 → 0050', () => {
    expect(portBench('ew')).toBe('0050');
    expect(portBench('tr')).toBe('tr');
  });
  it('年份與統計格', () => {
    const rows = [yr('2022', -10, -20), yr('2023', 30, 20), yr('2024', 5, 10)];
    expect(yearsIn(rows, view('2023-01-01', '2024-12-31', 1)).map((r) => r.year)).toEqual(['2023', '2024']);
    const s = yearSummary(rows, '0050');
    expect(s).toMatchObject({ m: 3, beat: 2, loss: 1, lossB: 1, worst: -10, worstB: -20 });
    expect(s.avg).toBeCloseTo(25 / 3);
  });
  it('逐筆依訊號日篩選、最大最小', () => {
    const sig = { n: 4, signal: ['2023-12-29', '2024-01-02', '2024-06-01', '2025-01-02'] };
    expect(signalIdx(sig, '2024-01-01', '2024-12-31')).toEqual([1, 2]);
    const e = extremes([{ i: 0, v: 3 }, { i: 1, v: -1 }, { i: 2, v: 9 }], 2);
    expect(e.top.map((x) => x.i)).toEqual([2, 0]);
    expect(e.bottom.map((x) => x.i)).toEqual([1, 0]);
  });
  it('直方圖：總數守恆、平均與中位數', () => {
    const vals = Array.from({ length: 101 }, (_, i) => i - 50);
    const h = histogram(vals, 10);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(101);
    expect(h.mean).toBeCloseTo(0);
    expect(h.median).toBe(0);
  });
  it('年份直條與月份標記', () => {
    const st = yearStripes(['2024-12-20', '2024-12-27', '2025-01-03', '2025-01-10']);
    expect(st.map((s) => s.label)).toEqual(['2024', '2025']);
    expect(st[0]).toMatchObject({ from: 0, to: 2 });
    expect(monthMark(['2023-01', '2023-02', '2024-01', '2024-12', '2025-01'], '2024-01-02', '2024-12-31')).toEqual({ from: 2, to: 3 });
  });
});
