import { describe, expect, it } from 'vitest';
import type { Activity, Trade } from '../db/db';
import { legacyXp, migrateV5 } from '../db/migrations';
import { flowBadges, LEGACY_BADGE_MAP, badges } from './achievements';
import { checklistComplete, parseChecklistQuery } from './checklist';
import { uiConfig } from './config';
import { compliantSplit, recentViolations, rSummary, weeklyFlow } from './flowStats';
import {
  dayRings, displayDay, flowLevel, flowStreak, flowXp, levelFor, levelThreshold, prepareTrade, ritualAnswer, tradeCompliance, xpLedger, xpTable, type FlowInput,
} from './ritual';
import { makeCalendar } from './tradingCalendar';

// 2026-10-09（五）設為休市日（國慶日補假）
const cal = makeCalendar({ closed: ['2026-10-09'] });
const LIMIT = 10_000; // 本金 100 萬 × 每筆風險 1%
const CK = { market: '中性', trend: '多頭（年線、季線之上）', revenue: '成長', valuation: '合理', reason: '投信連買' };

let seq = 0;
const act = (type: Activity['type'], day: string, at = `${day}T12:00:00Z`, meta?: Activity['meta']): Activity => ({ id: `${type}-${seq++}`, type, day, at, ...(meta ? { meta } : {}) });
/** 台北 20:00 讀完當日簡報 */
const brief = (day: string) => act('brief_read', day, `${day}T12:00:00Z`);
const trade = (o: Partial<Trade>): Trade => ({
  id: `t${seq++}`, code: '2330', name: '台積電', status: 'open', openedAt: '2026-10-02', entry: 100, shares: 1000, stop: 95, target: 120, reasonType: '籌碼',
  checklist: CK, ...o,
});
const input = (o: Partial<FlowInput>): FlowInput => ({ cal, activities: [], trades: [], riskLimit: LIMIT, now: '2026-10-03T04:00:00Z', ...o });

