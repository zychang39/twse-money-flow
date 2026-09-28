import { describe, expect, it } from 'vitest';
import type { StockHistory, StockRow } from '../data/types';
import type { Trade } from '../db/db';
import { adjustTrade, eventsFor, factorBetween, unrealizedPnl, type AdjEvent } from './corpActions';
import { holdingAlerts } from './holdings';
import { equityCurve, onOrAfter } from './portfolio';
import { tradePnl, rMultiple } from './sizing';
import { diffRow } from './changes';
import { holdingsSeries } from './portfolioSeries';

// data 分支的真實事件（docs/BACKLOG.md D-01）：0050 於 2025-06-18 分割（1 拆 4，因子 0.25）；00631L 於 2026-03-31 分割（因子 0.045）
const EV_0050: AdjEvent[] = [['2025-01-17', 0.99, 'dividend'], ['2025-06-18', 0.25, 'split'], ['2025-07-17', 0.99, 'dividend']];
const EV_00631L: AdjEvent[] = [['2026-03-31', 0.045, 'split']];

const CHECK = { market: '', trend: '', revenue: '', valuation: '', reason: '' };
function trade(p: Partial<Trade>): Trade {
  return { id: 't', code: '0050', name: '元大台灣50', status: 'open', openedAt: '2025-05-02', entry: 190, shares: 1000, stop: 180, target: 220, reasonType: '', checklist: CHECK, ...p };
}
function row(p: Partial<StockRow>): StockRow {
  return { code: '0050', name: '元大台灣50', market: 'twse', industry: null, close: 50, change: 0, change_pct: 0, volume_lots: 1, value_million: 1, foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0, foreign_streak: 0, trust_streak: 0, foreign_net_5d: 0, trust_net_5d: 0, margin_balance: 0, margin_change: 0, short_balance: 0, pe: null, pb: null, dividend_yield: null, flags: [], ...p };
}

