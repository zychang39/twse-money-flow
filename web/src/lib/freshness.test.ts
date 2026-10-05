import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCalendar } from './tradingCalendar';
import { asofLabel, dueDate, freshView, missingDayStatus, tpeClock } from './freshness';

const golden = JSON.parse(readFileSync(new URL('../../../tests/fixtures/golden/calendar_2026.json', import.meta.url), 'utf8')) as { closed: string[] };
const cal = makeCalendar(golden);
const at = (iso: string) => new Date(`${iso}+08:00`);

// 10/5（一）22:42 部署當下的 meta：收盤行情 10/5，三大法人／融資融券／期貨法人 10/2（10/5 抓取失敗）
const broken = { market_date: '2026-10-05', asof: { quotes: '2026-10-05', insti: '2026-10-02', credit: '2026-10-02', taifex: '2026-10-02' } };
// 修好之後：10/5 全部到齊
const fixed = { market_date: '2026-10-05', asof: { quotes: '2026-10-05', insti: '2026-10-05', credit: '2026-10-05', taifex: '2026-10-05' } };

describe('資料新鮮度：D(X)＝最近一個預期公布時間已過的交易日', () => {
  it('各資料集的預期時間', () => {
    const c = tpeClock(at('2026-10-06T16:30'));
    expect(dueDate('quotes', cal, c)).toBe('2026-10-06');
    expect(dueDate('insti', cal, c)).toBe('2026-10-06');
    expect(dueDate('credit', cal, c)).toBe('2026-10-05');
    expect(dueDate('insti', cal, tpeClock(at('2026-10-06T15:59')))).toBe('2026-10-05');
  });
  it('尚未公布 vs 尚未更新', () => {
    expect(missingDayStatus('insti', '2026-10-06', tpeClock(at('2026-10-06T14:00')))).toBe('unpublished');
    expect(missingDayStatus('insti', '2026-10-06', tpeClock(at('2026-10-06T16:30')))).toBe('not_updated');
    expect(missingDayStatus('insti', '2026-10-05', tpeClock(at('2026-10-06T00:13')))).toBe('not_updated');
  });
});

describe('驗收情境（PR 說明附表）', () => {
  it('10/6 00:13：10/5 的資料就是最新，不叫落後、不顯示「今天的資料尚未更新」；下次更新 10/6 15:00 後', () => {
    const v = freshView(fixed, cal, at('2026-10-06T00:13'));
    expect(v.todayNotUpdated).toBe(false);
    expect(v.lagging).toBeNull();
    expect(v.next).toBe('下次更新 10/6 15:00 後');
    // 當時真正抓取失敗的資料集（三大法人等仍停在 10/2）→ 橫幅只列落後的
    const b = freshView(broken, cal, at('2026-10-06T00:13'));
    expect(b.todayNotUpdated).toBe(false);
    expect(b.lagging).toBe('三大法人 10/2（落後 1 個交易日）・融資融券 10/2（落後 1 個交易日）・期貨法人 10/2（落後 1 個交易日）');
  });
  it('10/6 14:00：還沒到預期時間，全部最新；下次更新 10/6 15:00 後', () => {
    const v = freshView(fixed, cal, at('2026-10-06T14:00'));
    expect([v.todayNotUpdated, v.lagging, v.next]).toEqual([false, null, '下次更新 10/6 15:00 後']);
  });
  it('10/6 16:30：收盤行情、三大法人、期貨法人預期時間已過 → 今天的資料尚未更新＋落後；下次更新 22:00', () => {
    const v = freshView(fixed, cal, at('2026-10-06T16:30'));
    expect(v.todayNotUpdated).toBe(true);
    expect(v.lagging).toBe('收盤行情 10/5（落後 1 個交易日）・三大法人 10/5（落後 1 個交易日）・期貨法人 10/5（落後 1 個交易日）');
    expect(v.next).toBe('下次更新 10/6 22:00 後');
    // 收盤行情、法人都到了，只差融資融券（還沒 22:00）→ 全部最新
    const ok = freshView({ market_date: '2026-10-06', asof: { quotes: '2026-10-06', insti: '2026-10-06', credit: '2026-10-05', taifex: '2026-10-06' } }, cal, at('2026-10-06T16:30'));
    expect([ok.todayNotUpdated, ok.lagging]).toEqual([false, null]);
  });
  it('10/6 23:00：全部預期時間已過；10/6 都到了 → 只顯示資料至，沒有下次更新', () => {
    const all = { market_date: '2026-10-06', asof: { quotes: '2026-10-06', insti: '2026-10-06', credit: '2026-10-06', taifex: '2026-10-06' } };
    expect(freshView(all, cal, at('2026-10-06T23:00'))).toMatchObject({ todayNotUpdated: false, lagging: null, next: null });
    const lateCredit = { ...all, asof: { ...all.asof, credit: '2026-10-05' } };
    expect(freshView(lateCredit, cal, at('2026-10-06T23:00'))).toMatchObject({ todayNotUpdated: true, lagging: '融資融券 10/5（落後 1 個交易日）' });
  });
  it('10/10（假日）：休市，最近交易日的資料就是最新', () => {
    const last = cal.previous('2026-10-10');
    const v = freshView({ market_date: last, asof: { quotes: last, insti: last, credit: last, taifex: last } }, cal, at('2026-10-10T12:00'));
    expect(v).toMatchObject({ holiday: true, todayNotUpdated: false, lagging: null, next: null });
  });
});

describe('區塊資料日（個股頁）', () => {
  it('尚未公布與尚未更新分開', () => {
    expect(asofLabel('2026-10-02', 'insti', cal, tpeClock(at('2026-10-06T00:13')), '2026-10-05')).toBe('資料日 10/2（10/5 尚未更新）');
    expect(asofLabel('2026-10-05', 'insti', cal, tpeClock(at('2026-10-06T15:30')), '2026-10-06')).toBe('資料日 10/5（10/6 尚未公布）');
    expect(asofLabel('2026-10-05', 'insti', cal, tpeClock(at('2026-10-06T00:13')), '2026-10-05')).toBe('資料日 10/5');
    expect(asofLabel(null, 'insti', cal, tpeClock(at('2026-10-06T00:13')))).toBe('無資料');
  });
});
