import { describe, expect, it } from 'vitest';
import type { EvidenceRow } from './evidence';
import { gradeByTestMap, gradeCounts, gradeSummary, isListed, listedText, verdictCounts, verdictSummary } from './status';
import type { StrategyItem } from './strategies';

const S = (id: string, test: string, enabled = true) => ({ grade: { id, label: '', notes: [] }, test, enabled }) as unknown as StrategyItem;

describe('策略分級與指標判定：全站同一個計數（2026-10-03 四級）', () => {
  const list = [S('valid', 'rev_confirm'), S('sig_only', 'rev_high12'), S('watch', 'lead_up'), S('watch', 'combo_rs_trust'), S('invalid', 'high52', false), S('invalid', 'rev_high12', false)];
  it('gradeCounts：有效 1、訊號顯著 1、觀察中 2、無效 2、上架 4；舊字串與 enabled 都能換算', () => {
    expect(gradeCounts(list)).toEqual({ valid: 1, sig_only: 1, watch: 2, invalid: 2, listed: 4, total: 6 });
    expect(gradeCounts([{ grade: '有效', enabled: true } as StrategyItem, { grade: '停用', enabled: false } as StrategyItem, { enabled: true } as StrategyItem]))
      .toEqual({ valid: 1, sig_only: 0, watch: 1, invalid: 1, listed: 2, total: 3 });
    expect(gradeCounts(null)).toEqual({ valid: 0, sig_only: 0, watch: 0, invalid: 0, listed: 0, total: 0 });
  });
  it('同一句話：策略庫頁首、探索卡共用', () => {
    const c = gradeCounts(list);
    expect(gradeSummary(c)).toBe('有效 1、訊號顯著・未勝 0050 1、觀察中 2');
    expect(listedText(c)).toBe('上架 4 套');
    expect(isListed(list[0])).toBe(true);
    expect(isListed(list[1])).toBe(true);
    expect(isListed(list[4])).toBe(false);
    expect(isListed({ grade: { id: 'watch', label: '', notes: [] }, enabled: false } as unknown as StrategyItem)).toBe(false);
  });
  it('gradeByTestMap：同一指標多套策略取最好的分級；沒有策略資料時 null', () => {
    const m = gradeByTestMap(list)!;
    expect(m.get('rev_high12')).toEqual({ grade: 'sig_only', label: '訊號顯著・未勝 0050' });
    expect(m.get('high52')).toEqual({ grade: 'invalid', label: '無效' });
    expect(gradeByTestMap(null)).toBeNull();
  });
  it('verdictCounts／verdictSummary：指標判定另一套詞彙', () => {
    const rows = [{ verdict: '有效' }, { verdict: '有效' }, { verdict: '環境依賴' }, { verdict: '無效' }, { verdict: '樣本範圍受限' }] as EvidenceRow[];
    const c = verdictCounts(rows);
    expect(c['有效']).toBe(2);
    expect(c.usable).toBe(3);
    expect(c.total).toBe(5);
    expect(verdictSummary(c)).toBe('2 項有效・1 項環境依賴');
  });
});
