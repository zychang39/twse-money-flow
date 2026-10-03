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

describe('有效訊號面板', () => {
  it('只列有效與環境依賴的事件型指標，依 t 排序，並判斷狀態', async () => {
    const { panelItems, panelSummary } = await import('./evidence');
    const rows = [
      row('a', '有效', 2.6, { h: { '10': { mean_excess: 0.68 } } }),
      row('b', '環境依賴', 3.1),
      row('c', '無效', 5),
      row('q', '有效', 4, { kind: 'quintile' }),
    ];
    const today = { date: '2026-09-24', tests: { a: { t: { '2330': '2026-09-22' }, near: [] }, b: { t: {}, near: ['2330'] } } };
    const items = panelItems(rows, today, '2330');
    expect(items.map((i) => [i.row.id, i.state])).toEqual([['b', 'near'], ['a', 'triggered']]);
    expect(items[1].date).toBe('2026-09-22');
    expect(items[1].excess).toBe(0.68);
    // 2026-10-02 健檢：沒有策略庫資料 → 判定規則；有 → 「上架策略」＋分級計數（清單含觀察中的策略，不叫「有效指標」）
    expect(panelSummary(items)).toBe('2 個判定可用的指標：觸發 1・接近 1');
    const grades = new Map([['a', { grade: '有效', label: '有效' }], ['b', { grade: '觀察中', label: '觀察中' }]]);
    expect(panelSummary(items, grades)).toBe('2 個上架策略的指標（1 有效・1 觀察中）：觸發 1・接近 1');
    expect(panelSummary(items, grades)).not.toContain('有效指標');
    const off = panelItems(rows, today, '1101');
    expect(off.every((i) => i.state === 'off')).toBe(true);
    expect(panelSummary(off, grades)).toBe('2 個上架策略的指標（1 有效・1 觀察中）都未觸發');
    expect(panelSummary([], grades)).toBe('目前沒有上架的策略');
  });
});

describe('涵蓋率（v3 M0-3）', () => {
  it('百分比與每日平均檔數同一個定義；標示 50%／90% 門檻', async () => {
    const { coverageText, coverageLabel } = await import('./evidence');
    // 887 ÷ 1,320 ＝ 67.2% → 67%
    // 2026-10-02 健檢：不含「涵蓋率」標籤（由呼叫端放）、百分比 2 位小數
    expect(coverageText({ ratio: 887 / 1320, included: 887, universe: 1320 })).toBe('67.20%（每日平均 887／1,320 檔）');
    expect(coverageLabel(0.09)).toBe('樣本範圍受限');
    expect(coverageLabel(0.5)).toBe('部分涵蓋');
    expect(coverageLabel(0.899)).toBe('部分涵蓋');
    expect(coverageLabel(0.9)).toBeNull();
    expect(coverageLabel(undefined)).toBeNull();
  });
});

describe('下市（v3 M1）', () => {
  it('納入股票中已下市檔數、下市事件與保守版本', async () => {
    const { delistText } = await import('./evidence');
    const r = {
      id: 'x', label: 'x', family: '動能', kind: 'event', verdict: '有效', reasons: [],
      coverage: { ratio: 0.93, included: 754, universe: 806, ever_included: 1601 },
      delist: { stocks: 23, events: 4, halted: 1, dl100: { n: 100, mean_excess: 0.52, t: 3.4 } },
    } as EvidenceRow;
    expect(delistText(r)).toBe('期間內曾納入 1,601 檔，其中已下市 23 檔；持有期間下市 4 筆（以最後可成交日收盤出場）；停牌到資料結束 1 筆；保守版本（下市視為 −100%）+0.52%（t 3.40）。');
    expect(delistText({ ...r, delist: { stocks: 0, events: 0, dl100: null } })).toBe('期間內曾納入 1,601 檔，其中已下市 0 檔；沒有持有期間下市的事件。');
  });
});
