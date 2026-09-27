import { describe, expect, it } from 'vitest';
import type { StockRow } from '../data/types';
import type { Activity, Trade } from '../db/db';
import { envInfo, tonightMood, type Light } from './envState';
import { diffRow, makeSnapshot, sinceLabel } from './changes';
import { holdingAlerts } from './holdings';
import { badgeMetrics, badges, levelFor, ritualRings, stopRespected, streaks, totalXp } from './ritual';
import { impulseFacts } from './impulse';
import { holdingsSeries } from './portfolioSeries';
import { holdConclusion, mineConclusion, tonightConclusion } from './conclusion';
import { uiConfig } from './config';

const L = (id: string, state: Light['state']): Light => ({ id, label: id, state, value: '', basis: '' });
const row = (o: Partial<StockRow>): StockRow => ({
  code: '2330', name: '台積電', market: 'twse', industry: '半導體業', close: 100, change: 1, change_pct: 1, volume_lots: 10000, value_million: 1000,
  foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0, foreign_streak: 0, trust_streak: 0, foreign_net_5d: 0, trust_net_5d: 0,
  margin_balance: 1000, margin_change: 0, short_balance: 0, pe: 10, pb: 1, dividend_yield: 3, flags: [], composite: 50, ...o,
});
const trade = (o: Partial<Trade>): Trade => ({
  id: 't', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-01', entry: 100, shares: 1000, stop: 90, target: 130, reasonType: '籌碼',
  checklist: { market: '中性', trend: '', revenue: '', valuation: '', reason: '理由' }, ...o,
});
const act = (type: Activity['type'], day: string, at = `${day}T13:00:00Z`, meta?: Activity['meta']): Activity => ({ id: `${type}-${day}-${at}`, type, day, at, meta });

describe('資金環境燈號', () => {
  it('任一風險 → 保守（琥珀）；≥ 3 項有利且無風險 → 積極；其餘中性；無資料', () => {
    expect(envInfo([L('a', 'red'), L('b', 'green')]).state).toBe('conservative');
    expect(tonightMood('conservative')).toBe('risk');
    expect(envInfo([L('a', 'green'), L('b', 'green'), L('c', 'green')]).state).toBe('aggressive');
    expect(envInfo([L('a', 'yellow'), L('b', 'green')]).state).toBe('neutral');
    expect(tonightMood('neutral')).toBe('neutral');
    expect(envInfo([L('a', 'gray')]).state).toBe('unknown');
    expect(envInfo([L('a', 'red'), L('b', 'yellow'), L('c', 'gray')]).counts).toBe('1 項風險・1 項中性・1 項累積中');
  });
});

describe('變化優先', () => {
  it('低於門檻不算顯著；超過門檻列出原因', () => {
    const snap = makeSnapshot([row({})], '2026-09-23');
    expect(diffRow(row({ close: 101 }), snap.rows['2330']).significant).toBe(false);
    const c = diffRow(row({ close: 106, composite: 60 }), snap.rows['2330']);
    expect(c.significant).toBe(true);
    expect(c.reasons.map((r) => r.kind)).toEqual(expect.arrayContaining(['price', 'composite']));
  });
  it('新風險旗標一律顯著；沒有快照時用前一交易日', () => {
    const flagged = row({ flags: [{ id: 'attention', label: '注意股', level: 'warn' }], new_flags: ['attention'] });
    expect(diffRow(flagged, undefined).newFlags).toHaveLength(1);
    expect(diffRow(row({ change_pct: 4 }), undefined).reasons[0].text).toContain('今日漲 4.0%');
    expect(sinceLabel(null)).toBe('較前一交易日');
  });
  it('連買天數「新達到」門檻才算', () => {
    const n = uiConfig.significance.inst_streak_days;
    const prev = makeSnapshot([row({ trust_streak: n - 1 })], 'd').rows['2330'];
    expect(diffRow(row({ trust_streak: n }), prev).reasons.some((r) => r.kind === 'streak')).toBe(true);
    const prev2 = makeSnapshot([row({ trust_streak: n })], 'd').rows['2330'];
    expect(diffRow(row({ trust_streak: n + 1 }), prev2).reasons.some((r) => r.kind === 'streak')).toBe(false);
  });
});

describe('持股警示', () => {
  it('觸及停損、接近停損、新風險旗標', () => {
    const by = new Map([
      ['A', row({ code: 'A', close: 89 })],
      ['B', row({ code: 'B', close: 92 })],
      ['C', row({ code: 'C', close: 120, flags: [{ id: 'x', label: '處置股', level: 'danger' }], new_flags: ['x'] })],
      ['D', row({ code: 'D', close: 120 })],
    ]);
    const out = holdingAlerts(['A', 'B', 'C', 'D'].map((c) => trade({ id: c, code: c })), by);
    const byCode = Object.fromEntries(out.map((a) => [a.trade.code, a]));
    expect(byCode.A.items[0].label).toContain('觸及停損');
    expect(byCode.B.items[0].label).toContain('接近停損');
    expect(byCode.C.items[0].label).toContain('新風險旗標');
    expect(byCode.D.risk).toBe(false);
    expect(out[0].trade.code).toBe('A');
  });
});

