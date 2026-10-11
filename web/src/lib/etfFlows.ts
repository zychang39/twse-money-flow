/**
 * 主動式 ETF 資金流向（2026-10-10）：1 日／1 週／2 週／1 個月／1 季的跨檔加碼、減碼（etf_flows.json ← pipeline/derive/etf.py flow_periods）。
 * 1 日＝各 ETF 最新一次揭露（與 market.json 的 etf_ranking.items 相同，優先用 market.json）；其餘＝持股日落在最近 N 個交易日內的
 * 每一次揭露加總（同一檔 ETF 期間內的加碼、減碼先抵銷）。佔均額＝金額 ÷（20 日均成交額 × 期間交易日數）。
 */
import type { EtfItem } from '../data/types';
import { fmtNum, md } from './format';

export type FlowPeriodKey = '1d' | '1w' | '2w' | '1m' | '1q';
export const FLOW_PERIODS = [['1d', '1 日'], ['1w', '1 週'], ['2w', '2 週'], ['1m', '1 個月'], ['1q', '1 季']] as const;
export const FLOW_PERIOD_KEYS = FLOW_PERIODS.map(([k]) => k);
export const FLOW_PERIOD_LABEL = Object.fromEntries(FLOW_PERIODS) as Record<FlowPeriodKey, string>;

export interface FlowPeriodData {
  /** 期間第一個交易日（1 日為 null：各 ETF 最新一次揭露） */
  from: string | null;
  to: string | null;
  days: number;
  /** 加碼、減碼合計（億元；全部股票，含未達 0.3 億門檻者）與檔數 */
  add_yi: number;
  reduce_yi: number;
  n_add: number;
  n_reduce: number;
  /** 期間內有揭露的 ETF 檔數 */
  etfs: number;
  items: EtfItem[];
}

export interface EtfFlows {
  date: string | null;
  min_value?: number;
  periods: Partial<Record<FlowPeriodKey, FlowPeriodData>>;
}

const fin = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);

/** 所選期間的資料：1 日優先用 market.json 的 items（同一份計算，頁面一開就有）；其餘用 etf_flows.json。 */
export function periodData(flows: EtfFlows | null | undefined, period: FlowPeriodKey, marketItems?: EtfItem[], marketDate?: string | null): FlowPeriodData | null {
  const p = flows?.periods?.[period];
  if (period === '1d' && marketItems?.length) {
    const add = marketItems.filter((x) => x.dir === 'add');
    const red = marketItems.filter((x) => x.dir === 'reduce');
    const sum = (xs: EtfItem[]) => xs.reduce((a, x) => a + (fin(x.value_yi) ? x.value_yi : 0), 0);
    return p ?? { from: null, to: marketDate ?? null, days: 1, add_yi: sum(add), reduce_yi: sum(red), n_add: add.length, n_reduce: red.length, etfs: 0, items: marketItems };
  }
  return p ?? null;
}

/** 1 日用 market.json 的 items（與 etf_flows.json 的 1 日相同）；其他期間用 etf_flows.json */
export function periodItems(data: FlowPeriodData | null, period: FlowPeriodKey, marketItems?: EtfItem[]): EtfItem[] {
  if (period === '1d' && marketItems?.length) return marketItems;
  return data?.items ?? [];
}

/** 期間文字：1 日「持股日 10/8」；其他「9/11–10/8」 */
export function spanLabel(d: FlowPeriodData | null): string {
  if (!d || !d.to) return '';
  return d.from ? `${md(d.from)}–${md(d.to)}` : `持股日 ${md(d.to)}`;
}

/** 億元，帶正負號：+178 億、−9.47 億；≥ 100 不帶小數、≥ 10 一位、其餘兩位 */
export function yi(v: number | null | undefined, sign = true): string {
  if (!fin(v)) return '—';
  const a = Math.abs(v);
  return `${sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : ''}${fmtNum(a, a >= 100 ? 0 : a >= 10 ? 1 : 2)} 億`;
}

/** 一行摘要：「加碼 +178 億（78 檔）・減碼 −370 億（85 檔）」 */
export function flowSummary(d: FlowPeriodData | null): string {
  if (!d) return '資料累積中';
  if (!d.n_add && !d.n_reduce) return '這段期間沒有跨檔的加碼或減碼';
  return `加碼 ${yi(d.add_yi)}（${fmtNum(d.n_add, 0)} 檔）・減碼 ${yi(d.reduce_yi)}（${fmtNum(d.n_reduce, 0)} 檔）`;
}

/**
 * 圖上的列：加碼（金額大到小）在上、減碼（流出最多在最底）在下；總列數 slots 依螢幕高度決定，
 * 兩邊各一半，一邊不足時另一邊補上。
 */
export function chartRows(items: EtfItem[], slots: number): { adds: EtfItem[]; reduces: EtfItem[]; max: number } {
  const v = (x: EtfItem) => (fin(x.value_yi) ? x.value_yi : 0);
  const adds = items.filter((x) => x.dir === 'add' && v(x) > 0).sort((a, b) => v(b) - v(a));
  const reduces = items.filter((x) => x.dir === 'reduce' && v(x) < 0).sort((a, b) => v(a) - v(b));
  const half = Math.ceil(slots / 2);
  let na = Math.min(adds.length, half);
  const nr = Math.min(reduces.length, slots - na);
  na = Math.min(adds.length, slots - nr);
  const a = adds.slice(0, na);
  const r = reduces.slice(0, nr).reverse(); // 流出最多的在最底
  const max = Math.max(1e-9, ...[...a, ...r].map((x) => Math.abs(v(x))));
  return { adds: a, reduces: r, max };
}
