import { describe, expect, it } from 'vitest';
import { applyMembers, applyStreams, customStats, equalWeightIndex, median, rankDelta, resolveGroupId, sortGroups, type GroupListRow } from './groups';
import type { SectorsIndex } from '../data/types';

const idx = {
  date: '2026-10-02', min_ranked: 5, rank_window: '3M', unassigned: [], stock_cols: [],
  groups: [
    { id: 'f-a', layer: 'fine', name: '甲', path: [], parent: null, streams: false, members: 6, live: 6, med: { '1M': 1, '3M': 10, '6M': null, '12M': null }, rank: 1, of: 3, rank_prev: 2, merged: null, above60: 50, high60: 1, insti5: null, insti20: 2, new: 1 },
    { id: 'f-b', layer: 'fine', name: '乙', path: [], parent: null, streams: false, members: 6, live: 6, med: { '1M': 3, '3M': 5, '6M': null, '12M': null }, rank: 2, of: 3, rank_prev: 1, merged: null, above60: 30, high60: 0, insti5: null, insti20: -1, new: 0 },
    { id: 'f-c', layer: 'fine', name: '丙', path: [], parent: null, streams: false, members: 6, live: 6, med: { '1M': -2, '3M': -3, '6M': null, '12M': null }, rank: 3, of: 3, rank_prev: 3, merged: null, above60: 10, high60: 0, insti5: null, insti20: 5, new: 0 },
    { id: 'o-24', layer: 'official', name: '半導體業', path: [], parent: null, streams: false, members: 200, live: 200, med: { '1M': 0, '3M': 0, '6M': null, '12M': null }, rank: 1, of: 30, rank_prev: 1, merged: null, above60: 50, high60: 0, insti5: null, insti20: 0, new: 0 },
  ],
  stocks: {
    1101: [[], null, [], 2, 8, null, 70, 1, 0],
    1102: [[], null, [], 4, 6, null, 90, 0, 1],
    2330: [[], null, [], 0, 2, null, 85, 1, 0],
  },
} as unknown as SectorsIndex;

describe('族群（M4）', () => {
  it('中位數', () => {
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null])).toBeNull();
  });
  it('編輯內建族群：移除、加入、不重複', () => {
    expect(applyMembers(['a', 'b', 'c'], { members: ['d', 'a'], removed: ['b'] })).toEqual(['a', 'c', 'd']);
    expect(applyStreams({ 上游: ['a', 'b'], 中游: ['c'] }, { streams: { 中游: ['c', 'd'] } }, ['a', 'c', 'd'])).toEqual({ 上游: ['a'], 中游: ['c', 'd'] });
  });
  it('自訂族群的統計：中位數、站上 60 日線比例、在細產業中的名次', () => {
    const st = customStats(['1101', '1102', '2330', '9999'], idx);
    expect(st.members).toBe(4);
    expect(st.live).toBe(3);
    expect(st.med3m).toBe(6);
    expect(st.med1m).toBe(2);
    expect(st.above60).toBeCloseTo(66.67, 1);
    expect(st.rank).toBe(2); // 只有「甲」（10%）高於 6%
    expect(st.of).toBe(3);
  });
  it('等權指數：平均每日報酬連乘、日期對齊', () => {
    const a = { d: ['d1', 'd2', 'd3'], c: [10, 11, 12.1], af: [1, 1, 1] };
    const b = { d: ['d1', 'd2', 'd3'], c: [20, 20, 18], af: [1, 1, 1] };
    const x = equalWeightIndex([a, b], 10);
    expect(x.dates).toEqual(['d2', 'd3']);
    expect(x.values[0]).toBeCloseTo(105);
    expect(x.values[1]).toBeCloseTo(105 * (1 + (0.1 - 0.1) / 2));
  });
  it('舊網址的產業名稱轉成族群 id；排序與名次變化', () => {
    expect(resolveGroupId('半導體業', idx)).toBe('o-24');
    expect(resolveGroupId('f-b', idx)).toBe('f-b');
    expect(resolveGroupId('u-xyz', idx)).toBe('u-xyz');
    expect(resolveGroupId('不存在', idx)).toBeNull();
    const rows = idx.groups.slice(0, 3).map((g) => ({ id: g.id, name: g.name, med1m: g.med['1M'], rank: g.rank, insti20: g.insti20 }) as GroupListRow);
    expect(sortGroups(rows, 'rank').map((r) => r.id)).toEqual(['f-a', 'f-b', 'f-c']);
    expect(sortGroups(rows, 'r1m').map((r) => r.id)).toEqual(['f-b', 'f-a', 'f-c']);
    expect(sortGroups(rows, 'insti').map((r) => r.id)).toEqual(['f-c', 'f-a', 'f-b']);
    expect(rankDelta(3, 5)).toBe(2);
    expect(rankDelta(null, 5)).toBeNull();
  });
});
