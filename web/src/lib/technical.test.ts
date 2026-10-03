import { describe, expect, it } from 'vitest';
import { ema, kdSeries, kdText, macdSeries, macdText, techFacts } from './technical';

describe('技術指標（與 pipeline 同定義，手算）', () => {
  it('KD：9 日最高 20、最低 10、收盤 19 → RSV 90；K＝⅔×50＋⅓×90＝63.33；D＝⅔×50＋⅓×63.33＝54.44', () => {
    const hi = Array(9).fill(20);
    const lo = Array(9).fill(10);
    const c = [...Array(8).fill(15), 19];
    const { k, d } = kdSeries(hi, lo, c);
    expect(k[7]).toBeNull();
    expect(k[8]).toBeCloseTo(63.333, 3);
    expect(d[8]).toBeCloseTo(54.444, 3);
  });
  it('EMA：α＝2/(n+1)，第一個值起算', () => {
    expect(ema([10, 20, null, 30], 3)).toEqual([10, 15, null, 22.5]);
  });
  it('MACD 暖機 60 日', () => {
    const c = Array.from({ length: 80 }, (_, i) => 10 + i * 0.1);
    const m = macdSeries(c);
    expect(m.dif[59]).toBeNull();
    expect(m.dif[60]).not.toBeNull();
  });
  it('乖離、鈍化天數、文字', () => {
    const n = 40;
    const c = Array.from({ length: n }, (_, i) => 100 + i);
    const t = techFacts(c.map((v) => v + 1), c.map((v) => v - 1), c, Array(n).fill(1));
    // 最後 20 日 120…139 平均 129.5 → 139 ÷ 129.5 − 1 ＝ 7.34%
    expect(t.bias20).toBeCloseTo((139 / 129.5 - 1) * 100, 6);
    expect(t.kdHighDays).toBeGreaterThan(0);
    expect(kdText(t)).toContain('K ≥ 80 連');
    // 2026-10-02 健檢：方向只寫一次（翻正已含方向），柱狀數值另外顯示
    expect(macdText({ ...t, hist: 0.5, histFlipDays: 3, dif: 1 })).toBe('柱狀 3 日前翻正・DIF 在零軸上');
    expect(macdText({ ...t, hist: -0.5, histFlipDays: 0, dif: -1 })).toBe('柱狀今日翻負・DIF 在零軸下');
    expect(macdText({ ...t, hist: 0.5, histFlipDays: null, dif: 1 })).toBe('柱狀為正・DIF 在零軸上');
    expect(macdText({ ...t, hist: null })).toBe('資料不足');
  });
});
