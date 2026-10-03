import { describe, expect, it } from 'vitest';
import { curveRead, curveSummary, intTicks, logTicks, peakAtEdge } from './curve';

const line = { mean: [0.5, 1.0, 1.2, 1.1], lo: [0.1, 0.2, 0.3, 0.2], hi: [0.9, 1.8, 2.1, 2.0], peak: 3 };

describe('累積超額曲線（2026-10-03：120 日、無 alpha 耗盡）', () => {
  it('讀值夾在 1～K', () => {
    expect(curveRead(line, 3)).toEqual({ k: 3, mean: 1.2, lo: 0.3, hi: 2.1 });
    expect(curveRead(line, 0).k).toBe(1);
    expect(curveRead(line, 99).k).toBe(4);
  });
  it('摘要寫峰值日；峰值在窗邊界時加註', () => {
    expect(curveSummary(line)).toBe('峰值第 3 日 +1.20%');
    expect(curveSummary({ ...line, peak: 4, peak_at_edge: true })).toBe('峰值第 4 日 +1.10%・峰值在觀察窗邊界');
    expect(peakAtEdge({ ...line, peak: 4 })).toBe(true);
    expect(peakAtEdge(line)).toBe(false);
    expect(curveSummary(undefined)).toBe('—（曲線資料累積中：需要至少 2 個進場日）');
    expect(curveSummary({ ...line, peak: null })).toBe('—（曲線資料累積中：需要至少 2 個進場日）');
    expect(curveSummary({ ...line, mean: [0.5, 1.0, null, 1.1] })).toBe('峰值第 3 日 —（沒有讀值）');
    expect(curveSummary(line)).not.toContain('耗盡');
  });
  it('整數刻度與對數刻度', () => {
    expect(intTicks(-1.3, 5.8)).toEqual([-2, 0, 2, 4, 6]);
    expect(intTicks(0, 0.4).every(Number.isInteger)).toBe(true);
    expect(intTicks(-12, 43)).toEqual([-20, 0, 20, 40, 60]);
    expect(logTicks(0.8, 5.2)).toEqual([0.5, 1, 2, 4, 8]);
    expect(logTicks(0.9, 3000)).toEqual([0.1, 1, 10, 100, 1000, 10000]);
  });
});
