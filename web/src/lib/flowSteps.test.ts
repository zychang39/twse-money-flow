/**
 * M6 每日步驟、經驗值上限、休市與寬限日、新手任務（驗收：以測試資料驗證每一步自動判定、不適用、
 * 各項經驗值上限、休市不中斷、寬限日上限、新手任務只領一次、既有資料不變）。
 */
import { describe, expect, it } from 'vitest';
import type { Activity, Trade } from '../db/db';
import { daySteps, flowStreak, flowXp, xpLedger, type FlowInput } from './ritual';
import { onboardingTasks, ONBOARD_TASKS } from './onboarding';
import { makeCalendar } from './tradingCalendar';

const cal = makeCalendar({ closed: ['2026-10-09'] });
const LIMIT = 10_000;
const CK = { market: '中性', trend: '多頭', revenue: '成長', valuation: '合理', reason: '投信連買' };
let seq = 0;
const act = (type: Activity['type'], day: string, hh = '12', meta?: Activity['meta']): Activity => ({ id: `a${seq++}`, type, day, at: `${day}T${hh}:00:00Z`, ...(meta ? { meta } : {}) });
const trade = (o: Partial<Trade>): Trade => ({ id: `t${seq++}`, code: '2330', name: '台積電', status: 'open', openedAt: '2026-10-02', entry: 100, shares: 1000, stop: 95, target: 120, reasonType: '籌碼', checklist: CK, ...o });
const input = (o: Partial<FlowInput>): FlowInput => ({ cal, activities: [], trades: [], riskLimit: LIMIT, now: '2026-10-08T04:00:00Z', watchCount: 3, ...o });
const stepOf = (s: ReturnType<typeof daySteps>, id: string) => s.steps.find((x) => x.id === id)!;
/** 一天做完 1–3：看大盤、看持倉、看異動清單（兩檔）且兩檔都開過 */
const fullDay = (day: string) => [
  act('market_viewed', day, '10'), act('holdings_viewed', day, '10'),
  act('movers_viewed', day, '10', { codes: '2330,2317' }), act('stock_viewed', day, '11', { code: '2330' }), act('stock_viewed', day, '11', { code: '2317' }),
];

describe('每日步驟自動判定', () => {
  it('六個步驟；無持倉、無新持倉、無待檢討＝不適用；1、3 完成＝當日完成', () => {
    const s = daySteps('2026-10-02', input({ activities: fullDay('2026-10-02') }));
    expect(s.steps.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stepOf(s, 'holdings').status).toBe('na');
    expect(stepOf(s, 'holdings').note).toBe('沒有持倉');
    expect(stepOf(s, 'entry').status).toBe('na');
    expect(stepOf(s, 'review').status).toBe('na');
    expect(stepOf(s, 'screener').optional).toBe(true);
    expect(s.score).toBe('2/2');
    expect(s.complete).toBe(true);
  });
  it('自選異動：清單上每一檔都開過才完成；沒有異動＝開過清單即可；沒有自選＝不適用', () => {
    const part = [act('market_viewed', '2026-10-02'), act('movers_viewed', '2026-10-02', '10', { codes: '2330,2317' }), act('stock_viewed', '2026-10-02', '11', { code: '2330' })];
    const s = daySteps('2026-10-02', input({ activities: part }));
    expect(stepOf(s, 'movers').status).toBe('todo');
    expect(stepOf(s, 'movers').note).toBe('已開 1／2 檔');
    expect(stepOf(s, 'movers').action?.href).toBe('#/stock/2317');
    expect(s.complete).toBe(false);
    const none = daySteps('2026-10-02', input({ activities: [act('market_viewed', '2026-10-02'), act('movers_viewed', '2026-10-02', '10', { codes: '' })] }));
    expect(stepOf(none, 'movers').status).toBe('done');
    const noWatch = daySteps('2026-10-02', input({ watchCount: 0, activities: [act('market_viewed', '2026-10-02')] }));
    expect(stepOf(noWatch, 'movers').status).toBe('na');
    expect(noWatch.complete).toBe(true);
  });
  it('看持倉：有持倉才適用；進場前檢查沿用檢查表、停損、風險上限', () => {
    const t = trade({ openedAt: '2026-10-01' });
    const s = daySteps('2026-10-02', input({ trades: [t], activities: fullDay('2026-10-02').filter((a) => a.type !== 'holdings_viewed') }));
    expect(stepOf(s, 'holdings').status).toBe('todo');
    const bad = trade({ openedAt: '2026-10-02', stop: 0 });
    const s2 = daySteps('2026-10-02', input({ trades: [bad], activities: fullDay('2026-10-02') }));
    expect(stepOf(s2, 'entry').status).toBe('todo');
    expect(s2.complete).toBe(false);
  });
  it('期限：下一交易日 09:00（台北）後才做的不算', () => {
    const late = fullDay('2026-10-02').map((a) => ({ ...a, at: '2026-10-05T02:00:00Z' })); // 10/5（一）10:00 台北
    expect(daySteps('2026-10-02', input({ activities: late })).complete).toBe(false);
  });
});