describe('三環（§8.2）', () => {
  it('無新持倉日：簡報已讀 → 「1/1」，進場與檢討不適用', () => {
    const r = dayRings('2026-10-02', input({ activities: [brief('2026-10-02')] }));
    expect(r.rings.map((x) => [x.id, x.status, x.text])).toEqual([['brief', 'done', '已完成'], ['entry', 'na', '不適用'], ['review', 'na', '不適用']]);
    expect(r.score).toBe('1/1');
    expect(r.complete).toBe(true);
    expect(dayRings('2026-10-02', input({})).score).toBe('0/1');
  });

  it('一筆無停損的持倉：進場環未完成，並記違規標籤「無停損」', () => {
    const t = trade({ stop: 0 });
    const inp = input({ activities: [brief('2026-10-02')], trades: [t] });
    const r = dayRings('2026-10-02', inp);
    expect(r.rings[1].status).toBe('todo');
    expect(r.score).toBe('1/2');
    expect(r.complete).toBe(false);
    expect(tradeCompliance(t, inp)).toEqual({ status: 'violation', tags: ['無停損'] });
    expect(recentViolations(inp).counts['無停損']).toBe(1);
    // 同一天另一筆符合條件：仍未完成（每一筆都要符合）
    const r2 = dayRings('2026-10-02', input({ activities: [brief('2026-10-02')], trades: [t, trade({})] }));
    expect(r2.rings[1].status).toBe('todo');
    expect(r2.rings[1].detail).toBe('1/2 筆符合');
    // 都符合 → 2/2
    expect(dayRings('2026-10-02', input({ activities: [brief('2026-10-02')], trades: [trade({})] })).score).toBe('2/2');
  });

  it('進場環：未完成檢查表、計畫風險超過上限都不算完成', () => {
    const noCk = trade({ checklist: { ...CK, valuation: '' } });
    const big = trade({ shares: 3000 }); // (100 − 95) × 3000 = 15,000 > 10,000
    expect(dayRings('2026-10-02', input({ trades: [noCk] })).rings[1].status).toBe('todo');
    expect(tradeCompliance(noCk, input({})).tags).toEqual(['未檢查']);
    expect(tradeCompliance(big, input({})).tags).toEqual(['超過風險上限']);
    // 進場當時的風險上限快照優先於目前設定
    expect(tradeCompliance({ ...big, riskLimit: 20_000 }, input({})).tags).toEqual([]);
  });

  it('簡報環期限：下一交易日 09:00（台北）前', () => {
    const late = act('brief_read', '2026-10-02', '2026-10-05T01:30:00Z'); // 10/5（一）09:30
    const early = act('brief_read', '2026-10-02', '2026-10-05T00:30:00Z'); // 10/5（一）08:30
    expect(dayRings('2026-10-02', input({ activities: [late] })).rings[0].status).toBe('todo');
    expect(dayRings('2026-10-02', input({ activities: [early] })).rings[0].status).toBe('done');
  });

  it('檢討環：近 3 個交易日無平倉且無逾期＝不適用；逾期未檢討＝未完成；到期日前完成＝完成', () => {
    const closed = trade({ status: 'closed', openedAt: '2026-09-21', closedAt: '2026-09-28', exit: 101 });
    // 9/28 平倉 → 到期 10/1（第 3 個交易日）
    expect(dayRings('2026-09-30', input({ trades: [closed] })).rings[2].status).toBe('done'); // 尚未到期，沒有逾期
    expect(dayRings('2026-10-01', input({ trades: [closed] })).rings[2].status).toBe('todo'); // 當日到期未完成
    const r = dayRings('2026-10-02', input({ trades: [closed] }));
    expect(r.rings[2].status).toBe('todo'); // 逾期
    expect(r.rings[2].action?.href).toBe(`#/discipline/journal?review=${closed.id}`);
    const reviewed = { ...closed, review: '依計畫出場', reviewedAt: '2026-09-30T12:00:00Z' };
    expect(dayRings('2026-10-01', input({ trades: [reviewed] })).rings[2].status).toBe('done');
    expect(dayRings('2026-10-02', input({ trades: [reviewed] })).rings[2].status).toBe('na');
    // 逾期後才補寫：補寫之後不再逾期，但合規判定記「逾期檢討」
    const late = { ...closed, review: '補寫', reviewedAt: '2026-10-06T12:00:00Z' };
    expect(dayRings('2026-10-07', input({ trades: [late] })).rings[2].status).toBe('na');
    expect(tradeCompliance(late, input({})).tags).toContain('逾期檢討');
  });

  it('休市日顯示上一交易日', () => {
    expect(displayDay(cal, '2026-10-10T04:00:00Z')).toEqual({ day: '2026-10-08', isTradingDay: false }); // 10/10（六）→ 10/9 休市 → 10/8
    expect(displayDay(cal, '2026-10-12T04:00:00Z')).toEqual({ day: '2026-10-12', isTradingDay: true });
  });

  it('休市日的舊文案不寫「還差」（相容層）', () => {
    const s = ritualAnswer({ rings: [{ done: true }, { done: true }, { done: false }], complete: false }, false, '2026-10-02');
    expect(s).not.toContain('還差');
  });
});

describe('連續與寬限日（§8.3）', () => {
  it('休市日不計也不中斷連續', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12'];
    const now = '2026-10-13T02:00:00Z'; // 10/13 10:00：10/12 已結算
    const s = flowStreak(input({ activities: days.map(brief), now }));
    expect(s.current).toBe(5);
    expect(s.best).toBe(5);
    expect(s.days.map((d) => d.day)).not.toContain('2026-10-09');
    // 休市日有沒有紀錄都不影響
    const s2 = flowStreak(input({ activities: [...days.map(brief), brief('2026-10-09')], now }));
    expect([s2.current, s2.best]).toEqual([5, 5]);
    expect(s.text).toBe('連續 5 日・最佳 5 日・本月寬限剩 2');
  });

  it('寬限日每個日曆月最多 2 個、不累積；畫成空心（grace）', () => {
    const acts = ['2026-10-01', '2026-10-02', '2026-10-08'].map(brief);
    const s = flowStreak(input({ activities: acts, now: '2026-10-08T14:00:00Z' }));
    const state = Object.fromEntries(s.days.map((d) => [d.day, d.state]));
    expect([state['2026-10-05'], state['2026-10-06'], state['2026-10-07']]).toEqual(['grace', 'grace', 'missed']);
    expect(state['2026-10-08']).toBe('done');
    expect(state['2026-09-30']).toBe('na'); // 開始使用之前
    expect(s.current).toBe(1);
    expect(s.best).toBe(2);
    expect(s.graceLeft).toBe(0);
    expect(s.days.filter((d) => d.state === 'grace' && d.day.startsWith('2026-10')).length).toBeLessThanOrEqual(2);
    // 下個月重新給 2 個，不累積
    const nov = flowStreak(input({ activities: acts, now: '2026-11-03T04:00:00Z' }));
    expect(nov.graceLeft).toBe(2);
  });

  it('寬限日只保護連續中的日子；期限未到的當日不套寬限、不中斷', () => {
    const acts = ['2026-10-01', '2026-10-02'].map(brief);
    const s = flowStreak(input({ activities: acts, now: '2026-10-05T04:00:00Z' })); // 10/5 中午：當日尚未結算
    expect(s.days[s.days.length - 1]).toMatchObject({ day: '2026-10-05', state: 'open' });
    expect(s.current).toBe(2);
    expect(s.graceLeft).toBe(2);
  });

  it('遷移前的交易日：有 v4 ritual_done 紀錄也算完成', () => {
    const legacy = act('legacy_xp', '2026-10-02', '2026-10-02T15:00:00Z', { xp: 60, level: 1 });
    const acts = [act('ritual_done', '2026-10-01'), act('ritual_done', '2026-10-02'), legacy, brief('2026-10-05')];
    expect(flowStreak(input({ activities: acts, now: '2026-10-06T04:00:00Z' })).current).toBe(3);
  });
});

