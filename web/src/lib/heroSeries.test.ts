import { describe, expect, it } from 'vitest';
import { costLineFor, heroWindows, windowFor } from './heroSeries';
import { rangeReturn } from './rangeReturn';
import { change } from './periods';

// 除息日 2026-07-15（前收 100、現金股利 3 → 參考價 97，因子 0.97）與分割日 2026-08-20（1 拆 4，因子 0.25）
const d = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
const c = [99, 100, 97.5, 98, 200, 204, 51.5, 52];
// af[i]＝i 之後所有事件因子的乘積（最新一日＝1）
const af = [0.97 * 0.25, 0.97 * 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1];

describe('M5 還原／原始切換：主角數字、走勢、區間報酬同一組價格', () => {
  const ws = heroWindows(d, c, af, '1Y'); // 10Y、ALL 會改成週線取樣，這裡用日線
  it('原始價＝官方收盤；還原價＝收盤 × 還原因子，除息日與分割日前後的值', () => {
    expect(windowFor(ws, 'raw')!.values).toEqual(c);
    const adj = windowFor(ws, 'adj')!.values;
    expect(adj[1]).toBeCloseTo(100 * 0.97 * 0.25); // 除息前一日 24.25
    expect(adj[2]).toBeCloseTo(97.5 * 0.25); // 除息日 24.375
    expect(adj[5]).toBeCloseTo(204 * 0.25); // 分割前一日 51
    expect(adj[6]).toBeCloseTo(51.5); // 分割日
    // 最新一日兩者相同（主角數字最新值一樣，只有歷史不同）
    expect(adj[adj.length - 1]).toBe(c[c.length - 1]);
  });
  it('分割日前後：原始價是 −74.8% 的斷層，還原價是 +0.98%', () => {
    const raw = rangeReturn(d, windowFor(ws, 'raw')!.values, 5, 6)!;
    const adj = rangeReturn(d, windowFor(ws, 'adj')!.values, 5, 6)!;
    expect(raw.pct!).toBeCloseTo(((51.5 - 204) / 204) * 100);
    expect(adj.pct!).toBeCloseTo(((51.5 - 51) / 51) * 100);
  });
  it('除息日：原始價跌 2.5 元，還原價漲（相對參考價）', () => {
    const raw = windowFor(ws, 'raw')!.values;
    const adj = windowFor(ws, 'adj')!.values;
    expect(change(raw.slice(1, 3)).abs).toBeCloseTo(-2.5);
    expect(change(adj.slice(1, 3)).dir).toBe('up');
  });
  it('週線取樣：兩組價格的日期與點數完全相同', () => {
    const many = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
    const w = heroWindows(many, many.map((_, i) => 100 + i), many.map(() => 1), '10Y');
    expect(w.raw!.dates).toEqual(w.adj!.dates);
    expect(w.raw!.values.length).toBe(w.adj!.values.length);
  });
  it('成本線跟著基準換算（原始價算的成本線 × 還原因子）', () => {
    const line = [null, 100, 99, 98, 202, 203, 200, 52];
    expect(costLineFor(line, af, 'raw')).toBe(line);
    const adj = costLineFor(line, af, 'adj');
    expect(adj[5]).toBeCloseTo(203 * 0.25);
    expect(adj[7]).toBe(52);
    expect(adj[0]).toBeNull();
  });
});
