/**
 * 個股主角走勢的兩組價格（M5）：還原價（收盤 × 還原因子）與原始價（官方收盤），同一組日期、同一組取樣點。
 * 頁面依使用者選的基準取其中一組，主角數字、走勢線、今日／期間漲跌、區間報酬、成本線都用同一組。純函式。
 */
import { WEEKLY_PERIODS, pick, sliceWindow, weeklyIndices, type Period, type Window } from './periods';
import type { RangeBasis } from './rangeReturn';

export interface HeroWindows { adj: Window | null; raw: Window | null }

export function heroWindows(d: string[], c: (number | null)[], af: number[], period: Period): HeroWindows {
  const adjValues = c.map((x, i) => (x === null ? null : x * (af[i] ?? 1)));
  let adj = sliceWindow(d, adjValues, period);
  let raw = sliceWindow(d, c, period);
  if (adj && raw && WEEKLY_PERIODS.includes(period)) {
    // 兩組用同一組週線取樣點（以還原價的日期為準），切換時點數與日期完全相同
    const idx = weeklyIndices(adj.dates);
    adj = { ...adj, dates: pick(adj.dates, idx), values: pick(adj.values, idx) };
    raw = { ...raw, dates: pick(raw.dates, idx), values: pick(raw.values, idx) };
  }
  return { adj, raw };
}

export function windowFor(ws: HeroWindows, basis: RangeBasis): Window | null {
  return basis === 'raw' ? ws.raw ?? ws.adj : ws.adj;
}

/** 成本線（原始價基準）換算成目前的價格基準：還原時每一天乘上當天的還原因子。 */
export function costLineFor(line: (number | null)[], af: number[], basis: RangeBasis): (number | null)[] {
  return basis === 'raw' ? line : line.map((v, i) => (v === null ? null : v * (af[i] ?? 1)));
}
