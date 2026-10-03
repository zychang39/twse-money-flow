import { describe, expect, it } from 'vitest';
import { axisPos, lerpAxis, linearAxis, logAxis, spreadLabels } from './axis';

describe('通用圖表的軸', () => {
  it('線性：整數刻度、涵蓋全部數值', () => {
    const ax = linearAxis([-3.2, 7.9, 12.4]);
    expect(ax.lo).toBeLessThanOrEqual(-3.2);
    expect(ax.hi).toBeGreaterThanOrEqual(12.4);
    for (const t of ax.ticks) expect(Number.isInteger(t)).toBe(true);
    expect(ax.ticks.length).toBeGreaterThanOrEqual(3);
  });
  it('線性：常數序列也有範圍', () => {
    const ax = linearAxis([5, 5, 5]);
    expect(ax.hi).toBeGreaterThan(ax.lo);
  });
  it('對數：刻度為 1／2／5 × 10^k', () => {
    const ax = logAxis([0.8, 3.4, 12]);
    expect(ax.log).toBe(true);
    expect(ax.lo).toBeLessThanOrEqual(0.8);
    expect(ax.hi).toBeGreaterThanOrEqual(12);
    for (const t of ax.ticks) expect([1, 2, 5]).toContain(Number((t / Math.pow(10, Math.floor(Math.log10(t) + 1e-9))).toFixed(6)));
  });
  it('axisPos：下緣 0、上緣 1', () => {
    const ax = linearAxis([0, 10]);
    expect(axisPos(ax.lo, ax)).toBe(0);
    expect(axisPos(ax.hi, ax)).toBe(1);
  });
  it('lerpAxis：t=0 為起點、t=1 為目標', () => {
    const a = linearAxis([0, 10]), b = linearAxis([0, 100]);
    expect(lerpAxis(a, b, 0).hi).toBe(a.hi);
    expect(lerpAxis(a, b, 1).hi).toBe(b.hi);
  });
  it('spreadLabels：不重疊且在範圍內', () => {
    const out = spreadLabels([50, 52, 51, 200], 16, 0, 210);
    const s = [...out].sort((x, y) => x - y);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(16 - 1e-9);
    expect(Math.max(...out)).toBeLessThanOrEqual(210);
  });
});
