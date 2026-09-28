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
  structureSentence,
  tierDefinition,
  tierOf,
  tierRange,
  tierStats,
  tierWeek,
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
    expect(s).toBe('大戶（≥ 1,000 張）持股 39.00%，近 3 週增加 2.00 個百分點；散戶人數同期減少 0.6%');
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

describe('v3 全站統一分級（散戶 ≤ 5｜中實戶｜大戶 ≥ 400｜千張 ≥ 1,000）', () => {
  it('分級對應：散戶＝1–2、中實戶＝3–11、大戶段＝12–14、千張＝15', () => {
    expect([1, 2].map(tierOf)).toEqual(['retail', 'retail']);
    expect([3, 11].map(tierOf)).toEqual(['mid', 'mid']);
    expect([12, 13, 14].map(tierOf)).toEqual(['big', 'big', 'big']);
    expect(tierOf(15)).toBe('whale');
    expect(tierRange('retail')).toBe('≤ 5 張');
    expect(tierRange('mid')).toBe('5–400 張');
    expect(tierRange('big')).toBe('400–1,000 張');
    expect(tierRange('whale')).toBe('≥ 1,000 張');
    expect(tierDefinition()).toBe('散戶 ≤ 5 張｜中實戶 5–400 張｜大戶 ≥ 400 張（含千張大戶）｜千張大戶 ≥ 1,000 張');
  });

  it('四段合計（手算）：第 3 週（w＝2）', () => {
    // pctWeek(2) = [2, 18, 5, 3, 2, 2, 2, 1, 5, 5, 6, 5, 3, 2, 39]
    const t = tierWeek(block(), 2);
    expect(t.retail.pct).toBeCloseTo(2 + 18); // 分級 1–2
    expect(t.mid.pct).toBeCloseTo(5 + 3 + 2 + 2 + 2 + 1 + 5 + 5 + 6); // 分級 3–11 = 31
    expect(t.big.pct).toBeCloseTo(5 + 3 + 2); // 分級 12–14 = 10
    expect(t.whale.pct).toBeCloseTo(39);
    expect(t.retail.pct! + t.mid.pct! + t.big.pct! + t.whale.pct!).toBeCloseTo(100);
    // 人數：holdersWeek(2) 分級 1–2 = 20000 + (12000 − 200)
    expect(t.retail.holders).toBe(31800);
    // 人均張數：千張 39% × 1e9 股 ÷ 10 人 ÷ 1000 = 39,000 張
    expect(t.whale.avg).toBeCloseTo(39000);
  });

  it('週變化與連續週數（手算）：千張 37 → 38 → 39，連 2 週增加 1.00 個百分點；散戶 22 → 21 → 20 連 2 週減少', () => {
    const st = Object.fromEntries(tierStats(block()).map((x) => [x.tier, x]));
    expect(st.whale.change).toBeCloseTo(1);
    expect(st.whale.streak).toBe(2);
    expect(st.retail.change).toBeCloseTo(-1);
    expect(st.retail.streak).toBe(-2);
    expect(st.mid.change).toBeCloseTo(0);
    expect(st.mid.streak).toBe(0);
    expect(structureSentence(block())).toBe('千張大戶本週 +1.00 個百分點，連 2 週增加');
  });

  it('只有 1 週：不寫週變化；持平：寫持平', () => {
    const b = block();
    const one: HolderBlock = { d: [b.d[2]], p: b.p.map((r) => [r[2]]), n: b.n.map((r) => [r[2]]), ts: [b.ts[2]], th: [b.th[2]] };
    expect(structureSentence(one)).toBe('千張大戶持股 39.00%（目前只有 1 週資料，下週起可比較週變化）');
    expect(tierStats(one).every((x) => x.change === null && x.streak === 0)).toBe(true);
    const flat = block();
    flat.p[14] = [39, 39, 39];
    expect(structureSentence(flat)).toBe('千張大戶本週持平（39.00%）');
  });
});
