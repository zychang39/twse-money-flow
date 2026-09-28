/**
 * 停牌、無成交、下市的說明文字（U-01、U-02）。休市與停牌不是資料錯誤：一律用平靜的中性文字，不用琥珀色。
 */
import type { InactiveRow, StockRow } from '../data/types';

function md(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 清單列的短標籤：今日無成交／停牌中；正常交易為 null。 */
export function tradeStatusLabel(row: Pick<StockRow, 'trade_status'> | undefined | null): string | null {
  if (!row?.trade_status) return null;
  return row.trade_status === 'halted' ? '停牌中' : '今日無成交';
}

/** 個股頁主角數字旁的說明：「今日無成交・最後成交 9/23」；正常為 null。 */
export function tradeStatusNote(row: Pick<StockRow, 'trade_status' | 'last_trade_date'> | undefined | null, lastInFile?: string | null): string | null {
  const label = tradeStatusLabel(row);
  if (!label) return null;
  const last = row?.last_trade_date ?? lastInFile;
  return last ? `${label}・最後成交 ${md(last)}` : label;
}

/** 沒有個股檔的證券（下市或長期停牌）：卡片與個股頁的說明。 */
export function inactiveText(r: InactiveRow | undefined | null): string {
  if (!r) return '找不到資料：可能代號有誤、已下市，或近 20 個交易日都沒有成交';
  const last = r.last_trade_date ? `最後成交 ${md(r.last_trade_date)}・` : '';
  return r.status === 'halted' ? `${last}長期停牌中，暫停更新` : `${last}近 20 個交易日無成交，可能已下市或長期停牌`;
}
