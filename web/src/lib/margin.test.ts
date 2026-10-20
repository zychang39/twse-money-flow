import { describe, expect, it } from 'vitest';
import type { MarginDay, MarginIndex } from '../data/types';
import { cardState, changeOver, dayTotal, marginRows, publishTime, streakText } from './margin';
import { makeCalendar } from './tradingCalendar';

const cal = makeCalendar({ closed: [] });
const day = (date: string, twse: number | null, tpex: number | null, amt = 6000) => ({
  date, down: 800, up: 600, flat: 400, twse: { amt, chg: twse }, tpex: { amt: 2000, chg: tpex },
});
const ix: MarginIndex = {
  date: '2026-10-16', dates: ['2026-10-14', '2026-10-15', '2026-10-16'], periods: [1, 5, 20], top: 30, min_base_lots: 500, min_base_lots_pct: 2000, source: '',
  days: [day('2026-10-14', 65.9, 23.3, 6515.7), day('2026-10-15', -51.4, -65.7, 6464.2), day('2026-10-16', -8.2, -7.1, 6455.9)],
};

describe('融資增減', () => {
  it('上市＋上櫃合計；缺一個市場時只加有的', () => {
    expect(dayTotal(ix.days[1])).toEqual({ chg: -117.1, amt: 8464.2 });
    expect(dayTotal({ date: 'x', down: 0, up: 0, flat: 0, twse: { amt: 6000, chg: -25.2 } })).toEqual({ chg: -25.2, amt: 6000 });
    expect(dayTotal({ date: 'x', down: 0, up: 0, flat: 0 })).toEqual({ chg: null, amt: null });
    expect(changeOver(ix, 2)).toBe(-59.8);
    expect(changeOver(ix, 5)).toBeNull();
  });

  it('排行列依 columns 還原成物件', () => {
    const d: MarginDay = { date: '2026-10-16', counts: { down: 1, up: 0, flat: 0 }, columns: ['code', 'name', 'market', 'chg', 'pct', 'balance', 'close', 'ret', 'streak'],
      lists: { '1_down_lots': [['2409', '友達', '上市', -6134, -2.04, 293872, 35.75, -2.59, 2]] } };
    expect(marginRows(d, '1', 'down_lots')).toEqual([{ code: '2409', name: '友達', market: '上市', chg: -6134, pct: -2.04, balance: 293872, close: 35.75, ret: -2.59, streak: 2 }]);
    expect(marginRows(d, '20', 'down_lots')).toBeNull();
    expect(streakText({ streak: 1 })).toBeNull();
    expect(streakText({ streak: 4 })).toBe('連 4 日資減');
    expect(streakText({ streak: 20 })).toBe('連 20 日以上資減');
  });

  it('卡片狀態：公布前「尚未公布」並附前一天；公布後顯示今天；凌晨看前一天是最新', () => {
    expect(publishTime()).toBe('20:45');
    const before = cardState(ix, cal, { today: '2026-10-19', hhmm: '18:00' });
    expect(before).toEqual({ kind: 'waiting', status: 'unpublished', last: ix.days[2] });
    expect(cardState(ix, cal, { today: '2026-10-19', hhmm: '21:30' })).toEqual({ kind: 'waiting', status: 'not_updated', last: ix.days[2] });
    expect(cardState(ix, cal, { today: '2026-10-19', hhmm: '10:00' }).kind).toBe('fresh'); // 盤中：前一天就是最新
    expect(cardState(ix, cal, { today: '2026-10-16', hhmm: '21:30' }).kind).toBe('fresh');
    expect(cardState(ix, cal, { today: '2026-10-17', hhmm: '10:00' }).kind).toBe('fresh'); // 週六
    expect(cardState(ix, cal, { today: '2026-10-19', hhmm: '01:00' }).kind).toBe('fresh'); // 週一凌晨
    expect(cardState(null, cal, { today: '2026-10-19', hhmm: '01:00' }).kind).toBe('none');
  });
});