describe('經驗值（§8.5）與等級（§8.6）', () => {
  it('進場經驗值每交易日最多計 2 筆', () => {
    const ts = [1, 2, 3].map((i) => trade({ createdAt: `2026-10-02T0${i}:00:00Z` }));
    const led = xpLedger(input({ trades: ts }));
    expect(led.filter((e) => e.kind === 'entry').map((e) => e.xp)).toEqual([20, 20]);
    expect(flowXp(input({ trades: ts }))).toBe(40);
    // 不同交易日各自計算
    expect(flowXp(input({ trades: [...ts, trade({ openedAt: '2026-10-05' })] }))).toBe(60);
    // 不符合條件的持倉 0
    expect(flowXp(input({ trades: [trade({ stop: 0 })] }))).toBe(0);
  });

  it('每項明列，其他行為一律 0', () => {
    const closedOk = trade({ status: 'closed', openedAt: '2026-09-21', closedAt: '2026-09-28', exit: 96, exitReason: 'stop', review: '依計畫停損', reviewedAt: '2026-09-29T12:00:00Z', fees: 300 });
    const acts = [
      brief('2026-10-01'), brief('2026-10-01'), // 同日只計 1 次
      act('weekly_review', '2026-10-02', '2026-10-03T03:00:00Z'), act('weekly_review', '2026-10-02', '2026-10-04T03:00:00Z'), // 同週 1 次
      act('backup', '2026-10-01', '2026-10-01T03:00:00Z'), act('backup', '2026-10-20', '2026-10-20T03:00:00Z'), act('backup', '2026-11-02', '2026-11-02T03:00:00Z'), // 每月 1 次
      act('backtest_own', '2026-10-01', '2026-10-01T03:00:00Z'), act('backtest_own', '2026-10-02', '2026-10-02T03:00:00Z'), // 每週 1 次
      act('checklist_done', '2026-10-01'), act('ritual_done', '2026-10-01'), act('review_done', '2026-10-01'), // 舊類型 0
    ];
    const led = xpLedger(input({ activities: acts, trades: [closedOk], now: '2026-11-03T04:00:00Z' }));
    const by = (k: string) => led.filter((e) => e.kind === k).reduce((s, e) => s + e.xp, 0);
    expect(by('brief')).toBe(10);
    expect(by('weekly_review')).toBe(30);
    expect(by('backup')).toBe(20);
    expect(by('backtest_own')).toBe(10);
    expect(by('entry')).toBe(20);
    expect(by('review')).toBe(30);
    expect(by('plan_exit')).toBe(20); // 虧損 (96 − 100) × 1000 + 300 = 4,300 ≤ 5,000 × 1.2
    expect(new Set(led.map((e) => e.kind))).toEqual(new Set(['brief', 'weekly_review', 'backup', 'backtest_own', 'entry', 'review', 'plan_exit']));
    // 出場原因「其他」或虧損超出計畫 → 不算依計畫出場；逾期檢討 → 不計檢討經驗值
    const other = { ...closedOk, exitReason: 'other' as const };
    const blown = { ...closedOk, exit: 90 }; // 虧損 10,300 > 6,000
    const late = { ...closedOk, reviewedAt: '2026-10-05T12:00:00Z' };
    expect(xpLedger(input({ trades: [other] })).some((e) => e.kind === 'plan_exit')).toBe(false);
    expect(xpLedger(input({ trades: [blown] })).some((e) => e.kind === 'plan_exit')).toBe(false);
    expect(xpLedger(input({ trades: [late] })).some((e) => e.kind === 'review')).toBe(false);
    expect(xpTable().map((r) => r.xp)).toEqual([10, 20, 30, 20, 30, 10, 10]);
  });

  it('等級：100 × (2^(n−1) − 1)，上限 10，不下降', () => {
    expect([2, 3, 4, 5].map((n) => levelThreshold(n))).toEqual([100, 300, 700, 1500]);
    expect(levelFor(60)).toMatchObject({ level: 1, floor: 0, next: 100 });
    expect(levelFor(1500).level).toBe(5);
    expect(levelFor(10_000_000)).toMatchObject({ level: 10, next: null, max: true, progress: 1 });
    expect(levelFor(50, 3).level).toBe(3); // 遷移前或曾達到的等級
  });
});

