/** 期間選擇器（1D～ALL）：依日期切出區間。基準點＝區間開始前最後一個交易日的收盤，與漲跌計算一致。 */

export type Period = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | '10Y' | 'ALL';
export const PERIODS: Period[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL'];
/** 今晚頁：只有盤後日資料，1D 只是兩點直線，期間選擇器從 1W 開始；預設 3M。 */
export const TONIGHT_PERIODS: Period[] = ['1W', '1M', '3M', 'YTD', '1Y', 'ALL'];
export const TONIGHT_DEFAULT_PERIOD: Period = '3M';
/** 個股頁：同樣只有日資料，移除 1D；預設 1Y（v3）。 */
export const STOCK_PERIODS: Period[] = ['1W', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL'];
export const STOCK_DEFAULT_PERIOD: Period = '1Y';
export const PERIOD_LABEL: Record<Period, string> = {
  '1D': '今日',
  '1W': '近 1 週',
  '1M': '近 1 個月',
  '3M': '近 3 個月',
  YTD: '今年以來',
  '1Y': '近 1 年',
  '5Y': '近 5 年',
  '10Y': '近 10 年',
  ALL: '全部期間',
};
export const PERIOD_NAME: Record<Period, string> = { '1D': '1 日', '1W': '1 週', '1M': '1 個月', '3M': '3 個月', YTD: '今年以來', '1Y': '1 年', '5Y': '5 年', '10Y': '10 年', ALL: '全部' };

function shiftDate(iso: string, months: number, days = 0): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (months) d.setUTCMonth(d.getUTCMonth() - months);
  if (days) d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 最後一個 ≤ target 的索引；沒有則 -1。dates 需遞增。 */
export function lastIndexOnOrBefore(dates: string[], target: string): number {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** 區間起點（基準）索引。資料不足時回傳 0，並以 truncated 標示。 */
export function periodStart(dates: string[], p: Period): { start: number; truncated: boolean } {
  const n = dates.length;
  if (n < 2) return { start: 0, truncated: true };
  const last = dates[n - 1];
  let target: string;
  switch (p) {
    case '1D': return { start: n - 2, truncated: false };
    case '1W': target = shiftDate(last, 0, 7); break;
    case '1M': target = shiftDate(last, 1); break;
    case '3M': target = shiftDate(last, 3); break;
    case '1Y': target = shiftDate(last, 12); break;
    case '5Y': target = shiftDate(last, 60); break;
    case '10Y': target = shiftDate(last, 120); break;
    case 'YTD': target = `${Number(last.slice(0, 4)) - 1}-12-31`; break;
    case 'ALL': return { start: 0, truncated: false };
  }
  const idx = lastIndexOnOrBefore(dates, target);
  if (idx < 0) return { start: 0, truncated: true };
  return { start: Math.min(idx, n - 2), truncated: false };
}

export interface Window { dates: string[]; values: number[]; truncated: boolean }

/** 前值補齊（開頭的空值用第一個有效值），圖表不斷線。 */
export function fillForward(values: (number | null | undefined)[]): number[] | null {
  const first = values.find((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (first === undefined) return null;
  let prev = first;
  return values.map((v) => (v !== null && v !== undefined && Number.isFinite(v) ? (prev = v) : prev));
}

export function sliceWindow(dates: string[], values: (number | null)[], p: Period): Window | null {
  const filled = fillForward(values);
  if (!filled || !dates.length) return null;
  const { start, truncated } = periodStart(dates, p);
  return { dates: dates.slice(start), values: filled.slice(start), truncated };
}

export type Dir = 'up' | 'down' | 'flat';
export function change(values: number[], at = values.length - 1): { abs: number; pct: number | null; dir: Dir } {
  const base = values[0];
  const v = values[at];
  const abs = v - base;
  const pct = base ? (abs / base) * 100 : null;
  const dir: Dir = Math.abs(abs) < 1e-9 ? 'flat' : abs > 0 ? 'up' : 'down';
  return { abs, pct, dir };
}

/** 超過個股檔（約 4.5 年）的期間：需要長歷史股價檔。 */
export const LONG_PERIODS: Period[] = ['5Y', '10Y', 'ALL'];
/** 週線取樣的期間（v3 M5：10Y、ALL 點數太多，改為每週最後一個交易日）。 */
export const WEEKLY_PERIODS: Period[] = ['10Y', 'ALL'];

/** ISO 週的鍵（該週星期一的日期）。 */
export function weekKey(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 星期一＝0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * 週線取樣：保留第一點（區間基準）與每週最後一個交易日（最後一週即最新一天），漲跌計算不受影響。
 * 回傳保留的索引，讓還原價與原始價用同一組點。
 */
export function weeklyIndices(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < dates.length; i++) {
    const last = i === dates.length - 1 || weekKey(dates[i + 1]) !== weekKey(dates[i]);
    if (i === 0 || last) out.push(i);
  }
  return out;
}

export function pick<T>(a: T[], idx: number[]): T[] {
  return idx.map((i) => a[i]);
}