describe('紀律（遊戲化只獎勵紀律）', () => {
  const day = '2026-09-24';
  it('三環：簡報、檢查表（沒有新持倉視為完成）、檢討', () => {
    const closed = trade({ id: 'c', status: 'closed', closedAt: '2026-09-20', exit: 95 });
    let r = ritualRings(day, [], [closed], '2026-09-24');
    expect(r.rings.map((x) => x.done)).toEqual([false, true, false]);
    expect(r.rings[2].action?.href).toContain('review=c');
    r = ritualRings(day, [act('brief_read', day)], [{ ...closed, review: '依計畫出場' }], '2026-09-24');
    expect(r.complete).toBe(true);
  });
  it('連續天數只看交易日（休市日不中斷）；今天未完成時算到上一交易日', () => {
    const tradingDays = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    const acts = ['2026-09-21', '2026-09-22', '2026-09-23'].map((d) => act('ritual_done', d));
    expect(streaks(tradingDays, acts)).toEqual({ current: 3, best: 3 });
    expect(streaks(tradingDays, [...acts, act('ritual_done', '2026-09-24')]).current).toBe(4);
    expect(streaks(tradingDays, [act('ritual_done', '2026-09-21')]).current).toBe(0);
  });
  it('經驗值有每日上限；等級門檻遞增', () => {
    const acts = [act('brief_read', day), act('brief_read', day, `${day}T14:00:00Z`), ...[1, 2, 3, 4].map((i) => act('review_done', day, `${day}T1${i}:00:00Z`))];
    expect(totalXp(acts)).toBe(10 + 3 * 30);
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(299).level).toBe(2);
    expect(levelFor(300).level).toBe(3);
  });
  it('徽章不看損益與交易次數：守住停損、檢討、檢查表（含決定不進場）', () => {
    const respected = trade({ id: 'r', status: 'closed', exit: 90, stop: 90 });
    const ignored = trade({ id: 'i', status: 'closed', exit: 70, stop: 90 });
    expect(stopRespected(respected)).toBe(true);
    expect(stopRespected(ignored)).toBe(false);
    expect(stopRespected({ ...respected, exit: 120 })).toBe(false);
    const m = badgeMetrics([act('checklist_done', day, undefined, { outcome: 'skip' })], [respected], 0, true);
    expect(m.checklists).toBe(2);
    expect(m.backups).toBe(1);
    const bs = badges(m);
    expect(bs.find((b) => b.id === 'first_backup')?.earned).toBe(true);
    expect(bs.every((b) => !['trades', 'profit', 'orders'].includes(b.metric))).toBe(true);
  });
});

describe('衝動攔截', () => {
  it('資金環境保守、高於 20 日均線過多、短期漲幅過大時列出事實', () => {
    const env = envInfo([L('ma240', 'red')]);
    const facts = impulseFacts(row({ ma20_gap: 14.8, price_change_5d: 17.4 }), env);
    expect(facts).toHaveLength(3);
    expect(impulseFacts(row({ ma20_gap: 2 }), envInfo([L('a', 'yellow')]))).toEqual([]);
  });
});

describe('持股組合走勢與結論句', () => {
  it('以現有股數 × 還原價計算，最新一日等於市值', () => {
    const h = { code: '2330', d: ['a', 'b'], c: [100, 50], af: [0.5, 1] } as never;
    const s = holdingsSeries([trade({ shares: 10 })], [h])!;
    expect(s.values).toEqual([500, 500]);
  });
  it('結論句不含交易建議字眼', () => {
    const text = tonightConclusion({ holdings: 3, alerts: 2, env: 'conservative', watchChanges: 1 });
    expect(text).toBe('持股\u00a02\u00a0檔需要注意，資金環境偏保守。');
    expect(text).not.toMatch(/買進|賣出/);
  });
  it('我的股票結論以自選為主，有持股時再加上持股狀況', () => {
    expect(mineConclusion({ watchCount: 8, watchChanges: 2, holdings: 0, alerts: 0 })).toBe('自選\u00a08\u00a0檔，其中\u00a02\u00a0檔有顯著變化。');
    expect(mineConclusion({ watchCount: 8, watchChanges: 2, holdings: 3, alerts: 1 })).toBe('自選\u00a02\u00a0檔有顯著變化，持股\u00a01\u00a0檔需要注意。');
    expect(mineConclusion({ watchCount: 0, watchChanges: 0, holdings: 0, alerts: 0 })).toBe('還沒有自選股。');
    expect(holdConclusion({ holdings: 2, alerts: 0, dir: 'up', periodName: '近 3 個月' })).toBe('持股近 3 個月上漲，沒有需要注意的。');
  });
  it('結論句每個子句不超過 12 個全形字寬（手機寬度最多兩行）', () => {
    const width = (s: string) => [...s].reduce((w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0);
    const all = [
      tonightConclusion({ holdings: 3, alerts: 12, env: 'conservative', watchChanges: 1 }),
      tonightConclusion({ holdings: 0, alerts: 0, env: 'unknown', watchChanges: 12 }),
      mineConclusion({ watchCount: 88, watchChanges: 12, holdings: 0, alerts: 0 }),
      mineConclusion({ watchCount: 88, watchChanges: 12, holdings: 3, alerts: 12 }),
    ];
    for (const s of all) {
      const clauses = s.split(/(?<=[，。])/);
      expect(clauses.length).toBeLessThanOrEqual(2);
      for (const c of clauses) expect(width(c)).toBeLessThanOrEqual(12.5);
    }
  });
});
