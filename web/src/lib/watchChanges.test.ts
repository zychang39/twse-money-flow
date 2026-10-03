import { describe, expect, it } from 'vitest';
import type { StockRow } from '../data/types';
import { makeSnapshot } from './changes';
import { WATCH_SCOPE, snapshotRows, watchAnswer, watchRows, watchSummary } from './watchChanges';

const row = (code: string, extra: Partial<StockRow> = {}): StockRow => ({
  code, name: code, flags: [], close: 100, change: 0, change_pct: 0, composite: 50, foreign_streak: 0, trust_streak: 0, margin_balance: 1000, margin_change: 0,
  volume_lots: 1000, foreign_net_lots: 0, trust_net_lots: 0, ...extra,
}) as StockRow;

const byCode = new Map([
  row('A', { close: 110 }), // 自上次 +10%
  row('B', { close: 101 }), // +1%：低於門檻
  row('C', { close: 90 }),  // −10%，但同時持有 → 不算自選變化
  row('D', { close: 120 }), // +20%
].map((r) => [r.code, r]));
const watch = [{ code: 'A' }, { code: 'B' }, { code: 'C' }, { code: 'D' }];
const trades = [{ code: 'C', status: 'open' as const }, { code: 'A', status: 'closed' as const }];
// 上次查看時全部都是 100
const snap = makeSnapshot([...byCode.values()].map((r) => ({ ...r, close: 100 })), '2026-10-01', '2026-10-01T13:30:00Z');

describe('自選顯著變化（M1-1）：今晚頁與我的股票頁同一個數字', () => {
  it('同一個快照範圍', () => {
    expect(WATCH_SCOPE).toBe('watch');
  });
  it('watchRows 排除同時持有的股票、依自選順序；snapshotRows 含持股（兩頁都能比較）', () => {
    expect(watchRows(watch, trades, byCode).map((r) => r.code)).toEqual(['A', 'B', 'D']);
    expect(snapshotRows(watch, trades, byCode).map((r) => r.code).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(watchRows(watch, trades, undefined)).toEqual([]);
  });
  it('兩頁用同一組列與同一個快照 → 顯著變化檔數一致（2 檔），基準文字標出上次查看時間', () => {
    const rows = watchRows(watch, trades, byCode);
    const tonight = watchSummary(rows, snap);
    const mine = watchSummary(watchRows(watch, trades, byCode), snap);
    expect(tonight.significant.map((c) => c.code).sort()).toEqual(['A', 'D']);
    expect(mine.significant.length).toBe(tonight.significant.length);
    expect(tonight.quiet.map((c) => c.code)).toEqual(['B']);
    expect(tonight.basis).toBe('自上次查看（10/1 21:30）以來');
    expect(watchAnswer(tonight, watch.length)).toBe('2 檔有顯著變化');
  });
  it('沒有快照（第一次使用）：基準是前一交易日，用日漲跌判斷', () => {
    const s = watchSummary(watchRows(watch, trades, byCode), null);
    expect(s.basis).toBe('較前一交易日');
    expect(s.significant).toEqual([]);
    expect(watchAnswer(s, watch.length)).toBe('沒有顯著變化');
    expect(watchAnswer(s, 0)).toBe('還沒有自選股');
  });
});
