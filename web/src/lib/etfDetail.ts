/**
 * 主動式 ETF 詳細頁（2026-10-08）：etf/{code}.json 的持股歷史 → 任兩次揭露之間的權重變化與加碼／減碼分類。
 * 分類與 pipeline/derive/etf.py 的 _pair（§7）同一套：先扣除受益權單位數的變動（申購買回讓每檔等比例增減），
 * 沒有單位數時以兩次都持有的個股股數比中位數估計流量倍數。golden：tests/fixtures/golden/etf_pair.json。
 */
import type { EtfKind } from '../data/types';

export interface EtfDetailRow {
  /** 代號 */ c: string;
  /** 名稱 */ n: string;
  /** 每個持股日的股數（沒有持有＝null） */ s: (number | null)[];
  /** 每個持股日的權重（%） */ w: (number | null)[];
}

export interface EtfDetail {
  code: string;
  name: string;
  issuer: string | null;
  dates: string[];
  units: (number | null)[];
  rows: EtfDetailRow[];
  thresholds: { min_lot: number; flow_tol: number; implied_min_common: number };
  method?: string;
}

export type PairKind = EtfKind | 'hold' | null;

export interface PairRow {
  code: string;
  name: string;
  /** 起日／迄日權重（%；沒有持有＝0；投信沒有揭露權重＝null） */
  w0: number | null;
  w1: number | null;
  /** 權重變化（百分點） */
  dWeight: number | null;
  s0: number;
  s1: number;
  kind: PairKind;
  /** 計入的股數（實際股數變動與超額股數同號時取絕對值較小者） */
  tradeShares: number | null;
}

export interface PairResult {
  basis: 'units' | 'implied' | null;
  flow: number | null;
  rows: PairRow[];
}

const fin = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** §7 分類（與 pipeline flow_kind 相同）。 */
export function flowKind(before: number, now: number, excess: number | null, perUnit: number | null, t: EtfDetail['thresholds']): PairKind {
  if (before <= 0 && now > 0) return 'new';
  if (before > 0 && now <= 0) return 'exit';
  if (before <= 0 && now <= 0) return 'hold';
  if (!fin(excess) || !fin(perUnit)) return null;
  const raw = now - before;
  if (raw >= t.min_lot && excess >= t.min_lot && perUnit >= t.flow_tol) return 'add';
  if (raw <= -t.min_lot && excess <= -t.min_lot && perUnit <= -t.flow_tol) return 'reduce';
  return 'hold';
}

function tradeShares(before: number, now: number, excess: number | null): number | null {
  const raw = now - before;
  if (!fin(excess)) return null;
  if (raw === 0 || excess === 0 || raw > 0 !== excess > 0) return 0;
  return Math.sign(raw) * Math.min(Math.abs(raw), Math.abs(excess));
}

/** 起日 i0 → 迄日 i1（dates 的索引）的每檔個股變動；兩天都沒有持有的個股不列。 */
export function pairChanges(d: EtfDetail, i0: number, i1: number): PairResult {
  const t = d.thresholds;
  const u0 = d.units[i0];
  const u1 = d.units[i1];
  const held = d.rows.filter((r) => fin(r.s[i0]) || fin(r.s[i1]));
  const s0s = held.map((r) => r.s[i0] ?? 0);
  const s1s = held.map((r) => r.s[i1] ?? 0);
  let basis: PairResult['basis'] = null;
  let flow = Number.NaN;
  if (u0 && u1) {
    basis = 'units';
    flow = u1 / u0;
  } else {
    const ratios = s0s.flatMap((a, i) => (a > 0 && s1s[i] > 0 ? [s1s[i] / a] : []));
    if (ratios.length >= t.implied_min_common) {
      basis = 'implied';
      flow = median(ratios);
    }
  }
  const rows = held.map((r, i): PairRow => {
    const a = s0s[i];
    const b = s1s[i];
    let excess: number | null = a > 0 ? b - a * flow : b;
    const perUnit = a > 0 ? b / (a * flow) - 1 : null;
    const kind = flowKind(a, b, fin(excess) ? excess : null, fin(perUnit) ? perUnit : null, t);
    if (a > 0 && b <= 0 && !fin(excess)) excess = -a;
    const w0 = a > 0 ? r.w[i0] : 0;
    const w1 = b > 0 ? r.w[i1] : 0;
    return {
      code: r.c, name: r.n, w0, w1,
      dWeight: fin(w0) && fin(w1) ? w1 - w0 : null,
      s0: a, s1: b, kind,
      tradeShares: tradeShares(a, b, fin(excess) ? excess : null),
    };
  });
  return { basis, flow: Number.isFinite(flow) ? flow : null, rows };
}

/** 有實際買賣的分類（不含「不變」與無法判定）。 */
export const TRADED: PairKind[] = ['new', 'add', 'reduce', 'exit'];

/** 依權重變化排序：增加最多在上、減少最多在下（同圖：+5.2pp … −2.9pp）；缺值排最後。 */
export function sortByChange(rows: PairRow[]): PairRow[] {
  const key = (r: PairRow) => (fin(r.dWeight) ? r.dWeight : Number.NEGATIVE_INFINITY);
  return [...rows].sort((a, b) => key(b) - key(a) || a.code.localeCompare(b.code));
}

/** 快速區間：往回幾次揭露（null＝全部）；超出可用天數時取最早的一天。 */
export function quickRange(n: number, back: number | null): [number, number] {
  const end = n - 1;
  return [back === null ? 0 : Math.max(0, end - back), end];
}

/** 迄日的持股（依權重由大到小）；沒有權重時依股數。 */
export function holdingsAt(d: EtfDetail, i: number): { code: string; name: string; weight: number | null; shares: number }[] {
  return d.rows
    .filter((r) => fin(r.s[i]))
    .map((r) => ({ code: r.c, name: r.n, weight: r.w[i], shares: r.s[i] as number }))
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1) || b.shares - a.shares);
}
