/** 目前持股組合的價值走勢：以現有股數 × 還原收盤價計算（除權息不造成斷層；最新一日等於實際市值）。 */
import type { StockHistory } from '../data/types';
import type { Trade } from '../db/db';
import { fillForward } from './periods';

export function holdingsSeries(open: Trade[], histories: (StockHistory | null)[]): { dates: string[]; values: number[] } | null {
  const hs = histories.filter((h): h is StockHistory => !!h && h.d.length > 1);
  if (!open.length || !hs.length) return null;
  const shares = new Map<string, number>();
  for (const t of open) shares.set(t.code, (shares.get(t.code) ?? 0) + t.shares);
  const dates = [...new Set(hs.flatMap((h) => h.d))].sort();
  const values = new Array<number>(dates.length).fill(0);
  for (const h of hs) {
    const n = shares.get(h.code);
    if (!n) continue;
    const at = new Map(h.d.map((d, i) => [d, h.c[i] === null ? null : (h.c[i] as number) * (h.af[i] ?? 1)]));
    const aligned = fillForward(dates.map((d) => at.get(d) ?? null));
    if (!aligned) continue;
    aligned.forEach((v, i) => (values[i] += v * n));
  }
  return { dates, values };
}
