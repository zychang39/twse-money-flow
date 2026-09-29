/**
 * 個股主角走勢的兩組價格（M5）：還原價（收盤 × 還原因子）與原始價（官方收盤），同一組日期、同一組取樣點。
 * 頁面依使用者選的基準取其中一組，主角數字、走勢線、今日／期間漲跌、區間報酬、成本線都用同一組。純函式。
 */
import { WEEKLY_PERIODS, fillForward, pick, sliceWindow, weeklyIndices, type Period, type Window } from './periods';
import type { RangeBasis } from './rangeReturn';

export interface HeroWindows { adj: Window | null; raw: Window | null }

export function heroWindows(d: string[], c: (number | null)[], af: number[], period: Period): HeroWindows {
  const adjValues = c.map((x, i) => (x === null ? null : x * (af[i] ?? 1)));
  let adj = sliceWindow(d, adjValues, period);
  let raw = sliceWindow(d, c, period);
  if (adj && raw && WEEKLY_PERIODS.includes(period)) {
    // 兩組用同一組週線取樣點（以還原價的日期為準），切換時點數與日期完全相同；
    // 取樣前記下實際的交易日數（#9：「資料累積中」要寫交易日數，不是週線的點數）
    const span = { days: adj.dates.length, since: adj.dates[0] };
    const idx = weeklyIndices(adj.dates);
    adj = { ...adj, dates: pick(adj.dates, idx), values: pick(adj.values, idx), span };
    raw = { ...raw, dates: pick(raw.dates, idx), values: pick(raw.values, idx), span };
  }
  return { adj, raw };
}

/**
 * 為兩組視窗附上日資料（#3）：個股檔（h）的日收盤，還原與原始各一組；10Y／ALL 的視窗來自長歷史檔並經週線取樣，
 * 「今日」仍以個股檔的最後兩個交易日計算。
 */
export function withDaily(ws: HeroWindows, d: string[], c: (number | null)[], af: number[]): HeroWindows {
  const adjDaily = fillForward(c.map((x, i) => (x === null ? null : x * (af[i] ?? 1))));
  const rawDaily = fillForward(c);
  return {
    adj: ws.adj && adjDaily ? { ...ws.adj, daily: { dates: d, values: adjDaily } } : ws.adj,
    raw: ws.raw && rawDaily ? { ...ws.raw, daily: { dates: d, values: rawDaily } } : ws.raw,
  };
}

export function windowFor(ws: HeroWindows, basis: RangeBasis): Window | null {
  return basis === 'raw' ? ws.raw ?? ws.adj : ws.adj;
}

/** 成本線（原始價基準）換算成目前的價格基準：還原時每一天乘上當天的還原因子。 */
export function costLineFor(line: (number | null)[], af: number[], basis: RangeBasis): (number | null)[] {
  return basis === 'raw' ? line : line.map((v, i) => (v === null ? null : v * (af[i] ?? 1)));
}
