import { describe, expect, it } from 'vitest';
import type { StockHistory, StockRow } from '../data/types';
import { makeCalendar } from './tradingCalendar';
import {
  creditFacts, foreignHolding, holderFacts, inst20PctVolume, instDetail, instTable, industryRankText, positionFacts, returnRows,
  revenueDeadline, revenueSummary, rsFacts, summaryGrid, trendFacts, upcomingEvents, valuationFacts, volatilityFacts, volumeFacts, watchLine, watchLineText,
} from './stockFacts';
import type { ChipBlock } from './chips';

const days = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
  return d.toISOString().slice(0, 10);
});

/** 300 日：收盤 100 → 399（每日 +1），高低 ±1；最後 20 日量 2,000 張、之前 1,000 張、最後一天 3,000 張 */
function hist(extra: Partial<StockHistory> = {}): StockHistory {
  const n = 300;
  const d = days(n);
  const c = d.map((_, i) => 100 + i);
  return {
    code: '9999', name: '測試', market: 'twse', industry: '半導體業', shares: 1_000_000_000,
    d, o: c, h: c.map((v) => v + 1), l: c.map((v) => v - 1), c, v: c.map((_, i) => (i === n - 1 ? 3000 : i >= n - 21 ? 2000 : 1000)),
    val: c.map(() => null), af: c.map(() => 1),
    fn: c.map(() => 100), tn: c.map(() => 10), dn: c.map(() => -5),
    mb: c.map((_, i) => 1000 + i), sb: c.map(() => 50), pe: c.map(() => 15), pb: c.map(() => 2), dy: c.map(() => 3),
    metrics: {},
    ...extra,
  } as StockHistory;
}

describe('stockFacts：位置、趨勢、波動、量比', () => {
  it('位置：一路上漲 → 距 52 週高 0%、創 60 日收盤新高', () => {
    const p = positionFacts(hist());
    expect(p.dist52).toBeCloseTo(0, 9);
    expect(p.dist60).toBeCloseTo(0, 9);
    expect(p.newHigh60).toBe(true);
    expect(p.high60?.value).toBe(399);
  });
  it('位置：最後一天回落 → 不是新高；距 60 日高 = 389 ÷ 398 − 1', () => {
    const h = hist();
    h.c = [...h.c.slice(0, -1), 389];
    const p = positionFacts(h);
    expect(p.newHigh60).toBe(false);
    expect(p.dist60).toBeCloseTo((389 / 398 - 1) * 100, 9);
  });
  it('趨勢：20 日均線＝最後 20 日平均、乖離、多頭排列', () => {
    const t = trendFacts(hist());
    expect(t.ma[0]).toMatchObject({ n: 20, value: 389.5 });
    expect(t.ma[0].gap).toBeCloseTo((399 / 389.5 - 1) * 100, 9);
    expect(t.alignment).toBe('bull');
    expect(t.alignName).toBe('多頭排列');
  });
  it('波動：TR＝max(高−低 2, |高−前收| 2) → ATR 2；20 日乖離 ATR 倍數＝(399 − 389.5) ÷ 2', () => {
    const v = volatilityFacts(hist());
    expect(v.atr).toBeCloseTo(2, 9);
    expect(v.atrPct).toBeCloseTo((2 / 399) * 100, 9);
    expect(v.biasAtr).toBeCloseTo(4.75, 9);
    expect(v.price).toBe(399);
  });
  it('波動：還原因子不改變原始價基準的 ATR（除息前價格 × 0.5，最新因子 1）', () => {
    const h = hist();
    const af = h.c.map((_, i) => (i < 290 ? 0.5 : 1));
    const dbl = (a: (number | null)[]) => a.map((v, i) => (v !== null && i < 290 ? v * 2 : v));
    const raw = hist({ af, c: dbl(h.c), h: dbl(h.h), l: dbl(h.l) });
    expect(volatilityFacts(raw).atr).toBeCloseTo(2, 6);
  });
  it('量比：pipeline 的 vol_ratio 優先；沒有時用 v 序列（前 20 日、不含當日）', () => {
    expect(volumeFacts(hist({ metrics: { vol_ratio: 1.5, vol20_lots: 2000, volume_lots: 3000 } })).ratio).toBe(1.5);
    const f = volumeFacts(hist());
    expect(f.avg20Lots).toBe(2000);
    expect(f.ratio).toBe(1.5);
  });
});

