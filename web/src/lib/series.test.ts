import { heroWindows } from './heroSeries';
import { describe, expect, it } from 'vitest';
import { countValid, coverage, coverageNote, segments, windowCoverageNote } from './series';
import { sliceWindow, periodStart } from './periods';
import { points, extent } from './chartMath';
import { groupSeries, headline, shortTitle, type HolderBlock } from './holders';
import { niceScale } from './scale';

describe('圖表資料邊界：segments', () => {
  it('連續兩點以上為線段，前後缺值的孤立點另外列出', () => {
    expect(segments([1, 2, null, 3, null, 4, 5, 6])).toEqual({ runs: [[0, 1], [5, 6, 7]], singles: [3] });
  });
  it('只有 1 點 → 單點標記', () => {
    expect(segments([7])).toEqual({ runs: [], singles: [0] });
  });
  it('全部缺值、空陣列、NaN', () => {
    expect(segments([null, undefined, NaN])).toEqual({ runs: [], singles: [] });
    expect(segments([])).toEqual({ runs: [], singles: [] });
    expect(countValid([null, 1, NaN, 2])).toBe(2);
  });
  it('頭尾孤立點', () => {
    expect(segments([1, null, 2, 3, null, 9])).toEqual({ runs: [[2, 3]], singles: [0, 5] });
  });
});

describe('圖表資料邊界：coverage', () => {
  it('所選 26 週、只有 1 週 → 說明目前週數與起始日', () => {
    const c = coverage(['2026-09-18'], 26);
    expect(c).toMatchObject({ have: 1, want: 26, short: true, single: true });
    expect(coverageNote(c, '週')).toBe('資料累積中：目前只有 1 週（自 2026/9/18 起），所選期間超過可用資料；歷史回補中');
  });
  it('資料足夠 → null；沒有資料 → 說明還沒有資料', () => {
    expect(coverageNote(coverage(Array.from({ length: 26 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`), 26), '週')).toBeNull();
    expect(coverageNote(coverage([], 13), '週', false)).toBe('資料累積中：目前還沒有資料');
  });
});

describe('走勢圖只有 1 個交易日', () => {
  it('sliceWindow 回傳單點視窗並標示 truncated（舊版回傳 null，圖表只剩空白）', () => {
    const w = sliceWindow(['2026-09-24'], [100], '1Y')!;
    expect(w).toEqual({ dates: ['2026-09-24'], values: [100], truncated: true });
    expect(periodStart(['2026-09-24'], '1M')).toEqual({ start: 0, truncated: true });
  });
  it('單點放在水平中央', () => {
    const [p] = points([100], { w: 200, h: 100, padX: 10, padY: 10 }, extent([100]));
    expect(p[0]).toBe(100);
    expect(p[1]).toBe(50);
  });
  it('全部缺值 → null（顯示資料累積中）', () => {
    expect(sliceWindow(['2026-09-24'], [null], '1Y')).toBeNull();
  });
  it('只有 1 個值的座標軸仍有範圍（不會除以 0）', () => {
    const s = niceScale([52.3], 'lines');
    expect(s.hi).toBeGreaterThan(s.lo);
    expect(niceScale([], 'bars')).toEqual({ lo: 0, hi: 1, ticks: [1, 0] });
  });
});

describe('大戶與散戶：只有 1 週資料', () => {
  const one: HolderBlock = {
    d: ['2026-09-18'],
    n: Array.from({ length: 15 }, (_, i) => [100 * (15 - i)]),
    p: Array.from({ length: 15 }, (_, i) => [i === 14 ? 60 : 40 / 14]),
    ts: [1_000_000_000],
    th: [12000],
  };
  it('走勢只有 1 點、週變化為 null；標題不寫期間變化', () => {
    const s = groupSeries(one, 26, 5, 400, 'pct');
    expect(s.dates).toEqual(['2026-09-18']);
    expect(s.bigChange).toEqual([null]);
    expect(shortTitle(one, 26, 5, 1000)).toBe('大戶持股 60.0%');
    expect(headline(one, 26, 5, 1000)).toBe('大戶（≥ 1,000 張）持股 60.00%');
  });
});

describe('#9 主角走勢圖的「資料累積中」', () => {
  // 0050：2024-04-11 起共 595 個交易日（週一到週五）
  const days: string[] = [];
  for (let t = Date.UTC(2024, 3, 11); days.length < 595; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
  }
  const closes = days.map((_, i) => 100 + i * 0.1);
  const af = days.map(() => 1);
  it('5Y、10Y、ALL（週線取樣）都寫同一個交易日數，日期帶年份', () => {
    const notes = (['5Y', '10Y'] as const).map((p) => windowCoverageNote(heroWindows(days, closes, af, p).adj!));
    for (const n of notes) expect(n).toBe('資料累積中：目前只有 595 個交易日（自 2024/4/11 起），所選期間超過可用資料');
    // 10Y 的視窗本身只有約 128 個週線點
    expect(heroWindows(days, closes, af, '10Y').adj!.dates.length).toBeLessThan(140);
  });
  it('資料足夠（不截斷）→ null', () => {
    expect(windowCoverageNote(heroWindows(days, closes, af, '1Y').adj!)).toBeNull();
  });
});
