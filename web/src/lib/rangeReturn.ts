/**
 * 兩指區間報酬（v3 M4，仿 Apple 股市）：走勢圖上兩點之間的漲跌金額、報酬率與相隔的交易日數。
 * 預設用還原價（含股利再投入的報酬），可切換成原始價（只看價差）。純函式。
 */
export type RangeBasis = 'adj' | 'raw';
export const RANGE_BASIS_KEY = 'tmf-range-basis';
export const RANGE_BASIS_NAME: Record<RangeBasis, string> = { adj: '還原價（含股利）', raw: '原始價' };
/** 放開後保留結果的時間（毫秒），之後淡出 */
export const RANGE_HOLD_MS = 2000;

export interface RangeResult {
  /** 較早、較晚的索引 */
  from: number;
  to: number;
  fromDate: string;
  toDate: string;
  fromValue: number;
  toValue: number;
  abs: number;
  /** 報酬率 %（起點為 0 → null） */
  pct: number | null;
  /** 相隔的交易日數（索引差） */
  days: number;
  dir: 'up' | 'down' | 'flat';
}

export function rangeReturn(dates: string[], values: number[], a: number, b: number): RangeResult | null {
  const n = Math.min(dates.length, values.length);
  if (n < 2) return null;
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, Math.round(i)));
  const from = Math.min(clamp(a), clamp(b));
  const to = Math.max(clamp(a), clamp(b));
  const v0 = values[from];
  const v1 = values[to];
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
  const abs = v1 - v0;
  return {
    from, to, fromDate: dates[from], toDate: dates[to], fromValue: v0, toValue: v1, abs,
    pct: v0 ? (abs / v0) * 100 : null,
    days: to - from,
    dir: Math.abs(abs) < 1e-9 ? 'flat' : abs > 0 ? 'up' : 'down',
  };
}

export function getRangeBasis(): RangeBasis {
  try {
    return localStorage.getItem(RANGE_BASIS_KEY) === 'raw' ? 'raw' : 'adj';
  } catch {
    return 'adj';
  }
}

export function setRangeBasis(b: RangeBasis): void {
  try {
    localStorage.setItem(RANGE_BASIS_KEY, b);
  } catch {
    /* 無痕模式 */
  }
}

/** 「2026/9/1」 */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(0, 4))}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}
