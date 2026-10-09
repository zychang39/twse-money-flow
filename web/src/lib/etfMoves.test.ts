import { describe, expect, it } from 'vitest';
import { mergeMoves } from './etfList';
import { moveSummary, moveValueSub } from '../pages/Etf';
import type { EtfItem } from '../data/types';

const item = (o: Partial<EtfItem>): EtfItem => ({ code: '2330', name: '台積電', dir: 'add', kind: 'add', value_yi: 2.5, pct_avg20: 4.8, pct_mcap: 0.03, etfs_same_dir: 1, etfs: [], ...o });

describe('持股變動一張圖（2026-10-09）', () => {
  it('加碼在上、減碼在下（最大的減碼在最底），預設各前 n 檔', () => {
    const add = [5, 4, 3, 2, 1];
    const reduce = [-9, -8, -7];
    expect(mergeMoves(add, reduce, 2, false)).toEqual({ rows: [5, 4, -8, -9], folded: 4 });
    expect(mergeMoves(add, reduce, 10, false)).toEqual({ rows: [5, 4, 3, 2, 1, -7, -8, -9], folded: 0 });
    expect(mergeMoves(add, reduce, 2, true).rows).toHaveLength(8);
    expect(mergeMoves([], [], 10, false)).toEqual({ rows: [], folded: 0 });
  });

  it('摘要與數值下方一行', () => {
    expect(moveSummary(17, 14, 'value')).toBe('加碼 17 檔・減碼 14 檔（橫條＝金額）');
    expect(moveSummary(1, 0, 'pct_avg20')).toBe('加碼 1 檔・減碼 0 檔（橫條＝佔均額）');
    expect(moveValueSub(item({}), 'value')).toBe('佔均額 4.8%');
    expect(moveValueSub(item({ dir: 'reduce', value_yi: -2.5, pct_avg20: -4.8 }), 'pct_avg20')).toBe('2.50 億');
    expect(moveValueSub(item({ kind: 'new' }), 'value')).toBe('新增');
    expect(moveValueSub(item({ pct_avg20: null }), 'value')).toBeUndefined();
  });
});
