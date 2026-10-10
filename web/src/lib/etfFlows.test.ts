// 2026-10-10：主動式 ETF 資金流向（期間資料、圖的列、文字）
import { describe, expect, it } from 'vitest';
import type { EtfItem } from '../data/types';
import { chartRows, flowSummary, periodData, periodItems, spanLabel, yi } from './etfFlows';

const it_ = (code: string, v: number): EtfItem => ({ code, name: code, dir: v > 0 ? 'add' : 'reduce', kind: v > 0 ? 'add' : 'reduce', value_yi: v, pct_avg20: null, pct_mcap: null, etfs_same_dir: 1, etfs: [] });

describe('資金流向', () => {
  it('億元文字：≥ 100 不帶小數、≥ 10 一位、其餘兩位；負號用全形減號', () => {
    expect(yi(197.6)).toBe('+198 億');
    expect(yi(-63.24)).toBe('−63.2 億');
    expect(yi(9.47)).toBe('+9.47 億');
    expect(yi(-9.47, false)).toBe('9.47 億');
    expect(yi(null)).toBe('—');
  });
  it('圖的列：兩邊各一半，一邊不足時另一邊補；加碼大到小、減碼流出最多在最底；同一刻度', () => {
    const items = [it_('a', 5), it_('b', 9), it_('c', 1), it_('x', -2), it_('y', -12)];
    const r = chartRows(items, 4);
    expect(r.adds.map((x) => x.code)).toEqual(['b', 'a']);
    expect(r.reduces.map((x) => x.code)).toEqual(['x', 'y']);
    expect(r.max).toBe(12);
    const few = chartRows([...items, it_('d', 0.5), it_('e', 0.4)], 8); // 減碼只有 2 檔 → 加碼可以放 5 檔
    expect(few.adds).toHaveLength(5);
    expect(few.reduces).toHaveLength(2);
  });
  it('1 日優先用 market.json 的 items；沒有 etf_flows 時由 items 算合計；其他期間沒有資料回 null', () => {
    const items = [it_('a', 2), it_('b', -1.5)];
    const d = periodData(null, '1d', items, '2026-10-08')!;
    expect([d.add_yi, d.reduce_yi, d.n_add, d.n_reduce, d.to]).toEqual([2, -1.5, 1, 1, '2026-10-08']);
    expect(periodItems(d, '1d', items)).toBe(items);
    expect(periodData(null, '1q', items)).toBeNull();
    expect(spanLabel(d)).toBe('持股日 10/8');
    expect(spanLabel({ ...d, from: '2026-07-15' })).toBe('7/15–10/8');
    expect(flowSummary(d)).toBe('加碼 +2.00 億（1 檔）・減碼 −1.50 億（1 檔）');
    expect(flowSummary(null)).toBe('資料累積中');
  });
});