describe('連續、休市、寬限日', () => {
  it('休市日（10/9）不計也不中斷；未完成時寬限日每月最多 2 個', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12'];
    const acts = days.flatMap(fullDay);
    const st = flowStreak(input({ activities: acts, now: '2026-10-12T14:00:00Z' }));
    expect(st.current).toBe(5);
    // 10/13–10/16 四天沒做：前兩天寬限、第三天中斷
    const st2 = flowStreak(input({ activities: acts, now: '2026-10-19T04:00:00Z' }));
    const states = st2.days.filter((d) => d.day >= '2026-10-13' && d.day <= '2026-10-16').map((d) => d.state);
    expect(states).toEqual(['grace', 'grace', 'missed', 'missed']);
    expect(st2.current).toBe(0);
    expect(st2.best).toBe(5);
  });
  it('既有資料不變：步驟行為出現之前的交易日沿用三環規則（只讀簡報就完成）', () => {
    const old = [act('brief_read', '2026-10-01'), act('brief_read', '2026-10-02')];
    const st = flowStreak(input({ activities: [...old, ...fullDay('2026-10-05')], now: '2026-10-05T14:00:00Z' }));
    expect(st.current).toBe(3);
    const s = daySteps('2026-10-01', input({ activities: [...old, ...fullDay('2026-10-05')] }));
    expect(s.legacy).toBe(true);
    // 經驗值：舊日子各 10（簡報環），新日子 10（步驟 1–3）
    expect(xpLedger(input({ activities: [...old, ...fullDay('2026-10-05')], now: '2026-10-05T14:00:00Z' })).filter((e) => e.kind === 'brief').map((e) => e.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05']);
  });
});

describe('經驗值上限', () => {
  it('步驟 1–3 每日 10、看新觸發每日 5；名詞每個一次、每日最多 5 個（10 經驗值）', () => {
    const acts = [
      ...fullDay('2026-10-05'), act('screener_viewed', '2026-10-05'), act('screener_viewed', '2026-10-05', '13'),
      ...Array.from({ length: 7 }, (_, i) => act('term_read', '2026-10-05', '12', { id: `t${i}` })),
      act('term_read', '2026-10-06', '12', { id: 't0' }), act('term_read', '2026-10-06', '12', { id: 'x' }),
    ];
    const led = xpLedger(input({ activities: acts, now: '2026-10-07T04:00:00Z' }));
    const by = (k: string) => led.filter((e) => e.kind === k).reduce((s, e) => s + e.xp, 0);
    expect(by('brief')).toBe(10);
    expect(by('screener')).toBe(5);
    expect(by('term')).toBe(12); // 10/5：5 個；10/6：x（t0 已讀過）
  });
  it('新手任務每項只領一次；其他行為 0', () => {
    const acts = [act('onboard', '2026-10-05', '10', { task: 'first_watch' }), act('onboard', '2026-10-06', '10', { task: 'first_watch' }), act('onboard', '2026-10-06', '11', { task: 'range' }), act('stock_viewed', '2026-10-06', '12', { code: '2330' })];
    const led = xpLedger(input({ activities: acts }));
    expect(led.filter((e) => e.kind === 'onboard').map((e) => e.ref)).toEqual(['first_watch', 'range']);
    expect(flowXp(input({ activities: acts }))).toBe(20);
  });
  it('新手導覽 11 項；完成狀態來自紀錄或既有資料（自選、備份、名詞、本金設定）', () => {
    expect(ONBOARD_TASKS).toHaveLength(11);
    const st = onboardingTasks([act('onboard', '2026-10-05', '10', { task: 'range' }), act('backup', '2026-10-05')], { watchCount: 2, riskSet: false });
    const done = st.filter((t) => t.done).map((t) => t.id);
    expect(done).toEqual(expect.arrayContaining(['range', 'backup', 'first_watch']));
    expect(done).not.toContain('risk_settings');
    // 既有資料推得的完成（尚未記錄）需要補記才給經驗值
    expect(st.find((t) => t.id === 'first_watch')!.logged).toBe(false);
    expect(st.find((t) => t.id === 'range')!.logged).toBe(true);
  });
});
