/** 今日日報排序：新出現的風險旗標優先，其次分數變化、法人買賣超、漲跌幅的幅度。 */
import type { StockRow } from '../data/types';

export function changeMagnitude(r: StockRow): number {
  const newFlags = Array.isArray(r.new_flags) ? (r.new_flags as string[]).length : 0;
  const scoreChg = Math.abs((r.composite_chg as number | null) ?? 0);
  const flow = Math.abs(r.foreign_net_lots ?? 0) + Math.abs(r.trust_net_lots ?? 0);
  const vol = Math.max(r.volume_lots ?? 0, 1);
  const pct = Math.abs(r.change_pct ?? 0);
  return newFlags * 1000 + scoreChg * 10 + Math.min((flow / vol) * 100, 100) * 0.5 + pct;
}

export function sortDaily(rows: StockRow[]): StockRow[] {
  return [...rows].sort((a, b) => changeMagnitude(b) - changeMagnitude(a));
}
