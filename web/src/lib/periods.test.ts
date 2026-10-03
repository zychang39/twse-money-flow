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

import { LONG_PERIODS, WEEKLY_PERIODS, weekKey, weeklyIndices } from './periods';
describe('v3 M5：10Y 與週線取樣', () => {
  it('10Y 以 120 個月前最後一個交易日為基準', () => {
    // 手算：目標日 2016-09-24（週六）→ 最後一個 ≤ 目標的交易日是 2016-09-23
    const ds = ['2016-09-22', '2016-09-23', '2016-09-26', '2026-09-24'];
    expect(ds[periodStart(ds, '10Y').start]).toBe('2016-09-23');
    expect(periodStart(ds.slice(2), '10Y')).toEqual({ start: 0, truncated: true }); // 不滿 10 年
  });
  it('週鍵為該週星期一；週線取樣保留第一點與每週最後一個交易日（含最新一天）', () => {
    expect(weekKey('2026-09-24')).toBe('2026-09-21'); // 週四 → 週一
    expect(weekKey('2026-09-21')).toBe('2026-09-21');
    expect(weekKey('2026-09-27')).toBe('2026-09-21'); // 週日屬於同一週
    const ds = ['2026-09-14', '2026-09-15', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-24'];
    expect(weeklyIndices(ds)).toEqual([0, 2, 5]);
    expect(weeklyIndices(['2026-09-24'])).toEqual([0]);
    expect(LONG_PERIODS).toEqual(['5Y', '10Y', 'ALL']);
    expect(WEEKLY_PERIODS).toEqual(['10Y', 'ALL']);
  });
});

describe('首頁 1D 盤中視窗（M2，2026-10-03）', async () => {
  const { intradayWindow, windowDayChange } = await import('./periods');
  it('dates 為「日期T時:分」，日漲跌仍用日資料（只比對日期）', () => {
    const intra = { date: '2026-10-02', points: [{ t: '09:00', v: 100 }, { t: '09:01', v: 101 }, { t: '13:30', v: 103 }] };
    const w = intradayWindow(intra, { dates: ['2026-10-01', '2026-10-02'], values: [98, 103] })!;
    expect(w.dates).toEqual(['2026-10-02T09:00', '2026-10-02T09:01', '2026-10-02T13:30']);
    expect(w.values).toEqual([100, 101, 103]);
    expect(windowDayChange(w)!.abs).toBe(5); // 103 − 98（日資料），不是視窗內 103 − 100
    expect(intradayWindow(null, null)).toBeNull();
    expect(intradayWindow({ date: '2026-10-02', points: [] }, null)).toBeNull();
  });
});
