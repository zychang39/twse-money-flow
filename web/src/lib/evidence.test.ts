import { describe, expect, it } from 'vitest';
import { type EvidenceRow, counts, filterRows, pctSigned, rowSummary, sortRows, tText, verdictTone } from './evidence';

const row = (id: string, verdict: EvidenceRow['verdict'], t: number | null, extra: Partial<EvidenceRow> = {}): EvidenceRow =>
  ({ id, label: id, family: '動能', kind: 'event', verdict, reasons: [], t, ...extra });

describe('evidence', () => {
  it('依判定再依 t 排序', () => {
    const rows = [row('a', '無效', 3), row('b', '有效', 2.6), row('c', '有效', 3.7), row('d', '環境依賴', 2.3), row('e', '樣本範圍受限', 3.8)];
    expect(sortRows(rows).map((r) => r.id)).toEqual(['c', 'b', 'd', 'e', 'a']);
  });
  it('篩選與計數', () => {
    const rows = [row('a', '無效', 1), row('b', '有效', 3), row('d', '環境依賴', 2)];
    expect(filterRows(rows, 'usable').map((r) => r.id)).toEqual(['b', 'd']);
    expect(filterRows(rows, 'other').map((r) => r.id)).toEqual(['a']);
    expect(counts(rows)['有效']).toBe(1);
  });
  it('負號統一用 U+2212、0 不帶正負號', () => {
    expect(pctSigned(-0.68)).toBe('−0.68%');
    expect(pctSigned(0.68)).toBe('+0.68%');
    expect(pctSigned(0.001)).toBe('0.00%');
    expect(pctSigned(null)).toBe('—');
    expect(tText(-1.58)).toBe('−1.58');
  });
  it('列摘要（事件型／分組型）', () => {
    expect(rowSummary(row('a', '有效', 2.62, { mean_excess: 0.679, n: 3634 }))).toBe('10 日超額 +0.68%・t 2.62・3,634 筆');
    expect(rowSummary(row('q', '無效', 2.48, { kind: 'quintile', mean_excess: 2.003, n: 55 }))).toBe('Q5−Q1 +2.00%／月・t 2.48・55 個月');
  });
  it('只有樣本範圍受限用琥珀（風險色）', () => {
    expect(verdictTone('樣本範圍受限')).toBe('risk');
    expect(verdictTone('有效')).toBe('strong');
    expect(verdictTone('無效')).toBe('plain');
  });
});
