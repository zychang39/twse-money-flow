import { describe, expect, it } from 'vitest';
import { buildReport, conditionsMask, netReturn, newTriggers, nonOverlapping, run, stats, summarize, type Panel } from './backtest';

const T = 12;
const DATES = Array.from({ length: T }, (_, i) => `2026-01-${String(5 + i).padStart(2, '0')}`);

function panel(opens: (number | null)[], opts: Partial<{ close: (number | null)[]; low: (number | null)[]; bench: number[]; blocked: [number, number][]; etf: boolean }> = {}): Panel {
  const close = opts.close ?? opens;
  const low = opts.low ?? opens.map((o, i) => (o === null || close[i] === null ? null : Math.min(o, close[i] as number)));
  return {
    dates: DATES.slice(0, opens.length), codes: ['S'],
    open: opens.map((v) => [v]), close: close.map((v) => [v]), low: low.map((v) => [v]),
    tradable: opens.map((v) => [v === null ? 0 : 1]), blocked: opts.blocked ?? [],
    bench: opts.bench ?? opens.map(() => 100), regimeUp: opens.map(() => true), isEtf: [opts.etf ?? false],
  };
}
const sig = (...days: number[]) => Array.from({ length: T }, (_, t) => [days.includes(t)]);

describe('回測引擎（與 Python 版同規則）', () => {
  it('無前視：T 日訊號、T+1 開盤進場、持有 N 日開盤出場', () => {
    const px = panel([100, 100, 100, 106, 111, 112, 113, 114, 115, 116, 117, 118]);
    const tr = run(sig(2), px, [5], 3).trades[5][0];
    expect(tr.entryDate).toBe(DATES[3]);
    expect(tr.entry).toBe(106);
    expect(tr.exitDate).toBe(DATES[8]);
    expect(tr.gross).toBeCloseTo(115 / 106 - 1);
  });
  it('成本扣除', () => {
    const fee = 0.001425 * 0.6;
    expect(netReturn(0.1, false)).toBeCloseTo((1.1 * (1 - fee - 0.003)) / (1 + fee) - 1, 10);
    expect(netReturn(0.1, true)).toBeCloseTo((1.1 * (1 - fee - 0.001)) / (1 + fee) - 1, 10);
  });
  it('排除：開盤漲停、停牌、處置', () => {
    const px = panel([100, 100, 110, 100, null, 100, 100, 100, 100, 100, 100, 100], { blocked: [[7, 0]] });
    const res = run(sig(1, 3, 6), px, [2], 1);
    expect(res.excluded).toEqual({ limit_up: 1, suspended: 1, disposition: 1, no_future: 0 });
  });
  it('停牌順延出場、下市以最後收盤出場', () => {
    const opens = [100, 100, 100, null, 104, 105, null, null, null, null, null, null];
    const closes = [100, 100, 101, null, 104, 106, null, null, null, null, null, null];
    const res = run(sig(1), panel(opens, { close: closes }), [1, 4], 1);
    expect(res.trades[1][0].exitDate).toBe(DATES[4]);
    expect(res.trades[4][0].delisted).toBe(true);
    expect(res.trades[4][0].exit).toBe(106);
  });
  it('MAE 與超額報酬', () => {
    const lows = [100, 100, 95, 97, 100, 100, 100, 100, 100, 100, 100, 100];
    const bench = [100, 100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
    const tr = run(sig(1), panel(new Array(T).fill(100), { low: lows, bench }), [3], 1).trades[3][0];
    expect(tr.mae).toBeCloseTo(-0.05);
    expect(tr.bench).toBeCloseTo(0.02);
  });
  it('不重疊與統計', () => {
    const opens = Array.from({ length: T }, (_, i) => 100 + i);
    const res = run(sig(0, 1, 2, 5), panel(opens), [3], 2);
    expect(nonOverlapping(res.trades[3]).map((t) => t.signal)).toEqual([DATES[0], DATES[5]]);
    const s = stats(res.trades[3]);
    expect(s.n).toBe(4);
    expect(s.win_rate).toBe(100);
    expect(s.low_reference).toBe(true);
    expect(summarize(res).horizons['3'].non_overlap.n).toBe(2);
  });
  it('條件遮罩', () => {
    const a = [[1, null], [3, 5]];
    expect(conditionsMask([{ field: 'x', op: '>=', value: 2 }], () => a, 2, 2)).toEqual([[false, false], [true, true]]);
    expect(conditionsMask([{ field: 'x', op: '>=', value: 2 }], () => null, 2, 2)).toBeNull();
  });
});

describe('S1／S2／S5：新觸發、資料涵蓋、停損', () => {
  const T = 12;
  const dates = Array.from({ length: T }, (_, i) => `2026-01-${String(i + 5).padStart(2, '0')}`);
  const mk = (opens: number[], lows?: number[], C = 1): Panel => ({
    dates, codes: Array.from({ length: C }, (_, j) => `S${j}`),
    open: opens.map((o) => new Array(C).fill(o)), low: (lows ?? opens).map((l) => new Array(C).fill(l)), close: opens.map((o) => new Array(C).fill(o)),
    tradable: opens.map(() => new Array(C).fill(1)), blocked: [], bench: opens.map(() => 100), regimeUp: opens.map(() => true), isEtf: new Array(C).fill(false),
  });

  it('newTriggers：第一天與前一日無法判斷時都不算', () => {
    const mask = [[true], [true], [false], [true], [true], [true]];
    const ev = [[true], [true], [true], [true], [false], [true]];
    expect(newTriggers(mask, ev).map((r) => r[0])).toEqual([false, false, false, true, false, false]);
  });

  it('buildReport：欄位只有少數股票有資料 → 樣本範圍受限；起始日前不產生訊號', () => {
    const C = 4;
    const px = mk(Array.from({ length: T }, (_, i) => 100 + i), undefined, C);
    // x 欄位只有 S0 有資料，且從第 3 天開始；第 3 天以後 x 交替 1、0
    const x = dates.map((_, t) => Array.from({ length: C }, (_, j) => (j === 0 && t >= 3 ? (t % 2 ? 1 : 0) : null)));
    const rep = buildReport([{ field: 'x', op: '>', value: 0 }], (f) => (f === 'x' ? x : null), px)!;
    expect(rep.coverage.start).toBe(dates[3]);
    expect(rep.coverage.fields[0]).toMatchObject({ stocks: 1, first_date: dates[3] });
    expect(rep.coverage.limited).toBe(true);
    expect(rep.coverage.by_code).toEqual([['S0', rep.signals]]);
    // 第 3 天（x=1）是資料第一天、不算新觸發；之後每次 0 → 1 才算
    expect(rep.first_signal).toBe(dates[5]);
    expect(rep.signals).toBeLessThan(rep.signals_level);
  });

  it('停損：盤中觸及 −7% 以停損價出場；只看時間則持有到期', () => {
    const opens = [100, 100, 99, 97, 96, 95, 94, 93, 92, 91, 90, 89];
    const lows = [100, 99, 98, 92, 95, 94, 93, 92, 91, 90, 89, 88];
    const px = mk(opens, lows);
    const signals = dates.map((_, t) => [t === 0]);
    const stop = run(signals, px, [5], 3, 9.5, 'stop', -7).trades[5][0];
    expect(stop.exitDate).toBe(dates[3]);
    expect(stop.exit).toBeCloseTo(93);
    expect(run(signals, px, [5], 3).trades[5][0].exit).toBe(94);
  });
});
