/**
 * 興櫃股票（2026-11-14，DECISIONS #465）：議價交易，沒有開盤價、收盤價，價格一律用「當日均價」；
 * 沒有三大法人、融資融券、估值、月營收以外的衍生指標，所以不計分、不進排行與選股，只能搜尋、看走勢、加自選。
 * 這裡把個股檔整理成個股頁要顯示的幾個數字（純函式）。
 */
import type { StockHistory } from '../data/types';

export const isEsb = (h: { market?: string } | null | undefined): boolean => h?.market === 'esb';

export interface EsbFacts {
  date: string;
  avg: number;
  high: number | null;
  low: number | null;
  /** 成交張數 */
  lots: number | null;
  /** 成交金額（百萬元） */
  valueM: number | null;
  /** 近 n 個「有成交日」的均價漲跌幅（%）；資料不夠為 null */
  ret: { n: number; pct: number | null }[];
  /** 現有資料期間內的最高、最低均價 */
  rangeHigh: number;
  rangeLow: number;
  /** 有成交的天數與第一天 */
  days: number;
  since: string;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function esbFacts(h: StockHistory): EsbFacts | null {
  const idx: number[] = [];
  for (let i = 0; i < h.d.length; i++) if (num(h.c[i]) && (h.c[i] as number) > 0) idx.push(i);
  if (!idx.length) return null;
  const at = (k: number) => h.c[idx[k]] as number;
  const li = idx[idx.length - 1];
  const last = at(idx.length - 1);
  const closes = idx.map((i) => h.c[i] as number);
  const ret = [5, 20, 60].map((n) => {
    const k = idx.length - 1 - n;
    return { n, pct: k >= 0 && at(k) > 0 ? (last / at(k) - 1) * 100 : null };
  });
  const v = h.v[li], val = h.val[li];
  return {
    date: h.d[li], avg: last,
    high: num(h.h[li]) ? (h.h[li] as number) : null,
    low: num(h.l[li]) ? (h.l[li] as number) : null,
    lots: num(v) ? v : null, // 個股檔的 v 已經是張、val 已經是百萬元
    valueM: num(val) ? val : null,
    ret,
    rangeHigh: Math.max(...closes), rangeLow: Math.min(...closes),
    days: idx.length, since: h.d[idx[0]],
  };
}
