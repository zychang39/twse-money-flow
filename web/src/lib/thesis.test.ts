import { describe, expect, it } from 'vitest';
import type { StockRow } from '../data/types';
import type { Thesis, Trade } from '../db/db';
import { makeCalendar } from './tradingCalendar';
import { qualityConfig } from './config';
import {
  REMIND_TRADING_DAYS, ackKey, acknowledge, bizItem, bizSnapshot, breakerFields, breakerStatus, breakerText, completeness, defaultBreaker, dueItems,
  emptyThesis, eventStatus, evidenceAsk, evidenceDrafts, moatCount, normThesis, reminders, sameKindNudge, thesisSub, triggeredBreakers, verdictMatrix,
} from './thesis';

const row = (o: Record<string, unknown> = {}): StockRow => ({
  code: '2330', name: '台積電', market: 'twse', industry: '半導體業', close: 100, change: 1, change_pct: 1, volume_lots: 1, value_million: 1,
  foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0, foreign_streak: 0, trust_streak: 0, foreign_net_5d: 0, trust_net_5d: 0,
  margin_balance: 0, margin_change: 0, short_balance: 0, pe: 20, pb: 5, dividend_yield: 1, flags: [], ...o,
});
const note = (o: Partial<Thesis> = {}): Thesis => ({ ...emptyThesis('2330', '台積電'), ...o });
// 2026-10-09（五）、10/12（一）、10/13（二）是交易日；10/10、10/11 是週末；假設 10/12 臨時休市的版本另外建
const cal = makeCalendar({ closed: [] });

describe('推翻條件', () => {
  it('條件成立＝已觸發；欄位沒有資料不算觸發，寫「資料累積中」', () => {
    const b = { field: 'roic', op: '<' as const, value: 20 };
    expect(breakerText(b)).toBe('ROIC（簡式）低於 20%');
    expect(breakerStatus(b, row({ roic: 31.3 }))).toMatchObject({ triggered: false, known: true, currentText: '現在 31.3%' });
    expect(breakerStatus(b, row({ roic: 12 })).triggered).toBe(true);
    expect(breakerStatus(b, row({ roic: null }))).toMatchObject({ triggered: false, known: false, currentText: '資料累積中' });
    expect(breakerStatus(b, undefined).triggered).toBe(false);
    expect(triggeredBreakers(note({ breakers: [b, { field: 'revenue_yoy_3m', op: '<', value: 0 }] }), row({ roic: 5, revenue_yoy_3m: 10 }))).toEqual([b]);
  });
  it('可選欄位只有生意體質、基本面、估值；預設條件依有沒有 ROIC', () => {
    const groups = new Set(breakerFields().map((f) => f.group));
    expect([...groups].sort()).toEqual(['估值', '基本面', '生意體質'].sort());
    expect(breakerFields()[0].group).toBe('生意體質');
    expect(defaultBreaker(row({ roic: 30 }))).toEqual({ field: 'roic', op: '<', value: qualityConfig.hurdle_pct });
    expect(defaultBreaker(row())).toEqual({ field: 'revenue_yoy_3m', op: '<', value: 0 });
  });
});

describe('驗證事件（用交易日曆，不是日曆天）', () => {
  const e = (date: string) => ({ date, label: '11 月營收公布', source: 'calendar' as const });
  it('今天、幾個交易日後、已過', () => {
    expect(eventStatus(e('2026-10-09'), '2026-10-09', cal)).toMatchObject({ state: 'today', text: '今天' });
    // 週五 → 下週一：中間隔週末，只算 1 個交易日
    expect(eventStatus(e('2026-10-12'), '2026-10-09', cal)).toMatchObject({ state: 'soon', tradingDays: 1, text: '1 個交易日後' });
    expect(eventStatus(e('2026-10-08'), '2026-10-09', cal).state).toBe('past');
    expect(eventStatus(e('2026-10-30'), '2026-10-09', cal).state).toBe('later');
  });
  it('休市日不算：週一休市時，週二是 1 個交易日後', () => {
    const closed = makeCalendar({ closed: ['2026-10-12'] });
    expect(eventStatus(e('2026-10-13'), '2026-10-09', closed).tradingDays).toBe(1);
    expect(eventStatus(e('2026-10-13'), '2026-10-09', cal).tradingDays).toBe(2);
    // 事件落在休市日：下一個交易日前就到了，視為 1 個交易日內
    expect(eventStatus(e('2026-10-10'), '2026-10-09', cal)).toMatchObject({ state: 'soon', tradingDays: 1 });
  });
  it(`${REMIND_TRADING_DAYS} 個交易日內才是 soon`, () => {
    expect(eventStatus(e('2026-10-14'), '2026-10-09', cal).state).toBe('soon'); // 一、二、三 = 3
    expect(eventStatus(e('2026-10-15'), '2026-10-09', cal).state).toBe('later');
  });
});

