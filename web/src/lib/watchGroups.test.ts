import { describe, expect, it } from 'vitest';
import { GROUP_NAME_MAX, cleanGroupName, currentGroup, defaultMoveTarget, effectiveGroups, groupCounts, groupNameError, moveItem, normWatchPrefs } from './watchGroups';

const w = (...groups: string[]) => groups.map((group) => ({ group }));

describe('自選群組', () => {
  it('順序：有股票的依第一檔的順序（預設排最前面），建立但還沒有股票的排在後面', () => {
    expect(effectiveGroups(w('Latest', '預設', 'Latest', 'ETF'), { groups: ['觀察中', 'ETF'], hidden: [], order: [] })).toEqual(['預設', 'Latest', 'ETF', '觀察中']);
  });

  it('「預設」沒有股票就不出現；使用者自己建立的「預設」會出現', () => {
    expect(effectiveGroups(w('Latest'), null)).toEqual(['Latest']);
    expect(effectiveGroups([], { groups: ['預設'], hidden: [], order: [] })).toEqual(['預設']);
    expect(effectiveGroups([], undefined)).toEqual([]);
  });

  it('拖曳排過：照排好的順序；之後才出現的群組接在後面；已經不存在的名稱略過', () => {
    const prefs = { groups: ['觀察中'], hidden: [], order: ['Latest', '已刪除', '觀察中', '預設'] };
    expect(effectiveGroups(w('預設', 'Latest', 'ETF'), prefs)).toEqual(['Latest', '觀察中', '預設', 'ETF']);
    // 舊資料沒有 order 欄位也能用
    expect(effectiveGroups(w('預設', 'Latest'), { groups: [] })).toEqual(['預設', 'Latest']);
    expect(normWatchPrefs({ hidden: ['hot'] })).toEqual({ groups: [], hidden: ['hot'], order: [] });
  });

  it('移動一個項目（拖曳的落點）', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']); // 超出範圍夾在尾端
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });

  it('每個群組的檔數', () => {
    expect([...groupCounts(w('A', 'B', 'A'))]).toEqual([['A', 2], ['B', 1]]);
  });

  it('名稱檢查：空白、太長、重複（沒有「全部」這個總覽了，可以當群組名稱）', () => {
    expect(cleanGroupName('  半導體   設備 ')).toBe('半導體 設備');
    expect(groupNameError('   ')).toBe('請輸入群組名稱');
    expect(groupNameError('全部')).toBeNull();
    expect(groupNameError('一'.repeat(GROUP_NAME_MAX))).toBeNull();
    expect(groupNameError('一'.repeat(GROUP_NAME_MAX + 1))).toContain(`最多 ${GROUP_NAME_MAX} 個字`);
    expect(groupNameError(' Latest ', ['Latest'])).toBe('已經有「Latest」這個群組');
    expect(groupNameError('Latest')).toBeNull(); // 改名成已存在的群組由呼叫端當成合併，不在這裡擋
  });

  it('刪除時預設把股票移到「預設」；刪的是「預設」就移到第一個其他群組，沒有其他群組則沒有地方可移', () => {
    expect(defaultMoveTarget('Latest', ['預設', 'Latest'])).toBe('預設');
    expect(defaultMoveTarget('Latest', ['Latest'])).toBe('預設'); // 「預設」會自動出現
    expect(defaultMoveTarget('預設', ['預設', 'Latest', 'ETF'])).toBe('Latest');
    expect(defaultMoveTarget('預設', ['預設'])).toBeNull();
  });
  it('目前顯示的群組（沒有「全部」）：想看的還在就用它，不在了換第一個；沒有群組時什麼都不選', () => {
    expect(currentGroup('Latest', ['預設', 'Latest'], 'hot')).toBe('Latest');
    expect(currentGroup('', ['預設', 'Latest'], 'hot')).toBe('預設'); // 第一次進來
    expect(currentGroup('已刪除', ['預設', 'Latest'], 'hot')).toBe('預設');
    expect(currentGroup('全部', ['Latest'], null)).toBe('Latest'); // 舊版記下的「全部」
    expect(currentGroup('hot', ['預設'], 'hot')).toBe('hot');
    expect(currentGroup('hot', ['預設'], null)).toBe('預設'); // 系統清單被隱藏
    expect(currentGroup('新群組', ['預設'], null, '新群組')).toBe('新群組'); // 剛建立、資料還沒重讀
    // 還沒有任何群組（新用戶）：什麼都不選，系統清單不會自己跑出來
    expect(currentGroup('', [], 'hot')).toBe('');
    expect(currentGroup('hot', [], 'hot')).toBe('');
    expect(currentGroup('', [], null)).toBe('');
  });
});
