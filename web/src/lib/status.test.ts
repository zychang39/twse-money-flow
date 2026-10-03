import { describe, expect, it } from 'vitest';
import type { EvidenceRow } from './evidence';
import { gradeByTestMap, gradeCounts, gradeSummary, gradingThresholds, isListed, listedText, thresholdNote, verdictCounts, verdictSummary } from './status';
import type { StrategyItem } from './strategies';

const S = (grade: string, test: string, enabled = true, label?: string) => ({ grade, grade_label: label, test, enabled }) as unknown as StrategyItem;

describe('策略分級與指標判定：全站同一個計數（2026-10-02 健檢 M1-1）', () => {
  const list = [S('有效', 'rev_high12', true, '有效・待前瞻驗證'), S('觀察中', 'lead_up'), S('觀察中', 'combo_three'), S('停用', 'high52', false), S('停用', 'rev_high12', false)];
  it('gradeCounts：有效 1、觀察中 2、停用 2、上架 3；舊資料沒有 grade 時由 enabled 推回', () => {
    expect(gradeCounts(list)).toEqual({ valid: 1, watch: 2, off: 2, listed: 3, total: 5 });
    expect(gradeCounts([{ enabled: true } as StrategyItem, { enabled: false } as StrategyItem])).toEqual({ valid: 0, watch: 1, off: 1, listed: 1, total: 2 });
    expect(gradeCounts(null)).toEqual({ valid: 0, watch: 0, off: 0, listed: 0, total: 0 });
  });
  it('同一句話：策略庫頁首、探索卡、個股頁面板共用', () => {
    const c = gradeCounts(list);
    expect(gradeSummary(c)).toBe('1 個有效・2 個觀察中');
    expect(listedText(c)).toBe('上架 3 套（1 有效・2 觀察中）');
    expect(isListed(list[0])).toBe(true);
    expect(isListed(list[3])).toBe(false);
  });
  it('gradeByTestMap：同一指標多套策略取最好的分級；沒有策略資料時 null', () => {
    const m = gradeByTestMap(list)!;
    expect(m.get('rev_high12')).toEqual({ grade: '有效', label: '有效・待前瞻驗證' });
    expect(m.get('high52')).toEqual({ grade: '停用', label: '停用' });
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
  it('兩層門檻各自寫清楚：指標判定 t ≥ 2.5、策略分級校正後 t ≥ 3／2（由 evidence.json meta.config.grading 讀）', () => {
    const g = gradingThresholds({ grading: { valid: { t_corr_min: 3, per_month_min: 10, year_pass_ratio: 0.7, net_excess_positive_horizons: [40, 20] }, watch: { t_corr_min: 2 }, min_years_for_valid: 5 } });
    const note = thresholdNote(2.5, g);
    expect(note).toContain('指標判定「有效」：等權 40 日 t ≥ 2.5');
    expect(note).toContain('校正後 t ≥ 3');
    expect(note).toContain('校正後 t ≥ 2 為「觀察中」');
    expect(gradingThresholds(undefined).t_valid).toBe(3);
  });
});
