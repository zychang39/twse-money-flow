// 2026-10-10：圖表讀值不用浮框——兩指區間的日期標籤位置、小倍數圖的月份刻度與讀值文字
import { describe, expect, it } from 'vitest';
import { rangeLabelXs } from '../components/HeroChart';
import { type ChartPanel, monthTicks, readDate, readoutParts } from '../components/StackedChart';

describe('兩指區間：兩端日期標在標線下方', () => {
  it('離得夠遠：各自在標線正下方', () => {
    expect(rangeLabelXs(100, 260, 60, 60, 12, 381)).toEqual([100, 260]);
  });
  it('靠邊：往內收，不超出圖外', () => {
    const [a, b] = rangeLabelXs(14, 379, 60, 60, 12, 381);
    expect(a - 30).toBeGreaterThanOrEqual(12);
    expect(b + 30).toBeLessThanOrEqual(381);
  });
  it('太近：從中點左右推開、不重疊；推到邊緣時整組往內移', () => {
    const [a, b] = rangeLabelXs(200, 210, 60, 60, 12, 381);
    expect(b - 30 - (a + 30)).toBeGreaterThanOrEqual(6 - 1e-9);
    expect((a + b) / 2).toBeCloseTo(205);
    const [c, d] = rangeLabelXs(370, 375, 60, 60, 12, 381);
    expect(d + 30).toBeLessThanOrEqual(381 + 1e-9);
    expect(d - 30 - (c + 30)).toBeGreaterThanOrEqual(6 - 1e-9);
  });
  it('同一點：只標一個', () => {
    expect(rangeLabelXs(150, 150, 60, 60, 12, 381)).toEqual([150]);
  });
});

describe('小倍數圖：月份刻度與讀值', () => {
  // 1 年週資料（52 週）：每月約 4 點
  const weeks = Array.from({ length: 52 }, (_, i) => new Date(Date.UTC(2025, 9, 3 + i * 7)).toISOString().slice(0, 10));
  it('相鄰月份標籤太近時隔月標示，標籤不重疊', () => {
    const step = 299 / 52;
    const ticks = monthTicks(weeks, (i) => 44 + step * i, 0, 351);
    expect(ticks.length).toBeGreaterThan(3);
    expect(ticks.length).toBeLessThan(12);
    const xs = ticks.map((t) => 44 + step * t.i);
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(26 + 8);
  });
  it('間距夠寬時每個月都標', () => {
    const ticks = monthTicks(weeks, (i) => i * 20, 0, 52 * 20);
    expect(ticks.map((t) => t.label)).toContain('11月');
    expect(ticks.length).toBe(11); // 10 月起的 52 週：11 月～隔年 9 月
  });
  it('讀值：日期含星期；柱狀面板依正負標方向', () => {
    expect(readDate('2026-04-10')).toBe('2026/4/10（五）');
    const bars: ChartPanel = { id: 'b', title: '每週增減', kind: 'bars', height: 60, series: [{ key: 'b', label: '週增減', values: [0.07, -0.02, null] }], format: (v) => v.toFixed(2) };
    expect(readoutParts(bars, 0)).toEqual([{ label: '週增減', text: '0.07', dir: 'up' }]);
    expect(readoutParts(bars, 1)[0].dir).toBe('down');
    expect(readoutParts(bars, 2)).toEqual([{ label: '週增減', text: '—', dir: '' }]);
  });
});
