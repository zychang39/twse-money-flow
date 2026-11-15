import { describe, expect, it } from 'vitest';
import { MAX_K_BARS, STOCK_CHART_PERIODS, dailySeries, intradayReason, kSeries, seriesWindow } from './stockChart';

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

describe('kSeries（D2：1M/3M 日 K、6M/YTD/1Y 週 K、2Y/5Y/10Y/ALL 月 K）', () => {
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
  it('個股頁的期間與 iOS 股市 App 相同（11 個）', () => {
    expect(STOCK_CHART_PERIODS).toEqual(['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'ALL']);
  });
  it('6M 是週 K（日 K 約 125 根，超過一張圖放得下的 80 根）；2Y 是月 K', () => {
    const six = kSeries(h, '6M', 'adj')!;
    expect(six.kind).toBe('weekly');
    expect(six.bars.length).toBeGreaterThan(24);
    expect(six.bars.length).toBeLessThan(29);
    const two = kSeries(h, '2Y', 'adj')!;
    expect(two.kind).toBe('monthly');
    expect(two.bars.length).toBeGreaterThanOrEqual(24);
    expect(two.bars.length).toBeLessThanOrEqual(26);
    expect(two.truncated).toBe(false);
  });
  it('折線：6M 是日資料、2Y 是週線（都只用個股檔，不用長歷史）；10Y 用長歷史並週線取樣', () => {
    const six = dailySeries(h, '6M', 'adj')!;
    expect(six.kind).toBe('daily');
    expect(six.bars.length).toBeGreaterThan(120);
    expect(six.bars.length).toBeLessThan(135);
    // 2Y 約 520 個交易日，超過 MAX_DAILY_BARS（300）→ 合成週線（與既有規則相同）
    const two = dailySeries(h, '2Y', 'adj')!;
    expect(two.kind).toBe('weekly');
    expect(two.bars.length).toBeGreaterThan(100);
    expect(two.bars.length).toBeLessThan(108);
    expect(two.truncated).toBe(false);
    const long = { code: 'x', d: Array.from({ length: 2600 }, (_, i) => new Date(Date.UTC(2016, 0, 4) + i * 1.4 * 864e5).toISOString().slice(0, 10)).filter((d, i, a) => a.indexOf(d) === i), c: [] as number[], af: [] as number[] };
    long.c = long.d.map((_, i) => 10 + i / 10); long.af = long.d.map(() => 1);
    const ten = dailySeries(h, '10Y', 'adj', long)!;
    expect(ten.kind).toBe('close');
    expect(ten.bars.length).toBeLessThan(560); // 週線取樣：約 10 年 × 52 週
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