describe('stockFacts：pipeline mom 區塊', () => {
  const mom = {
    date: '2025-10-27', ret: { '1M': 5.5, '3M': 10, '6M': 20, '12M': 40 }, pct: { '1M': 80, '3M': 70, '6M': 60, '12M': 50 }, n: { '1M': 1900, '3M': 1900, '6M': 1900, '12M': 1900 },
    rs: 88.2, rs_prev: 70.1, rs_prev_date: '2025-09-26', industry: { name: '半導體業', median: -7.85, members: 206, rank: 33, of: 35, window: '3M' },
  };
  it('報酬表、RS 現值與 20 日前、產業名次', () => {
    const h = hist({ mom });
    expect(returnRows(h).map((r) => [r.key, r.days, r.ret, r.pct])).toEqual([['1M', 21, 5.5, 80], ['3M', 63, 10, 70], ['6M', 126, 20, 60], ['12M', 252, 40, 50]]);
    expect(rsFacts(h)).toEqual({ now: 88.2, prev: 70.1, prevDate: '2025-09-26' });
    expect(industryRankText(h)).toBe('33/35');
  });
  it('舊版個股檔沒有 mom：報酬為 null，RS 用 series', () => {
    const s = Array.from({ length: 300 }, (_, i) => i / 3);
    const h = hist({ series: { rs_percentile: s } });
    expect(returnRows(h)[0].ret).toBeNull();
    expect(rsFacts(h).now).toBeCloseTo(299 / 3, 9);
    expect(rsFacts(h).prev).toBeCloseTo(279 / 3, 9);
    expect(industryRankText(h)).toBeNull();
  });
});

/** chip：61 日（含種子），每日成交 1,000,000 股；外陸資 +100,000、外資自營商 +10,000、投信 −20,000、自營商自行 +5,000／避險 −15,000 */
function chip(): ChipBlock {
  const n = 61;
  const z = (v: number) => Array.from({ length: n }, () => v);
  return {
    d: days(n), c: z(100), chg: z(0), v: z(1_000_000), avg: z(100), af: z(1), mb: z(1000), sb: z(10),
    fn: z(100_000), ffd: z(10_000), tn: z(-20_000), dn: z(-10_000), dself: z(5_000), dhedge: z(-15_000), tot: z(80_000), sbls: z(0), dt: z(0),
  };
}

describe('stockFacts：法人', () => {
  it('期間 5／20／60：張數、佔成交量 %、連續日數；外資含外資自營商', () => {
    const t = instTable(chip(), 20)!;
    const by = Object.fromEntries(t.rows.map((r) => [r.party, r]));
    expect(by.foreign.lots).toBe(20 * 110);
    expect(by.foreign.pctVolume).toBeCloseTo(11, 9);
    expect(by.trust.lots).toBe(-400);
    expect(by.trust.streak).toBe(-60);
    expect(by.dealer.lots).toBe(-200);
    expect(by.total.lots).toBe(1600);
    expect(by.total.pctVolume).toBeCloseTo(8, 9);
    expect(inst20PctVolume(chip())).toBeCloseTo(8, 9);
    expect(instTable(chip(), 5)!.rows[0].lots).toBe(550);
  });
  it('明細：佔股本、估計成本（估）、現價比成本、自營商拆分', () => {
    const d = instDetail(hist(), chip(), 'foreign', 20)!;
    expect(d.pctCapital).toBeCloseTo((2_200_000 / 1e9) * 100, 9);
    expect(d.cost).toBeCloseTo(100, 9);
    expect(d.costRel).toBeCloseTo(0, 9);
    const dl = instDetail(hist(), chip(), 'dealer', 20)!;
    expect(dl.cost).toBeNull(); // 淨賣超不估成本
    expect(dl.split).toEqual({ self: 100, hedge: -300 });
  });
  it('近 20 日買超的 1 年百分位：最新值為過去最高 → 100', () => {
    const h = hist();
    h.fn = h.fn.map((_, i) => i);
    expect(instDetail(h, chip(), 'foreign', 20)!.pct1y).toBe(100);
  });
  it('外資持股比與 20 日變化（百分點）', () => {
    const q = Array.from({ length: 300 }, (_, i) => 50 + i * 0.01);
    const f = foreignHolding(hist({ qfii: q }));
    expect(f.pct).toBeCloseTo(52.99, 9);
    expect(f.change20).toBeCloseTo(0.2, 9);
  });
});

