import { describe, expect, it } from 'vitest';
import { curveRead, curveSummary } from './curve';

const line = { mean: [0.5, 1.0, 1.2, 1.1], lo: [0.1, 0.2, 0.3, 0.2], hi: [0.9, 1.8, 2.1, 2.0], peak: 3, exhaust: 4 };

describe('累積超額曲線（v3 M3）', () => {
  it('讀值夾在 1～K', () => {
    expect(curveRead(line, 3)).toEqual({ k: 3, mean: 1.2, lo: 0.3, hi: 2.1 });
    expect(curveRead(line, 0).k).toBe(1);
    expect(curveRead(line, 99).k).toBe(4);
  });
  it('摘要寫峰值日與 alpha 耗盡日', () => {
    expect(curveSummary(line)).toBe('峰值第 3 日 +1.20%；第 4 日起 alpha 耗盡');
    expect(curveSummary({ ...line, exhaust: null })).toBe('峰值第 3 日 +1.20%；60 日內沒有連續 5 日邊際超額 ≤ 0');
    expect(curveSummary(undefined)).toBe('—（曲線資料累積中：需要至少 2 個進場日）');
    expect(curveSummary({ ...line, peak: null })).toBe('—（曲線資料累積中：需要至少 2 個進場日）');
    expect(curveSummary({ ...line, mean: [0.5, 1.0, null, 1.1] })).toBe('峰值第 3 日 —（沒有讀值）；第 4 日起 alpha 耗盡');
  });
});
