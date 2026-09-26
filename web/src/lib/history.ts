/** 個股歷史 → 圖表資料（原始／還原）。純函式，可測。 */
import type { StockHistory } from '../data/types';

export type PriceMode = 'raw' | 'adj';

export interface Ohlc { time: string; open: number; high: number; low: number; close: number }

export function toOhlc(h: StockHistory, mode: PriceMode): Ohlc[] {
  const out: Ohlc[] = [];
  for (let i = 0; i < h.d.length; i++) {
    const [o, hi, l, c] = [h.o[i], h.h[i], h.l[i], h.c[i]];
    if (c === null || c === undefined) continue;
    const f = mode === 'adj' ? h.af[i] ?? 1 : 1;
    const open = (o ?? c) * f;
    const close = c * f;
    out.push({ time: h.d[i], open, high: Math.max(open, close, (hi ?? c) * f), low: Math.min(open, close, (l ?? c) * f), close });
  }
  return out;
}

export function adjClose(h: StockHistory): (number | null)[] {
  return h.c.map((c, i) => (c === null ? null : c * (h.af[i] ?? 1)));
}

export function series(h: StockHistory, key: keyof StockHistory): { time: string; value: number }[] {
  const arr = h[key] as (number | null)[] | undefined;
  if (!Array.isArray(arr)) return [];
  const out: { time: string; value: number }[] = [];
  arr.forEach((v, i) => {
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push({ time: h.d[i], value: v });
  });
  return out;
}

export function volumeSeries(h: StockHistory, up: string, down: string): { time: string; value: number; color: string }[] {
  return h.d.map((t, i) => {
    const c = h.c[i] ?? 0;
    const o = h.o[i] ?? c;
    return { time: t, value: h.v[i] ?? 0, color: c >= o ? up : down };
  });
}

/** 簡單移動平均（n 日；不足 n 日為 null）。 */
export function sma(values: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let count = 0;
  const q: (number | null)[] = [];
  for (const v of values) {
    q.push(v);
    if (v !== null) { sum += v; count++; }
    if (q.length > n) {
      const old = q.shift();
      if (old !== null && old !== undefined) { sum -= old; count--; }
    }
    out.push(q.length === n && count === n ? sum / n : null);
  }
  return out;
}
