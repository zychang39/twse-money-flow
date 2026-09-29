/** 個股頁的白話重點：只陳述數據（期間加總、在過去一年的相對位置、估算成本），不給建議。 */
import type { StockHistory } from '../data/types';
import { fmtLotsUnit, fmtPrice } from './format';

/** 滾動 n 日加總；不足 n 日為 null。 */
export function rollingSum(values: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let s = 0, k = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined) { s += v; k++; }
    if (i >= n) { const o = values[i - n]; if (o !== null && o !== undefined) { s -= o; k--; } }
    out.push(i >= n - 1 && k > 0 ? s : null);
  }
  return out;
}

/** 最新值在過去 lookback 筆中的百分位（0–100）。 */
export function percentileOfLast(values: (number | null)[], lookback = 250): number | null {
  const tail = values.slice(-lookback).filter((v): v is number => v !== null && Number.isFinite(v));
  if (tail.length < 40) return null;
  const last = tail[tail.length - 1];
  return Math.round((tail.filter((v) => v <= last).length / tail.length) * 100);
}

export type Who = 'foreign' | 'trust' | 'dealer';
export const WHO_LABEL: Record<Who, string> = { foreign: '外資', trust: '投信', dealer: '自營商' };
const KEY: Record<Who, 'fn' | 'tn' | 'dn'> = { foreign: 'fn', trust: 'tn', dealer: 'dn' };

export function instInsight(h: StockHistory, who: Who): { title: string; lines: string[]; values: (number | null)[]; est: string | null } {
  const arr = (h[KEY[who]] as (number | null)[]) ?? [];
  const sums = rollingSum(arr, 20);
  const s20 = sums[sums.length - 1];
  const pct = percentileOfLast(sums);
  const name = WHO_LABEL[who];
  const title = s20 === null ? `${name}資料不足` : `${name}近 20 日淨${s20 >= 0 ? '買' : '賣'} ${fmtLotsUnit(s20, false)}`;
  const lines: string[] = [];
  if (pct !== null && s20 !== null) {
    lines.push(`近 20 日淨買賣超高於過去一年 ${pct}% 的時間${pct >= 80 ? '，屬於偏高的位置' : pct <= 20 ? '，屬於偏低的位置' : ''}。`);
  }
  let streak = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v === null || v === 0) break;
    if (streak === 0) streak = v > 0 ? 1 : -1;
    else if ((v > 0) === (streak > 0)) streak += streak > 0 ? 1 : -1;
    else break;
  }
  if (Math.abs(streak) >= 2) lines.push(`已連續 ${Math.abs(streak)} 日淨${streak > 0 ? '買' : '賣'}超。`);
  let est: string | null = null;
  const cost = (h.cost as Record<string, (number | null)[]> | undefined)?.[`${who}20`];
  const c = cost ? [...cost].reverse().find((v) => v !== null) : null;
  const px = [...h.c].reverse().find((v) => v !== null) ?? null;
  if (c && px) est = `${name} 20 日成本約 ${fmtPrice(c)} 元，現價${px >= c ? '高' : '低'}於成本 ${Math.abs(((px - c) / c) * 100).toFixed(1)}%。`;
  return { title, lines, values: arr.slice(-60), est };
}
