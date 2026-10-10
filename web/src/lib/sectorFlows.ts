/**
 * 族群大戶週流向（2026-10-10；sector_flows.json ← pipeline/derive/whaleflow.py，METHODOLOGY §4.7.7）。
 * 大戶＝持股市值 ≥ 5,000 萬的集保戶；流向＝大戶占比變化 × 集保總股數 × 收盤價（億元），一檔只算一次（官方產業、主要細產業）。
 * 這裡只做排序、加總與文字：1 週＝最新一週；4 週＝最近 4 週加總。
 */
import { fmtNum, md } from './format';

export interface FlowGroup {
  name: string;
  path: string[];
  /** 有集保資料的成員數 */
  m: number;
  /** 各週有資料的成員數 */
  n: number[];
  /** 各週流向（億元）；f[i] 對應 weeks[i + 1] */
  f: (number | null)[];
  /** 成員代號 */
  c: string[];
}

export interface SectorFlows {
  date: string;
  /** 週別（第一個是比較基準週） */
  weeks: string[];
  min_value: number;
  max_share_change: number;
  official: Record<string, FlowGroup>;
  fine: Record<string, FlowGroup>;
  total: (number | null)[];
  /** 代號 → [名稱, 各週流向（億元）, 最新一週是否以千張大戶代替（股價 < 50 元）] */
  stocks: Record<string, [string, (number | null)[], number]>;
}

export type FlowLayer = 'official' | 'fine';
export type FlowPeriod = '1w' | '4w';
export type FlowDir = 'in' | 'out';
export const FLOW_LAYER_NAME: Record<FlowLayer, string> = { official: '官方產業', fine: '細產業' };
export const FLOW_PERIOD_NAME: Record<FlowPeriod, string> = { '1w': '1 週', '4w': '4 週' };
export const FLOW_WEEKS: Record<FlowPeriod, number> = { '1w': 1, '4w': 4 };

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 最近 k 週加總（億元）；k 週都沒有資料 → null */
export function lastSum(f: (number | null)[], k: number): number | null {
  const tail = f.slice(-k).filter(ok);
  return tail.length ? Math.round(tail.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

export interface FlowRow {
  id: string;
  name: string;
  /** 上層路徑（細產業：產業鏈 › 類別） */
  crumb: string;
  /** 所選期間的流向（億元） */
  v: number;
  /** 另一個期間（1 週 ↔ 4 週）的流向，給副資訊 */
  other: number | null;
  m: number;
  /** 最新一週有資料的成員數 */
  n: number;
}

/** 一層的全部族群（有流向者），依流向由大到小 */
export function flowRows(data: SectorFlows, layer: FlowLayer, period: FlowPeriod): FlowRow[] {
  const k = FLOW_WEEKS[period];
  const k2 = FLOW_WEEKS[period === '1w' ? '4w' : '1w'];
  const out: FlowRow[] = [];
  for (const [id, g] of Object.entries(data[layer] ?? {})) {
    const v = lastSum(g.f, k);
    if (v === null) continue;
    out.push({ id, name: g.name, crumb: g.path.slice(0, -1).join(' › '), v, other: lastSum(g.f, k2), m: g.m, n: g.n[g.n.length - 1] ?? 0 });
  }
  return out.sort((a, b) => b.v - a.v);
}

/** 流入（大到小）與流出（流出最多在前） */
export function splitFlows(rows: FlowRow[]): { inflow: FlowRow[]; outflow: FlowRow[] } {
  return {
    inflow: rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v),
    outflow: rows.filter((r) => r.v < 0).sort((a, b) => a.v - b.v),
  };
}

/** 比較區間：1 週＝前一週 → 最新一週；4 週＝4 週前 → 最新一週 */
export function flowSpan(data: SectorFlows, period: FlowPeriod): { from: string; to: string } | null {
  const w = data.weeks;
  const k = FLOW_WEEKS[period];
  if (w.length < k + 1) return null;
  return { from: w[w.length - 1 - k], to: w[w.length - 1] };
}

export function spanText(data: SectorFlows, period: FlowPeriod): string {
  const s = flowSpan(data, period);
  return s ? `${md(s.from)} → ${md(s.to)}` : '資料不足';
}

export interface Contributor { code: string; name: string; v: number; low: boolean }

/** 族群內各檔的流向（億元），流入在前；沒有資料的成員不列 */
export function contributors(data: SectorFlows, g: FlowGroup, period: FlowPeriod): Contributor[] {
  const k = FLOW_WEEKS[period];
  const out: Contributor[] = [];
  for (const c of g.c) {
    const s = data.stocks[c];
    if (!s) continue;
    const v = lastSum(s[1], k);
    if (v === null) continue;
    out.push({ code: c, name: s[0], v, low: s[2] === 1 });
  }
  return out.sort((a, b) => b.v - a.v);
}

/** 億元：+12.3 億、−0.05 億；絕對值 ≥ 100 億不帶小數 */
export function yiText(v: number | null | undefined, sign = true): string {
  if (!ok(v)) return '—';
  const a = Math.abs(v);
  const s = fmtNum(a, a >= 100 ? 0 : a >= 1 ? 1 : 2);
  return `${sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : ''}${s} 億`;
}