describe('既有經驗值遷移（v4 → v5）', () => {
  const v4Acts = [
    act('brief_read', '2026-09-24', '2026-09-24T12:00:00Z'),
    act('checklist_done', '2026-09-24', '2026-09-24T12:10:00Z', { outcome: 'open', code: '2330' }),
    act('ritual_done', '2026-09-24', '2026-09-24T12:20:00Z'),
    act('brief_read', '2026-09-25', '2026-09-25T12:00:00Z'),
  ];
  const v4Trade: Trade = { id: 'old', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-24', entry: 100, shares: 1000, stop: 95, target: 120, reasonType: '籌碼', checklist: CK };
  const cutoff = '2026-10-03T00:00:00.000Z';

  it('既有 60 經驗值遷移後不變（新規則不重算遷移前的行為）', () => {
    expect(legacyXp(v4Acts)).toBe(60);
    const out = migrateV5({ trades: [v4Trade], activity: v4Acts, portfolio: { capital: 1_000_000, riskPct: 1 } }, cutoff);
    expect(out.addedActivity).toHaveLength(1);
    expect(out.addedActivity[0]).toMatchObject({ id: 'legacy-xp', type: 'legacy_xp', at: cutoff, meta: { xp: 60, level: 1 } });
    const inp = input({ activities: [...v4Acts, ...out.addedActivity], trades: out.trades, now: '2026-10-03T04:00:00Z' });
    expect(flowXp(inp)).toBe(60);
    expect(flowLevel(inp)).toMatchObject({ level: 1, text: '60 / 100' });
    // 遷移後的新行為依新規則累加
    const after = input({ activities: [...v4Acts, ...out.addedActivity, brief('2026-10-05')], trades: out.trades, now: '2026-10-06T04:00:00Z' });
    expect(flowXp(after)).toBe(70);
  });

  it('交易補上 v5 欄位，既有值不動；重跑不重複新增既有經驗值', () => {
    const out = migrateV5({ trades: [v4Trade, { ...v4Trade, id: 'x', stop: 0, riskLimit: 5000 }], activity: v4Acts, portfolio: { capital: 2_000_000, riskPct: 0.5 } }, cutoff);
    const [a, b] = out.trades;
    expect(a).toMatchObject({ ...v4Trade, checklistDone: true, plannedRisk: 5000, riskLimit: 10_000, createdAt: '2026-09-23T16:00:00.000Z' });
    expect(b.plannedRisk).toBeUndefined();
    expect(b.riskLimit).toBe(5000);
    const again = migrateV5({ trades: out.trades, activity: [...v4Acts, ...out.addedActivity] }, '2026-10-04T00:00:00.000Z');
    expect(again.addedActivity).toEqual([]);
    expect(again.trades).toEqual(out.trades);
    // 沒有任何使用紀錄 → 不新增
    expect(migrateV5({ trades: [], activity: [] }, cutoff).addedActivity).toEqual([]);
  });

  it('舊交易：遷移前的進場、檢討、平倉不再計新經驗值', () => {
    const closed: Trade = { ...v4Trade, id: 'c', status: 'closed', closedAt: '2026-10-02', exit: 99, review: '檢討' };
    const acts = [...v4Acts, act('review_done', '2026-10-02', '2026-10-02T13:00:00Z', { trade: 'c' })];
    const out = migrateV5({ trades: [closed], activity: acts }, cutoff);
    expect(out.trades[0].reviewedAt).toBe('2026-10-02T13:00:00Z');
    const xp = legacyXp(acts);
    expect(flowXp(input({ activities: [...acts, ...out.addedActivity], trades: out.trades }))).toBe(xp);
  });
});

describe('合規交易（§8.4）', () => {
  const ok = trade({ status: 'closed', openedAt: '2026-09-21', closedAt: '2026-09-28', exit: 110, review: '依計畫', reviewedAt: '2026-09-29T12:00:00Z' });
  it('五項全過＝合規；未過的項目記成違規標籤', () => {
    expect(tradeCompliance(ok, input({}))).toEqual({ status: 'compliant', tags: [] });
    expect(tradeCompliance({ ...ok, exit: 94 }, input({})).status).toBe('compliant'); // 虧 6,000 ≤ 計畫風險 5,000 × 1.2
    expect(tradeCompliance({ ...ok, exit: 93.9 }, input({})).tags).toEqual(['虧損超出計畫']); // 虧 6,100
    expect(tradeCompliance({ ...ok, exit: 94, fees: 200 }, input({})).tags).toEqual(['虧損超出計畫']); // 費用計入實際虧損
    const unreviewed = { ...ok, review: undefined, reviewedAt: undefined };
    expect(tradeCompliance(unreviewed, input({ now: '2026-09-30T04:00:00Z' })).status).toBe('pending');
    expect(tradeCompliance(unreviewed, input({})).tags).toEqual(['逾期檢討']);
    expect(tradeCompliance(trade({ checklist: { ...CK, market: '' }, stop: 0 }), input({})).tags).toEqual(['未檢查', '無停損']);
  });

  it('個人統計：以 R 計；任一組 < 20 筆顯示「樣本不足（n/20）」', () => {
    const win = { ...ok, exit: 110 }; // +10,000 ÷ 5,000 = +2R
    const loss = { ...ok, id: 'l', exit: 96 }; // −0.8R
    const s = rSummary([win, loss]);
    expect(s.n).toBe(2);
    expect(s.winRate).toBe(0.5);
    expect(s.avgWinR).toBeCloseTo(2);
    expect(s.avgLossR).toBeCloseTo(-0.8);
    expect(s.expectancyR).toBeCloseTo(0.6);
    const split = compliantSplit(input({ trades: [win, loss, { ...ok, id: 'v', stop: 0 }] }));
    expect(split.compliant).toEqual({ n: 2, enough: false, text: '樣本不足（2/20）' });
    expect(split.violation).toEqual({ n: 1, enough: false, text: '樣本不足（1/20）' });
    const many = Array.from({ length: 20 }, (_, i) => ({ ...win, id: `w${i}` }));
    expect(compliantSplit(input({ trades: many })).compliant).toMatchObject({ n: 20, enough: true, winRate: 1 });
  });

  it('週報：本週流程完成率與違規標籤次數', () => {
    const w = weeklyFlow(input({ activities: ['2026-09-28', '2026-09-29', '2026-10-01'].map(brief), trades: [trade({ stop: 0 })], now: '2026-10-03T04:00:00Z' }));
    expect(w.week).toBe('2026-09-28');
    // 9/30 寬限（算未完成）；10/2 期限（10/5 09:00）未到，不計入分母
    expect(w.completion).toEqual({ done: 3, total: 4, rate: 0.75 });
    expect(w.counts['無停損']).toBe(1);
    expect(w.total).toBe(1);
  });
});

describe('成就（§8.7）', () => {
  it('8 個，每個有條件文字與進度 n/N', () => {
    const bs = badges({ compliant: 3, best_streak: 7, reviews: 4, plan_stops: 0, risk_run: 25 });
    expect(bs).toHaveLength(8);
    expect(bs.every((b) => b.description.length > 0)).toBe(true);
    const by = Object.fromEntries(bs.map((b) => [b.id, b]));
    expect(by.compliant_30.progressText).toBe('3/30');
    expect(by.streak_5).toMatchObject({ earned: true, progressText: '5/5' });
    expect(by.streak_20.progressText).toBe('7/20');
    expect(by.risk_run_20.earned).toBe(true);
    expect(by.first_plan_stop.earned).toBe(false);
  });

  it('遷移前已取得的舊成就對應到最接近的新成就並保留', () => {
    expect(Object.keys(LEGACY_BADGE_MAP).sort()).toEqual(['backtest_own', 'checklists_10', 'first_backup', 'first_ritual', 'reviews_20', 'stops_10', 'streak_30', 'streak_7']);
    const ids = new Set(uiConfig.gamification.badges.map((b) => b.id));
    expect(Object.values(LEGACY_BADGE_MAP).every((id) => ids.has(id))).toBe(true);
    const legacy = act('legacy_xp', '2026-10-02', '2026-10-02T15:00:00Z', { xp: 60, level: 1 });
    const acts = [act('ritual_done', '2026-10-01'), act('backup', '2026-10-01', '2026-10-01T03:00:00Z'), legacy];
    const bs = flowBadges(input({ activities: acts }), 0);
    const by = Object.fromEntries(bs.map((b) => [b.id, b]));
    expect(by.streak_5).toMatchObject({ earned: true, retained: true, retainedFrom: ['first_ritual'] });
    expect(by.first_compliant).toMatchObject({ earned: true, retainedFrom: ['first_backup'] });
    expect(by.streak_20.earned).toBe(false);
    // 遷移之後的舊類型紀錄不算
    const later = flowBadges(input({ activities: [legacy, act('backup', '2026-10-05', '2026-10-05T03:00:00Z')] }), 0);
    expect(later.find((b) => b.id === 'first_compliant')?.earned).toBe(false);
  });
});

describe('儲存交易時補上 v5 欄位', () => {
  it('建立時間、檢查表、計畫風險、風險上限快照；檢討與平倉時間只記第一次', () => {
    const t = prepareTrade(undefined, trade({ id: 'n' }), LIMIT, '2026-10-02T05:00:00.000Z');
    expect(t).toMatchObject({ createdAt: '2026-10-02T05:00:00.000Z', checklistDone: true, plannedRisk: 5000, riskLimit: LIMIT });
    const closed = prepareTrade(t, { ...t, status: 'closed', closedAt: '2026-10-05', exit: 101, review: '寫好了' }, 99, '2026-10-05T10:00:00.000Z');
    expect(closed).toMatchObject({ riskLimit: LIMIT, reviewedAt: '2026-10-05T10:00:00.000Z', closedRecordedAt: '2026-10-05T10:00:00.000Z' });
    const edited = prepareTrade(closed, { ...closed, review: '再補充', reviewedAt: undefined }, LIMIT, '2026-10-08T10:00:00.000Z');
    expect(edited.reviewedAt).toBe('2026-10-05T10:00:00.000Z');
    expect(prepareTrade(undefined, trade({ stop: 0 }), LIMIT, '2026-10-02T05:00:00.000Z').plannedRisk).toBeUndefined();
  });
});

describe('檢查表 7 題與帶入參數', () => {
  it('7 題全部完成才算完成', () => {
    expect(checklistComplete(trade({}))).toBe(true);
    expect(checklistComplete(trade({ checklist: { ...CK, reason: ' ' } }))).toBe(false);
    expect(checklistComplete(trade({ reasonType: '' }))).toBe(false);
    expect(checklistComplete(trade({ stop: 0 }))).toBe(false);
    expect(checklistComplete(trade({ target: 100 }))).toBe(false);
  });
  it('個股頁風險試算帶入：#/discipline/checklist?code=2330&price=123.5&stop=110&shares=150', () => {
    expect(parseChecklistQuery('#/discipline/checklist?code=2330&price=123.5&stop=110&shares=150')).toEqual({ code: '2330', entry: '123.5', stop: '110', shares: '150' });
    expect(parseChecklistQuery(new URLSearchParams('code=00980a&price=abc&stop=-1&shares=1.5'))).toEqual({ code: '00980A' });
    expect(parseChecklistQuery('code=<x>&price=0')).toEqual({});
  });
});