describe('證據的三個標籤', () => {
  it('提問取第一個有提問的標籤；官方、直接、落後沒有提問', () => {
    expect(evidenceAsk({ text: 'x', source: 'official', directness: 'direct', timing: 'lagging' })).toBeNull();
    expect(evidenceAsk({ text: 'x', source: 'company', directness: 'proxy', timing: '' })).toBe(qualityConfig.evidence.source.find((s) => s.id === 'company')?.ask);
    expect(evidenceAsk({ text: 'x', source: 'official', directness: 'proxy', timing: '' })).toBe(qualityConfig.evidence.directness.find((s) => s.id === 'proxy')?.ask);
  });
  it('至少兩條而且都屬於同一類才提醒；只有一條或種類不同不提醒', () => {
    const a = { text: '營收年增', source: 'official', directness: 'direct', timing: 'lagging' };
    expect(sameKindNudge([a])).toBeNull();
    expect(sameKindNudge([a, { ...a, text: '毛利率' }])).toBe(qualityConfig.evidence.same_kind_ask);
    expect(sameKindNudge([a, { text: '法說', source: 'company', directness: 'direct', timing: 'leading' }])).toBeNull();
    expect(sameKindNudge([a, { text: '', source: 'official', directness: 'direct', timing: 'lagging' }])).toBeNull();
  });
  it('一鍵帶入的事實自動貼標籤：月營收＝官方・直接・落後；法人＝官方・代理', () => {
    const d = evidenceDrafts(row({ roic: 31.3, foreign_net_5d: -1200, trust_net_5d: 200 }), {
      revenue: [{ ym: '2026-10', revenue: 1, yoy: 59.7, mom: 1 }], quarters: [{ period: '2026Q2', gross_margin: 67.7 }],
    } as never);
    expect(d.map((x) => x.id)).toEqual(['revenue', 'roic', 'margin', 'insti']);
    expect(d[0]).toMatchObject({ text: '10 月營收年增 +59.7%', source: 'official', directness: 'direct', timing: 'lagging' });
    expect(d[3]).toMatchObject({ text: '外資與投信近 5 日合計賣超 1,000 張', source: 'official', directness: 'proxy' });
    expect(evidenceDrafts(row({ foreign_net_5d: null, trust_net_5d: null }), null)).toEqual([]);
  });
});

describe('完成度與競爭優勢自問', () => {
  it('五個部分都有內容才算寫完第一版；副資訊寫出還沒寫什麼', () => {
    const t = note({ view: '報酬率守得住' });
    expect(completeness(t)).toMatchObject({ done: 1, total: 5, complete: false, empty: false });
    expect(thesisSub(t)).toBe('已寫 1/5・還沒寫：市場可能看錯什麼、驗證事件、推翻條件、證據');
    const full = note({
      view: 'a', gap: 'b', events: [{ date: '2026-12-10', label: '營收', source: 'calendar' }],
      breakers: [{ field: 'roic', op: '<', value: 20 }], evidence: [{ text: 'c', source: '', directness: '', timing: '' }],
    });
    expect(completeness(full).complete).toBe(true);
    expect(thesisSub(full)).toBe('驗證事件 1・推翻條件 1・證據 1');
    expect(completeness(note()).empty).toBe(true);
  });
  it('已答題數只算有內容的回答，不超過題數', () => {
    const id = qualityConfig.moat[0].id, n = qualityConfig.moat[0].questions.length;
    expect(moatCount(note(), id)).toEqual({ answered: 0, total: n });
    expect(moatCount(note({ moat: { [id]: ['有', ' ', '有', '', '多的', '多的'] } }), id).answered).toBe(2);
  });
  it('缺欄位的舊資料補齊', () => {
    expect(normThesis({ code: '2330' } as never)).toMatchObject({ name: '2330', events: [], breakers: [], evidence: [], moat: {} });
  });
});

