/**
 * 各資料集的資料日（2026-10-02 健檢 M1-4）：每個區塊標自己的資料日，不共用頁首的「資料至」。
 * - 全站層級：meta.json 的 asof（pipeline export.dataset_asof），鍵名與這裡一致。
 * - 個股層級：個股檔的序列最後一個有值的日期（lastValidDate），例：融資餘額到 10/1、法人到 10/2。
 */
import { md } from './format';

export type AsofKey =
  | 'quotes' | 'insti' | 'credit' | 'valuation' | 'sbl' | 'daytrade' | 'qfii' | 'tdcc' | 'etf_holdings' | 'revenue' | 'financials' | 'taifex' | 'margin_total' | 'index';

export const ASOF_LABEL: Record<AsofKey, string> = {
  quotes: '收盤行情',
  insti: '三大法人',
  credit: '融資融券',
  valuation: '本益比、淨值比',
  sbl: '借券',
  daytrade: '當沖',
  qfii: '外資持股比',
  tdcc: '集保股權分散',
  etf_holdings: '主動式 ETF 持股',
  revenue: '月營收',
  financials: '季財報',
  taifex: '期貨法人',
  margin_total: '融資總計',
  index: '指數',
};

export type Asof = Partial<Record<AsofKey, string | null>>;

/** 序列最後一個有值的日期；全部沒有值 → null。 */
export function lastValidDate(dates: string[] | undefined, values: (number | null | undefined)[] | undefined): string | null {
  if (!dates || !values) return null;
  for (let i = Math.min(dates.length, values.length) - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return dates[i] ?? null;
  }
  return null;
}

/** 「資料日 10/1」；沒有日期時寫原因。 */
export function asofText(date: string | null | undefined, reason = '尚未取得'): string {
  return date ? `資料日 ${md(date)}` : `資料日 —（${reason}）`;
}

/** 資料日比最新交易日早時加註「（最新交易日 10/2 尚未公布）」。 */
export function asofNote(date: string | null | undefined, marketDate: string | null | undefined): string {
  if (!date) return '';
  if (marketDate && date < marketDate) return `（${md(marketDate)} 尚未公布）`;
  return '';
}
