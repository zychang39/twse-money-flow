/**
 * 主動式 ETF 清單（2026-10-09）：依成交值／市值／績效排序，績效可切期間；每列一條橫條（成交值、市值為長條，
 * 績效為以 0 為中心的發散橫條，紅漲綠跌）。資料：market.json active_etfs（pipeline/derive/etf.py active_etfs）。
 */
import type { ActiveEtf } from '../data/types';
import { fmtNum } from './format';

export type EtfListSort = 'value' | 'mcap' | 'ret';
export type EtfPeriod = '1d' | '5d' | '20d' | '60d' | 'ytd' | '1y';

export const LIST_SORTS = [['value', '成交值'], ['mcap', '市值'], ['ret', '績效']] as const;
export const PERIODS = [['1d', '1 日'], ['5d', '5 日'], ['20d', '20 日'], ['60d', '60 日'], ['ytd', '今年'], ['1y', '1 年']] as const;
/** 期間需要的交易日數（今年以來＝今年第一個交易日之前要有收盤）。 */
const PERIOD_DAYS: Record<EtfPeriod, number | null> = { '1d': 1, '5d': 5, '20d': 20, '60d': 60, ytd: null, '1y': 250 };
export const PERIOD_LABEL: Record<EtfPeriod, string> = Object.fromEntries(PERIODS) as Record<EtfPeriod, string>;

const fin = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);

export function retOf(e: ActiveEtf, period: EtfPeriod): number | null {
  const v = e.ret?.[period];
  return fin(v) ? v : null;
}

/** 排序值：成交值（億）、市值（億）、選定期間的報酬（%）。 */
export function metricOf(e: ActiveEtf, sort: EtfListSort, period: EtfPeriod): number | null {
  if (sort === 'value') return fin(e.value_million_20d) ? e.value_million_20d / 100 : null;
  if (sort === 'mcap') return fin(e.mcap_yi) ? e.mcap_yi : null;
  return retOf(e, period);
}

/** 由大到小；缺值排最後（依成交值），不改變原陣列。 */
export function sortEtfs(list: ActiveEtf[], sort: EtfListSort, period: EtfPeriod): ActiveEtf[] {
  const v = (e: ActiveEtf) => metricOf(e, sort, period);
  return [...list].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    if (x === null || y === null) return x === null && y === null ? (b.value_million_20d ?? 0) - (a.value_million_20d ?? 0) : x === null ? 1 : -1;
    return y - x;
  });
}

/** 橫條刻度：同一張圖用同一個刻度（績效取絕對值最大）。 */
export function barMax(list: ActiveEtf[], sort: EtfListSort, period: EtfPeriod): number {
  return Math.max(1e-9, ...list.map((e) => Math.abs(metricOf(e, sort, period) ?? 0)));
}

/** 缺報酬的原因：上市未滿 N 個交易日（不是資料錯誤）。 */
export function missingRetText(e: ActiveEtf, period: EtfPeriod): string {
  const need = PERIOD_DAYS[period];
  const since = e.listed ? `${Number(e.listed.slice(5, 7))}/${Number(e.listed.slice(8, 10))} 上市` : '上市日不明';
  if (need === null) return `今年才上市（${since}）`;
  return `上市未滿 ${need} 個交易日（${since}）`;
}

/** 期間摘要：「20 日：上漲 18 檔・下跌 12 檔・中位數 +1.23%（2 檔上市未滿期間）」。 */
export function periodSummary(list: ActiveEtf[], period: EtfPeriod): string {
  const rs = list.map((e) => retOf(e, period)).filter(fin).sort((a, b) => a - b);
  if (!rs.length) return `${PERIOD_LABEL[period]}：資料累積中`;
  const up = rs.filter((r) => r > 0).length;
  const down = rs.filter((r) => r < 0).length;
  const m = rs.length >> 1;
  const med = rs.length % 2 ? rs[m] : (rs[m - 1] + rs[m]) / 2;
  const sign = med > 0 ? '+' : med < 0 ? '−' : '';
  const lack = list.length - rs.length;
  return `${PERIOD_LABEL[period]}：上漲 ${up} 檔・下跌 ${down} 檔・中位數 ${sign}${fmtNum(Math.abs(med), 2)}%${lack ? `（${lack} 檔上市未滿期間）` : ''}`;
}

/** 副資訊：「00981A・均額 46.1 億・市值 1,520 億・持股 52 檔」；沒有持股時改寫原因。 */
export function rowSub(e: ActiveEtf, sort: EtfListSort): string {
  const parts = [e.code];
  if (sort !== 'value') parts.push(`均額 ${fin(e.value_million_20d) ? `${fmtNum(e.value_million_20d / 100, 1)} 億` : '—'}`);
  if (sort !== 'mcap') parts.push(`市值 ${fin(e.mcap_yi) ? `${fmtNum(e.mcap_yi, e.mcap_yi >= 100 ? 0 : 1)} 億` : '—'}`);
  if (e.has_holdings === false) parts.push(e.holdings_note ?? '持股資料累積中');
  else if (fin(e.holdings_n)) parts.push(`持股 ${e.holdings_n} 檔${e.holdings_foreign ? `（海外 ${e.holdings_foreign}）` : ''}`);
  return parts.join('・');
}