describe('簡報的論點提醒', () => {
  const b = { field: 'roic', op: '<' as const, value: 8 };
  const ev = { date: '2026-10-12', label: '9 月營收公布', source: 'calendar' as const };
  it('沒有筆記、或沒有到期的事 → 空陣列', () => {
    expect(reminders([], new Map(), '2026-10-09', cal)).toEqual([]);
    expect(reminders([note({ breakers: [b], events: [{ ...ev, date: '2026-11-30' }] })], new Map([['2330', row({ roic: 30 })]]), '2026-10-09', cal)).toEqual([]);
  });
  it('推翻條件在前、事件由近到遠；看過之後不再提醒同一件事', () => {
    const t1 = note({ breakers: [b], events: [ev] });
    const t2 = note({ code: '2603', name: '長榮', events: [{ ...ev, date: '2026-10-09' }] });
    const by = new Map([['2330', row({ roic: 5.8 })], ['2603', row({ code: '2603' })]]);
    const r = reminders([t1, t2], by, '2026-10-09', cal);
    expect(r.map((x) => [x.code, x.kind, x.when])).toEqual([['2330', 'breaker', '5.8%'], ['2603', 'event', '今天'], ['2330', 'event', '1 個交易日後']]);
    expect(r[0].text).toBe('碰到推翻條件：ROIC（簡式）低於 8%');
    const due = dueItems(t1, by.get('2330'), '2026-10-09', cal);
    const seen = acknowledge(t1, due, '2026-10-09T12:00:00.000Z');
    expect(seen.reviewedAt).toBe('2026-10-09T12:00:00.000Z');
    expect(seen.acks).toEqual([ackKey.breaker(b), ackKey.event(ev)]);
    expect(dueItems(seen, by.get('2330'), '2026-10-09', cal)).toEqual([]);
    // 條件改了（鍵不同）會重新提醒，舊的看過紀錄在下次按下時清掉
    const edited = { ...seen, breakers: [{ ...b, value: 10 }] };
    expect(dueItems(edited, by.get('2330'), '2026-10-09', cal)).toHaveLength(1);
    expect(acknowledge(edited, [], 'x').acks).toEqual([ackKey.event(ev)]);
  });
});

describe('檢查表：生意類型（只記錄，不留白）', () => {
  it('有類型：名稱＋ROIC；金融業；沒有資料寫原因', () => {
    expect(bizItem(row({ biz_type: 'steady', roic: 31.3 }))).toMatchObject({ kind: 'steady', short: qualityConfig.labels.steady.name, main: '31.3%', missing: null });
    expect(bizItem(row({ biz_type: 'fin', roic: null }))).toMatchObject({ kind: 'fin', short: qualityConfig.labels.fin.name });
    expect(bizItem(row({ biz_type: null, roic: null }))).toMatchObject({ kind: null, short: '資料累積中' });
    expect(bizItem(row()).missing).toContain('還沒有生意體質欄位');
    expect(bizItem(undefined).short).toBe('資料不足');
    expect(bizSnapshot(row({ biz_type: 'near', roic: 9 }), '2026-11-13')).toMatchObject({ source: 'auto', result: qualityConfig.labels.near.name, numbers: { biz_type: 'near', roic: 9 }, date: '2026-11-13' });
    expect(bizSnapshot(row(), null).result).toBeNull();
  });
});

describe('平倉檢討：論點對錯 × 賺賠', () => {
  const tr = (o: Partial<Trade>): Trade => ({
    id: Math.random().toString(36), code: '2330', name: '台積電', status: 'closed', openedAt: '2026-09-01', closedAt: '2026-09-20', entry: 100, exit: 110, shares: 1000, stop: 90, target: 130,
    reasonType: '營收', checklist: { market: '', trend: '', revenue: '', valuation: '', reason: '' }, ...o,
  });
  it('只算已平倉而且回答過的；賺錢但論點錯、賠錢但論點對分開記', () => {
    const m = verdictMatrix([
      tr({ thesisVerdict: 'right' }), tr({ thesisVerdict: 'wrong' }), tr({ exit: 90, thesisVerdict: 'right' }), tr({ exit: 90, thesisVerdict: 'wrong' }),
      tr({ thesisVerdict: 'unknown' }), tr({}), tr({ status: 'open', thesisVerdict: 'right' }),
    ]);
    expect(m).toEqual({ winRight: 1, winWrong: 1, lossRight: 1, lossWrong: 1, unknown: 1, answered: 5 });
    expect(verdictMatrix([tr({})]).answered).toBe(0);
  });
});
