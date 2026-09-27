import { describe, expect, it } from 'vitest';
import {
  LEVEL_LABEL,
  alignClose,
  bigMinLevel,
  changeText,
  clampThresholds,
  groupOf,
  groupSeries,
  groupWeek,
  headline,
  metricText,
  smallMaxLevel,
  type HolderBlock,
} from './holders';

// 3 週；分級 1–15 的比例：分級 15（千張）逐週增加、分級 2 減少
function block(): HolderBlock {
  const pctWeek = (w: number) => [2, 20 - w, 5, 3, 2, 2, 2, 1, 5, 5, 6, 5, 3, 2, 37 + w];
  const holdersWeek = (w: number) => [20000, 12000 - 100 * w, 900, 250, 130, 90, 60, 40, 70, 40, 25, 12, 6, 3, 10];
  const weeks = [0, 1, 2];
  return {
    d: ['2026-09-10', '2026-09-17', '2026-09-24'],
    p: Array.from({ length: 15 }, (_, lv) => weeks.map((w) => pctWeek(w)[lv])),
    n: Array.from({ length: 15 }, (_, lv) => weeks.map((w) => holdersWeek(w)[lv])),
    ts: [1e9, 1e9, 1e9],
    th: weeks.map((w) => holdersWeek(w).reduce((a, b) => a + b, 0)),
  };
}

describe('大戶／散戶門檻', () => {
  it('門檻對應集保分級：散戶「X 張以下」、大戶「超過 Y 張」', () => {
    expect(smallMaxLevel(1)).toBe(1); // 不到 1 張＝零股分級
    expect(smallMaxLevel(10)).toBe(3); // 1–5、5–10 張
    expect(bigMinLevel(400)).toBe(12); // 400–600 張起
    expect(bigMinLevel(1000)).toBe(15);
    expect(groupOf(3, 10, 400)).toBe('small');
    expect(groupOf(11, 10, 400)).toBe('mid');
    expect(groupOf(12, 10, 400)).toBe('big');
    expect(LEVEL_LABEL).toHaveLength(15);
    expect(LEVEL_LABEL[1]).toBe('1–5 張');
    expect(LEVEL_LABEL[14]).toBe('超過 1000 張');
  });

  it('門檻交叉時自動修正（散戶門檻一定小於大戶門檻）', () => {
    expect(clampThresholds(400, 400)).toEqual({ small: 200, big: 400 });
    expect(clampThresholds(1000, 1000)).toEqual({ small: 800, big: 1000 });
    expect(clampThresholds(10, 999)).toEqual({ small: 10, big: 1000 });
  });

  it('群組合計：比例、人數、人均張數', () => {
    const b = block();
    const big = groupWeek(b, 2, 'big', 10, 400);
    expect(big.pct).toBeCloseTo(5 + 3 + 2 + 39);
    expect(big.holders).toBe(12 + 6 + 3 + 10);
    expect(big.avg).toBeCloseTo((0.49 * 1e9) / 31 / 1000);
    const small = groupWeek(b, 0, 'small', 10, 400);
    expect(small.pct).toBeCloseTo(2 + 20 + 5);
    expect(small.holders).toBe(20000 + 12000 + 900);
  });

  it('逐週序列與週變化；任一分級缺值 → 空值', () => {
    const b = block();
    const s = groupSeries(b, 52, 10, 1000, 'pct');
    expect(s.dates).toHaveLength(3);
    expect(s.big).toEqual([37, 38, 39]);
    expect(s.bigChange).toEqual([null, 1, 1]);
    b.p[14][1] = null;
    expect(groupSeries(b, 52, 10, 1000, 'pct').big[1]).toBeNull();
    expect(groupSeries(b, 2, 10, 1000, 'pct').dates).toEqual(['2026-09-17', '2026-09-24']);
  });

  it('結論句：大戶比例變化＋散戶人數變化（中性字眼）', () => {
    const s = headline(block(), 52, 10, 1000);
    expect(s).toBe('大戶（超過 1000 張）持股 39.00%，近 3 週增加 2.00 個百分點；散戶人數同期減少 0.6%');
    expect(s).not.toMatch(/買進|賣出|建議/);
  });

  it('數字與變化的文字', () => {
    expect(metricText(52.345, 'pct')).toBe('52.35%');
    expect(metricText(123456, 'holders')).toBe('12.3\u00a0萬人');
    expect(changeText(-1.2, 'pct')).toBe('▼1.20 個百分點');
    expect(changeText(35, 'holders')).toBe('▲35 人');
  });

  it('每週收盤：該週資料日（含）之前最後一個收盤', () => {
    expect(alignClose(['2026-09-17', '2026-09-24'], ['2026-09-16', '2026-09-17', '2026-09-22', '2026-09-25'], [10, 11, 12, 13])).toEqual([11, 12]);
  });
});