describe('D-01 分割後的持倉換算', () => {
  it('0050（2025-06-18 分割 1 拆 4）：換算進場價、停損、股數；損益與未分割時相同，不會假觸及停損', () => {
    const t = trade({});
    const a = adjustTrade(t, EV_0050, '2025-06-30');
    expect(a.factor).toBeCloseTo(0.25);
    expect(a.entry).toBeCloseTo(47.5);
    expect(a.stop).toBeCloseTo(45);
    expect(a.target).toBeCloseTo(55);
    expect(a.shares).toBe(4000);
    expect(a.notes).toEqual(['已依 2025/6/18 分割調整']);
    // 分割後收盤 50：以原始價比較會是 −73.7% 並觸及停損 180；換算後是 +10,000 元（等同 200 − 190 的價差）
    expect(unrealizedPnl(t, 50, EV_0050.slice(0, 2))).toBeCloseTo(10000);
    const alerts = holdingAlerts([t], new Map([['0050', row({ close: 50, adj_ev: EV_0050.slice(0, 2) })]]));
    expect(alerts[0].items.map((i) => i.label).join()).not.toContain('停損');
  });

  it('分割後真的跌破換算後的停損仍會提醒，並說明原停損', () => {
    const t = trade({});
    const alerts = holdingAlerts([t], new Map([['0050', row({ close: 44, adj_ev: EV_0050.slice(0, 2) })]]));
    expect(alerts[0].items[0].label).toBe('觸及停損 45.00');
    expect(alerts[0].items[0].detail).toContain('已依 2025/6/18 分割調整，原停損 180.0');
  });

  it('00631L（2026-03-31 分割，因子 0.045）：股數換算為 22,222 股', () => {
    const t = trade({ code: '00631L', openedAt: '2026-01-05', entry: 300, stop: 270, target: 360, shares: 1000 });
    const a = adjustTrade(t, EV_00631L);
    expect(a.shares).toBe(22222);
    expect(a.entry).toBeCloseTo(13.5);
    expect(a.stop).toBeCloseTo(12.15);
    expect(unrealizedPnl(t, 14, EV_00631L)).toBeCloseTo((14 - 13.5) * (1000 / 0.045));
    // 分割日之後才建倉：不換算
    expect(adjustTrade({ ...t, openedAt: '2026-03-31' }, EV_00631L).factor).toBe(1);
  });

  it('只有除息：損益含股利（視同再投入），但不標示分割', () => {
    const t = trade({ openedAt: '2025-07-01', entry: 50, stop: 48, target: 60, shares: 1000 });
    const a = adjustTrade(t, EV_0050);
    expect(a.factor).toBeCloseTo(0.99);
    expect(a.notes).toEqual([]);
    expect(a.stop).toBeCloseTo(47.52);
  });

  it('平倉：adjFactor 讓已實現損益與 R 倍數用同一基準；使用者原始輸入不變', () => {
    const t = trade({ status: 'closed', closedAt: '2025-07-01', exit: 52, adjFactor: 0.25, fees: 0 });
    expect(t.entry).toBe(190);
    expect(tradePnl(t)).toBeCloseTo((52 - 47.5) * 4000);
    expect(rMultiple(t)).toBeCloseTo((52 - 47.5) / (10 * 0.25));
    expect(tradePnl({ ...t, adjFactor: undefined, exit: 200 })).toBe(10000); // 沒有公司行動時與原公式相同
  });

  it('eventsFor：個股檔優先，否則用 summary 的近期事件', () => {
    const h = { adj_events: EV_0050 } as unknown as StockHistory;
    expect(eventsFor(row({ adj_ev: [] }), h)).toBe(EV_0050);
    expect(eventsFor(row({ adj_ev: EV_00631L }), null)).toBe(EV_00631L);
    expect(eventsFor(undefined, null)).toEqual([]);
    expect(factorBetween(EV_0050, '2025-06-18')).toBeCloseTo(0.99);
  });

  it('快照比較：分割前看過（200），分割後 50.5 → 自上次 +1%，不是 −75%', () => {
    const c = diffRow(row({ close: 50.5, adj_ev: EV_0050.slice(0, 2) }), { c: 200, s: null, f: [], fs: 0, ts: 0, mb: 0 }, undefined, '2025-06-10');
    expect(c.reasons.find((r) => r.kind === 'price')?.text ?? '').not.toContain('跌');
  });

  it('持股組合走勢：分割後最新一日等於實際市值（股數 ×4 × 收盤）', () => {
    const h = { code: '0050', d: ['2025-06-17', '2025-06-18'], c: [200, 50], af: [0.25, 1], adj_events: [['2025-06-18', 0.25, 'split']] } as unknown as StockHistory;
    const s = holdingsSeries([trade({})], [h])!;
    expect(s.values[s.values.length - 1]).toBeCloseTo(4000 * 50);
    expect(s.values[0]).toBeCloseTo(s.values[1]); // 還原價：分割不造成斷層
  });

  it('權益曲線：分割日股數 ×4、市值不變', () => {
    const cal = ['2025-06-16', '2025-06-17', '2025-06-18', '2025-06-19'];
    const eq = equityCurve(1_000_000, [trade({ openedAt: '2025-06-16', entry: 200 })], { '0050': { dates: cal, close: [200, 200, 50, 50] } }, {}, cal, { '0050': [['2025-06-18', 0.25, 'split']] });
    expect(eq.map((p) => p.equity)).toEqual([1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  });
});

describe('E-03 休市日或週末建倉、平倉', () => {
  const cal = ['2026-09-23', '2026-09-24', '2026-09-29', '2026-09-30'];
  it('onOrAfter 對齊到該日（含）之後的第一個交易日', () => {
    expect(onOrAfter('2026-09-28', cal)).toBe('2026-09-29');
    expect(onOrAfter('2026-09-24', cal)).toBe('2026-09-24');
    expect(onOrAfter('2026-10-01', cal)).toBeNull();
  });
  it('9/28（教師節）建倉、週六平倉都會計入權益曲線', () => {
    const prices = { '2330': { dates: cal, close: [1000, 1000, 1010, 1020] } };
    const opened = equityCurve(1_000_000, [trade({ code: '2330', openedAt: '2026-09-28', entry: 1000, shares: 100 })], prices, {}, cal);
    expect(opened.map((p) => p.equity)).toEqual([1_000_000, 1_000_000, 1_001_000, 1_002_000]);
    const cal2 = ['2026-09-24', '2026-09-29', '2026-10-05'];
    const closed = equityCurve(1_000_000, [trade({ code: '2330', openedAt: '2026-09-24', entry: 1000, shares: 100, status: 'closed', closedAt: '2026-10-03', exit: 1100, fees: 0 })],
      { '2330': { dates: cal2, close: [1000, 1050, 1100] } }, {}, cal2);
    expect(closed[closed.length - 1]).toEqual({ date: '2026-10-05', equity: 1_010_000, cash: 1_010_000, holdings: 0 });
  });
});