describe('stockFacts：股權分散、信用、基本面、事件', () => {
  it('四級比例與週變化、千張大戶連續週數', () => {
    // 3 週；分級 15（千張大戶）40 → 41 → 43；分級 1 依序遞減補足 100
    const p = Array.from({ length: 15 }, () => [0, 0, 0]);
    p[14] = [40, 41, 43];
    p[0] = [60, 59, 57];
    const n = Array.from({ length: 15 }, () => [1, 1, 1]);
    const f = holderFacts(hist({ holders: { d: ['2025-10-10', '2025-10-17', '2025-10-24'], n, p, ts: [1e9, 1e9, 1e9], th: [15, 15, 15] } }))!;
    expect(f.date).toBe('2025-10-24');
    expect(f.tiers.map((t) => t.tier)).toEqual(['retail', 'mid', 'big', 'whale']);
    const w = f.tiers.find((t) => t.tier === 'whale')!;
    expect(w.pct).toBe(43);
    expect(w.change).toBe(2);
    expect(f.whaleStreak).toBe(2);
  });
  it('信用：融資 5／20 日變化、券資比、借券賣出餘額、融券最後回補日', () => {
    const c = creditFacts(hist({ sbl: Array.from({ length: 300 }, () => 12), short_halt: { last_cover_date: '2025-11-03', end: null, reason: null }, metrics: { margin_usage: 3.2 } }));
    expect(c.marginBal).toBe(1299);
    expect(c.margin5.abs).toBe(5);
    expect(c.margin20.abs).toBe(20);
    expect(c.shortRatio).toBeCloseTo((50 / 1299) * 100, 9);
    expect(c.sblBal).toBe(12);
    expect(c.usage).toBe(3.2);
    expect(c.lastCoverDate).toBe('2025-11-03');
  });
  it('營收：12 個月年增率、近 3 月平均、創 12 個月新高、連續年增月數', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`, revenue: 100 + i, yoy: i >= 10 ? 5 + i : -1, mom: 1 }));
    const r = revenueSummary(hist({ revenue: rows }));
    expect(r.yoy12).toHaveLength(12);
    expect(r.newHigh).toBe(true);
    expect(r.growthMonths).toBe(4);
    expect(r.yoy3m).toBeCloseTo((16 + 17 + 18) / 3, 9);
  });
  it('估值：本益比 3 年百分位（series.pe_percentile 最後值）、淨值比、殖利率', () => {
    const v = valuationFacts(hist({ series: { pe_percentile: [10, 20, 30] } }));
    expect(v).toMatchObject({ pe: 15, pePct3y: 30, pb: 2, dy: 3 });
  });
  it('月營收公布期限：次月 10 日，遇休市日順延（2026-10-10 週六 → 10/12）', () => {
    const cal = makeCalendar({ closed: ['2026-10-09'] });
    expect(revenueDeadline('2026-08', '2026-10-03', cal)).toEqual({ ym: '2026-09', date: '2026-10-12', overdue: false });
    expect(revenueDeadline('2026-07', '2026-10-03', cal)).toMatchObject({ ym: '2026-08', date: '2026-09-10', overdue: true });
    expect(revenueDeadline(null, '2026-10-03', cal).ym).toBe('2026-09');
  });
  it('即將發生：月營收、除權息預告、法說會、融券回補，依日期排序', () => {
    const cal = makeCalendar({ closed: [] });
    const h = hist({
      revenue: [{ ym: '2026-08', revenue: 1, yoy: 1, mom: 1 }],
      events: [{ date: '2026-10-20', type: '預告', text: '預告除息，現金股利 5 元' }, { date: '2026-09-01', type: '預告', text: '舊' }],
      conferences: [{ date: '2026-10-15', time: '14:00', place: '台北', text: '說明', host: null }, { date: '2026-05-01', time: null, place: null, text: '舊', host: null }],
      short_halt: { last_cover_date: '2026-10-14', end: null, reason: null },
    });
    expect(upcomingEvents(h, '2026-10-03', cal).map((e) => [e.date, e.kind])).toEqual([
      ['2026-10-12', 'revenue'], ['2026-10-14', 'short_cover'], ['2026-10-15', 'conference'], ['2026-10-20', 'exright'],
    ]);
  });
  it('摘要格：六格數值', () => {
    const g = summaryGrid(hist({ chip: chip(), metrics: { vol_ratio: 1.32 }, mom: { ret: {}, pct: {}, n: {}, rs: 91, rs_prev: null, rs_prev_date: null, industry: null, date: null } }));
    expect(g.rs).toBe(91);
    expect(g.dist52).toBeCloseTo(0, 9);
    expect(g.biasAtr).toBeCloseTo(4.75, 9);
    expect(g.volRatio).toBe(1.32);
    expect(g.inst20Pct).toBeCloseTo(8, 9);
    expect(g.whaleWeek).toBeNull();
  });
});

describe('stockFacts：簡報頁自選股列', () => {
  it('外資+投信張數、佔 20 日均量 %、量比、RS', () => {
    const r = { foreign_net_lots: 5000, trust_net_lots: 887, vol20_lots: 10_000, vol_ratio: 1.32, rs_percentile: 87.4 } as unknown as StockRow;
    const w = watchLine(r);
    expect(w).toEqual({ instLots: 5887, instPctAvg20: 58.87, volRatio: 1.32, rs: 87.4 });
    expect(watchLineText(w)).toBe('外資+投信 +5,887 張（佔 20 日均量 59%）・量 1.32×');
  });
});

describe('stockFacts：狀態標籤（融券回補 ≤ 10 營業日、除權息 ≤ 5 營業日）', () => {
  it('依交易日曆計算距今營業日數', async () => {
    const { statusTags } = await import('./stockFacts');
    const cal = makeCalendar({ closed: ['2026-10-09'] });
    const h = hist({ events: [{ date: '2026-10-12', type: '預告', text: '預告除息' }], short_halt: { last_cover_date: '2026-10-19', end: null, reason: null } });
    // 10/3（六）→ 10/12：10/5、6、7、8、12 ＝ 5 個營業日（10/9 休市）；10/19：10 個營業日
    expect(statusTags(h, '2026-10-03', cal)).toEqual([
      { kind: 'short_cover', date: '2026-10-19', days: 10, text: '融券最後回補 10/19' },
      { kind: 'exright', date: '2026-10-12', days: 5, text: '除權息 10/12' },
    ]);
    expect(statusTags(h, '2026-09-25', cal)).toEqual([]);
  });
});
