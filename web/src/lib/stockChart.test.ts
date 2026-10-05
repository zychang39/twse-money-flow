import { describe, expect, it } from 'vitest';
import { MAX_K_BARS, intradayReason, kSeries, seriesWindow } from './stockChart';

/** n 個連續交易日（跳過週末），收盤從 100 線性上升。 */
function hist(n: number, from = '2024-01-01') {
  const d: string[] = [];
  const t = new Date(`${from}T12:00:00Z`);
  while (d.length < n) {
    const wd = t.getUTCDay();
    if (wd !== 0 && wd !== 6) d.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  const c = d.map((_, i) => 100 + i);
  return { d, o: c.map((v) => v - 0.5), h: c.map((v) => v + 1), l: c.map((v) => v - 1), c, v: c.map(() => 1000), af: c.map(() => 1) };
}

describe('kSeries（D2：1M/3M 日 K、YTD/1Y 週 K、5Y/ALL 月 K）', () => {
  const h = hist(700, '2023-11-01');
  it('3M 是日 K', () => {
    const s = kSeries(h, '3M', 'adj')!;
    expect(s.kind).toBe('daily');
    expect(s.bars.length).toBeLessThanOrEqual(70);
  });
  it('1Y 是週 K，高低是週內極值、量是合計', () => {
    const s = kSeries(h, '1Y', 'adj')!;
    expect(s.kind).toBe('weekly');
    expect(s.bars.length).toBeGreaterThan(50);
    expect(s.bars.length).toBeLessThan(55);
    const b = s.bars[5];
    expect(b.h! - b.l!).toBeGreaterThan(2);
    expect(b.v).toBeGreaterThan(1000);
  });
  it('5Y 是月 K；早於個股檔的月份用長歷史收盤合成並標出', () => {
    const long = { code: 'x', d: ['2021-01-04', '2021-06-01', '2022-01-03', '2023-06-01'], c: [50, 60, 70, 80], af: [1, 1, 1, 1] };
    const s = kSeries(h, '5Y', 'adj', long)!;
    expect(s.kind).toBe('monthly');
    expect(s.bars.length).toBeLessThanOrEqual(MAX_K_BARS);
    expect(s.synthUntil).toBe('2023-06-01');
    const m = s.bars.find((b) => b.t.startsWith('2024-03'))!;
    expect(m.o).toBeLessThan(m.c);
  });
  it('超過 MAX_K_BARS 個月改季 K', () => {
    const long = { code: 'x', d: Array.from({ length: 120 }, (_, i) => `${2014 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-10`), c: Array.from({ length: 120 }, (_, i) => 10 + i), af: Array.from({ length: 120 }, () => 1) };
    const s = kSeries(h, 'ALL', 'adj', long)!;
    expect(s.kind).toBe('quarterly');
    expect(s.bars.length).toBeLessThanOrEqual(MAX_K_BARS);
  });
});

describe('seriesWindow（折線用的 Window）', () => {
  it('日資料：起點＝區間第一根；daily 帶完整日資料給當日漲跌', () => {
    const h = hist(300);
    const w = seriesWindow(kSeries(h, '3M', 'adj')!, h, 'adj')!;
    expect(w.values[0]).toBe(100 + h.d.indexOf(w.dates[0]));
    expect(w.daily?.values.at(-1)).toBe(399);
    expect(w.base).toBeUndefined();
  });
});

describe('intradayReason（1D／1W 沒有分 K 的原因）', () => {
  const idx = { date: '2026-10-02', source: 'x', codes: ['2330'], no_trade: ['1234'], missing: ['5678'], failed: ['4321'], not_fetched: ['2317'] };
  it('各種原因（未抓取、抓取失敗、來源無資料分開）', () => {
    expect(intradayReason('1234', idx, false)).toBe('10/2 沒有成交，沒有分鐘走勢');
    expect(intradayReason('5678', idx, false)).toBe('10/2 分鐘資料來源未提供這一檔');
    expect(intradayReason('4321', idx, false)).toBe('10/2 分鐘資料抓取失敗，下一次更新會重試');
    expect(intradayReason('2317', idx, false)).toBe('10/2 分鐘資料尚未抓取（收盤後依序更新全部個股）');
    // 舊版 index.json（沒有 not_fetched）：missing 不能斷定是來源沒有
    expect(intradayReason('5678', { date: '2026-10-02', source: 'x', codes: [], missing: ['5678'] }, false)).toBe('10/2 分鐘資料尚未取得');
    expect(intradayReason('9999', idx, false)).toBe('這一檔尚未涵蓋分鐘資料');
    expect(intradayReason('2330', null, false)).toBe('分鐘資料累積中');
    expect(intradayReason('2330', idx, true)).toBe('分鐘資料讀取失敗');
  });
});
