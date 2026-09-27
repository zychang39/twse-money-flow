import { describe, expect, it } from 'vitest';
import { change, fillForward, periodStart, sliceWindow } from './periods';
import { extent, nearestIndex, points, resample } from './chartMath';

const dates = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05', '2026-06-01', '2026-08-24', '2026-09-17', '2026-09-23', '2026-09-24'];

describe('期間選擇器', () => {
  it('1D 為昨收到今收；YTD 以去年最後一個交易日為基準；1W 以 7 天前最後一個交易日為基準', () => {
    expect(periodStart(dates, '1D').start).toBe(dates.length - 2);
    expect(dates[periodStart(dates, 'YTD').start]).toBe('2025-12-31');
    expect(dates[periodStart(dates, '1W').start]).toBe('2026-09-17');
    expect(dates[periodStart(dates, '1M').start]).toBe('2026-08-24');
    expect(periodStart(dates, 'ALL').start).toBe(0);
  });
  it('資料不足所選期間時標示 truncated', () => {
    expect(periodStart(dates, '1Y').truncated).toBe(true);
  });
  it('前值補齊與漲跌方向', () => {
    expect(fillForward([null, 2, null, 3])).toEqual([2, 2, 2, 3]);
    expect(fillForward([null, null])).toBeNull();
    const w = sliceWindow(dates, [1, 2, 3, 4, 5, 6, 7, 8, 7], '1D')!;
    expect(w.values).toEqual([8, 7]);
    expect(change(w.values)).toMatchObject({ abs: -1, dir: 'down' });
    expect(change([5, 5]).dir).toBe('flat');
  });
});

describe('走勢圖幾何', () => {
  const f = { w: 100, h: 50, padX: 0, padY: 0 };
  it('座標換算與拖曳找點', () => {
    const pts = points([1, 2, 3], f, extent([1, 2, 3]));
    expect(pts[0]).toEqual([0, 50]);
    expect(pts[2]).toEqual([100, 0]);
    expect(nearestIndex(49, f, 3)).toBe(1);
    expect(nearestIndex(-20, f, 3)).toBe(0);
  });
  it('重新取樣保留端點（期間切換變形用）', () => {
    const r = resample([[0, 0], [10, 10]], 5);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual([0, 0]);
    expect(r[4]).toEqual([10, 10]);
    expect(r[2]).toEqual([5, 5]);
  });
  it('水平線時仍有可繪製的範圍', () => {
    const [lo, hi] = extent([5, 5]);
    expect(hi).toBeGreaterThan(lo);
  });
});
