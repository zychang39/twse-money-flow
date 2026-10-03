/**
 * 自選股的顯著變化（2026-10-02 健檢 M1-1）：今晚頁與我的股票頁用同一個函式、同一個比較基準。
 *
 * 原本兩頁各存一份「上次查看」快照（seen:tonight、seen:mine）、股票集合也不同（今晚排除持股、我的股票全部自選），
 * 同一時間首頁寫 4 檔、我的股票寫 2 檔。現在：
 * - 一個快照範圍 WATCH_SCOPE，快照內容＝全部自選＋持股（兩頁都能比較）。
 * - 「自選的顯著變化」檔數＝自選股（不含同時持有的股票，持股另在「持股有沒有出事」回答）中變化超過門檻的檔數。
 * - 文案都標明基準：「自上次查看（10/1 21:30）以來」或「較前一交易日」（第一次使用、沒有快照）。
 */
import type { StockRow } from '../data/types';
import type { WatchItem, Trade } from '../db/db';
import { type Change, type Snapshot, diffAll, sinceLabel } from './changes';

export const WATCH_SCOPE = 'watch';

/** 自選股列（不含同時持有的股票），依自選順序。 */
export function watchRows(watch: Pick<WatchItem, 'code'>[], trades: Pick<Trade, 'code' | 'status'>[], byCode: Map<string, StockRow> | undefined): StockRow[] {
  if (!byCode) return [];
  const held = new Set(trades.filter((t) => t.status === 'open').map((t) => t.code));
  return watch.map((w) => byCode.get(w.code)).filter((r): r is StockRow => !!r && !held.has(r.code));
}

/** 快照用：全部自選＋持股（兩頁都能找到上次的值）。 */
export function snapshotRows(watch: Pick<WatchItem, 'code'>[], trades: Pick<Trade, 'code' | 'status'>[], byCode: Map<string, StockRow> | undefined): StockRow[] {
  if (!byCode) return [];
  const codes = [...new Set([...trades.filter((t) => t.status === 'open').map((t) => t.code), ...watch.map((w) => w.code)])];
  return codes.map((c) => byCode.get(c)).filter((r): r is StockRow => !!r);
}

export interface WatchSummary {
  changes: Change[];
  significant: Change[];
  quiet: Change[];
  /** 比較基準的文字：「自上次查看（10/1 21:30）以來」／「較前一交易日」 */
  basis: string;
}

export function watchSummary(rows: StockRow[], snap: Snapshot | null): WatchSummary {
  const changes = diffAll(rows, snap);
  return {
    changes,
    significant: changes.filter((c) => c.significant),
    quiet: changes.filter((c) => !c.significant),
    basis: sinceLabel(snap),
  };
}

/** 區塊答案：「3 檔有顯著變化（自上次查看 10/1 21:30 以來）」 */
export function watchAnswer(s: WatchSummary, watchCount: number): string {
  if (!watchCount) return '還沒有自選股';
  return s.significant.length ? `${s.significant.length} 檔有顯著變化` : '沒有顯著變化';
}

/**
 * 簡報頁自選股列的副資訊（2026-10 改版 §4-7）：「外資+投信 +5,887 張（佔 20 日均量 32%）・量 1.32×」。
 * 舊版的「量 32%」是外資＋投信淨買賣超 ÷ 當日成交量；改版統一成：括號內＝淨買賣超 ÷ 20 日均量（%），
 * 「量」＝量比（當日成交量 ÷ 20 日均量，倍數）。缺 20 日均量時省略括號；缺量比時省略「量」。
 */
export function watchSub(r: StockRow): string {
  const f = r.foreign_net_lots, t = r.trust_net_lots;
  const parts: string[] = [];
  if (f !== null && f !== undefined || t !== null && t !== undefined) {
    const inst = (f ?? 0) + (t ?? 0);
    const r0 = Math.round(Math.abs(inst));
    const sign = r0 === 0 ? '' : inst > 0 ? '+' : '\u2212';
    const vol20 = r.vol20_lots as number | null | undefined;
    const pct = vol20 && vol20 > 0 ? `（佔 20 日均量 ${Math.round((Math.abs(inst) / vol20) * 100)}%）` : '';
    parts.push(`外資+投信 ${sign}${r0.toLocaleString('en-US')}\u00a0張${pct}`);
  }
  const vr = r.vol_ratio as number | null | undefined;
  if (vr !== null && vr !== undefined && Number.isFinite(vr)) parts.push(`量\u00a0${vr.toFixed(2)}×`);
  return parts.join('・');
}
