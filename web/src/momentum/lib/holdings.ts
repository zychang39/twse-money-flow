/**
 * 持股條件監看（動能流程第六節）。輸入只唯讀取用「我的股票→持股」（代號、成本價、股數、進場日）與個股檔
 * （日期 d、未還原收盤 c、還原因子 af），以及 latest.json 的每檔數值（RS、年增、主族群中位數、D1 位元、今日全通過）。
 *
 * - D1：T−2、T−1、T 三日每日都是 還原收盤 < MA60（pipeline 算好的位元 7＝三日皆是）。
 * - D2：未還原收盤(T) ≤ 0.85 × 成本價 × f(進場日)；f＝進場日（或之前最近交易日）的還原因子；沒有進場日 f＝1 並標示。
 * - M1：RS(R) < 70；M2：最新年增 < 0，或 ≤ 前 3 個月年增平均 − 15 個百分點（3 個月任一無值＝資料不足）；
 *   M3：主族群 3M 中位數(R) < 0。R＝每月 10 日（含）後第一個交易日，顯示到下一個 R；另附 T 日即時值。
 * - 權重提示：單檔市值 ÷ 持股總市值 > 20%（未還原收盤 × 股數）。
 * - 緩衝區：70 ≤ RS(T) < 85 標示「緩衝區（不觸發條件）」。PR1M 轉弱不觸發任何條件。
 * 三態：'pass'＝條件觸發、'ok'＝未觸發、'na'＝資料不足。
 */
export type Tri = 'hit' | 'ok' | 'na';
export interface StockVals {
  rs: number | null; rsR: number | null; yoy: number | null; yoyAvg3: number | null; yoyR: number | null; yoyAvg3R: number | null;
  group: string | null; gm3m: number | null; gm3mR: number | null; d1Bits: number; passToday: boolean; close: number | null;
}
export interface Holding { code: string; name: string; entry: number; shares: number; openedAt: string | null }
export interface Cond { id: string; label: string; result: Tri; value: string; threshold: string; note?: string }
export interface HoldingReport {
  code: string; name: string; conds: Cond[]; weight: number | null; weightAlert: boolean; buffer: boolean; passToday: boolean | null;
  adjustedCost: number | null; costNote: string | null; marketValue: number | null;
}

export const P = { d2: -0.15, m1Rs: 70, m2DropPp: 15, weightAlert: 0.2, buffer: [70, 85] as const, d1Bits: 7 };

/** 解析 latest.json 的 stocks 列（欄位順序見 pipeline web_out.stocks_table）。 */
export function parseVals(row: (number | string | null)[] | undefined): StockVals | null {
  if (!row) return null;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    rs: n(row[0]), rsR: n(row[1]), yoy: n(row[2]), yoyAvg3: n(row[3]), yoyR: n(row[4]), yoyAvg3R: n(row[5]),
    group: typeof row[6] === 'string' ? row[6] : null, gm3m: n(row[7]), gm3mR: n(row[8]),
    d1Bits: n(row[9]) ?? 0, passToday: row[10] === 1, close: n(row[11]),
  };
}

/** 進場日（或之前最近交易日）的還原因子；沒有進場日或早於資料起點＝null。 */
export function factorAt(dates: string[], af: (number | null)[], openedAt: string | null): number | null {
  if (!openedAt) return null;
  let i = -1;
  for (let k = 0; k < dates.length; k++) { if (dates[k] <= openedAt) i = k; else break; }
  if (i < 0) return null;
  const f = af[i];
  return typeof f === 'number' && Number.isFinite(f) && f > 0 ? f : null;
}

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const num = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d));

export function report(h: Holding, v: StockVals | null, close: number | null, fBuy: number | null, totalValue: number | null): HoldingReport {
  const conds: Cond[] = [];
  // D1
  const d1: Tri = v ? ((v.d1Bits & P.d1Bits) === P.d1Bits ? 'hit' : 'ok') : 'na';
  conds.push({ id: 'D1', label: '連續 3 日收在 60 日線下', result: d1, value: v ? `${[1, 2, 4].map((b) => ((v.d1Bits & b) ? '下' : '上')).join('・')}` : '—', threshold: 'T−2、T−1、T 三日皆為收盤 < MA60' });
  // D2
  const f = fBuy ?? 1;
  const adjCost = h.entry > 0 ? h.entry * f : null;
  const costNote = fBuy === null ? '未調整除權息（沒有進場日或進場日早於資料起點）' : null;
  const d2: Tri = adjCost !== null && close !== null ? (close <= adjCost * (1 + P.d2) ? 'hit' : 'ok') : 'na';
  conds.push({ id: 'D2', label: '較調整後成本下跌 15%', result: d2, value: adjCost !== null && close !== null ? pct((close / adjCost - 1) * 100) : '—', threshold: `收盤 ≤ ${(1 + P.d2).toFixed(2)} × 成本 × f(進場日)`, note: costNote ?? undefined });
  // M1
  const m1: Tri = v?.rsR !== null && v?.rsR !== undefined ? (v.rsR < P.m1Rs ? 'hit' : 'ok') : 'na';
  conds.push({ id: 'M1', label: '檢查日 RS 低於 70', result: m1, value: v ? `R 日 ${num(v.rsR, 0)}・今日 ${num(v.rs, 0)}` : '—', threshold: `RS(R) < ${P.m1Rs}` });
  // M2
  let m2: Tri = 'na';
  let m2v = '—';
  if (v && v.yoyR !== null) {
    const a = v.yoyR < 0;
    const b: Tri = v.yoyAvg3R === null ? 'na' : v.yoyR <= v.yoyAvg3R - P.m2DropPp ? 'hit' : 'ok';
    m2 = a ? 'hit' : b;
    m2v = `R 日年增 ${pct(v.yoyR)}（前 3 月平均 ${pct(v.yoyAvg3R)}）・今日 ${pct(v.yoy)}`;
  }
  conds.push({ id: 'M2', label: '營收年增轉弱', result: m2, value: m2v, threshold: `年增 < 0，或 ≤ 前 3 個月平均 − ${P.m2DropPp} 個百分點` });
  // M3
  const m3: Tri = v?.gm3mR !== null && v?.gm3mR !== undefined ? (v.gm3mR < 0 ? 'hit' : 'ok') : 'na';
  conds.push({ id: 'M3', label: '主族群 3M 中位數為負', result: m3, value: v ? `R 日 ${pct(v.gm3mR, 2)}・今日 ${pct(v.gm3m, 2)}` : '—', threshold: '主族群 3M 中位數(R) < 0' });
  const mv = close !== null && h.shares > 0 ? close * h.shares : null;
  const weight = mv !== null && totalValue !== null && totalValue > 0 ? mv / totalValue : null;
  return {
    code: h.code, name: h.name, conds, weight, weightAlert: weight !== null && weight > P.weightAlert,
    buffer: v?.rs !== null && v?.rs !== undefined && v.rs >= P.buffer[0] && v.rs < P.buffer[1],
    passToday: v ? v.passToday : null, adjustedCost: adjCost, costNote, marketValue: mv,
  };
}
