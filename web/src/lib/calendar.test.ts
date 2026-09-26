import { describe, expect, it } from 'vitest';
import { filterEvents } from '../pages/Calendar';

describe('行事曆篩選', () => {
  const ev = [
    { date: '2026-10-01', type: '除權息', code: '2330', name: '台積電', text: '' },
    { date: '2026-10-02', type: '除權息', code: '2317', name: '鴻海', text: '' },
    { date: '2026-10-10', type: '月營收', code: null, name: null, text: '' },
  ];
  it('預設只顯示自選與持股（市場事件保留）', () => {
    expect(filterEvents(ev, new Set(['2330']), false).map((e) => e.code)).toEqual(['2330', null]);
    expect(filterEvents(ev, new Set(), true)).toHaveLength(3);
  });
});
