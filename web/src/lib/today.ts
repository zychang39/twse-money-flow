/** 今日日報排序：新出現的風險旗標優先，其次法人買賣超、漲跌幅的幅度（stock 2026-10-03：綜合分變化不再參與排序，SPEC §5.7）。 */
import type { StockRow } from '../data/types';

export function changeMagnitude(r: StockRow): number {
  const newFlags = Array.isArray(r.new_flags) ? (r.new_flags as string[]).length : 0;
  const flow = Math.abs(r.foreign_net_lots ?? 0) + Math.abs(r.trust_net_lots ?? 0);
  const vol = Math.max(r.volume_lots ?? 0, 1);
  const pct = Math.abs(r.change_pct ?? 0);
  return newFlags * 1000 + Math.min((flow / vol) * 100, 100) * 0.5 + pct;
}

export function sortDaily(rows: StockRow[]): StockRow[] {
  return [...rows].sort((a, b) => changeMagnitude(b) - changeMagnitude(a));
}
