/**
 * 公司行動（分割、減資、除權息）後的持倉換算（D-01）。
 *
 * 使用者輸入的進場價、停損、目標、股數一律保留原值；比較與計算時才換算到「目前的價格基準」：
 * 因子 F＝進場日之後（不含）所有還原事件因子的乘積（與個股檔 af 同一套：還原價＝原始價 × af，最新一日 af＝1）。
 * - 換算後價格＝原價 × F（進場價、停損、目標）
 * - 換算後股數＝原股數 ÷ F（分割 1 拆 4：F＝0.25 → 股數 ×4）
 * 現金股利也以同一因子換算（視同再投入），所以除息日不會出現假的「觸及停損」或假的虧損。
 * 只有分割、減資、推估的面額變更（結構性事件）才標示「已依某日分割調整」。
 */
import type { StockHistory, StockRow } from '../data/types';
import type { Trade } from '../db/db';

/** [日期, 因子, 類型]；類型：dividend、capreduce、split、inferred */
export type AdjEvent = [string, number, string];

const KIND_LABEL: Record<string, string> = { split: '分割', capreduce: '減資', inferred: '面額變更' };
const STRUCTURAL = new Set(Object.keys(KIND_LABEL));

/** 事件來源：已載入的個股檔（完整）優先，否則用 summary 的近期事件（adj_ev，最近 120 個交易日）。 */
export function eventsFor(row?: StockRow | null, hist?: StockHistory | null): AdjEvent[] {
  const h = hist?.adj_events as AdjEvent[] | undefined;
  if (h) return h;
  return ((row?.adj_ev as AdjEvent[] | null | undefined) ?? []);
}

/** since（不含）之後、until（含，省略＝到最新）的事件因子乘積。 */
export function factorBetween(events: AdjEvent[], since: string, until?: string): number {
  let f = 1;
  for (const [d, x] of events) if (d > since.slice(0, 10) && (!until || d <= until.slice(0, 10)) && x > 0) f *= x;
  return f;
}

export interface AdjustedTrade {
  factor: number;
  entry: number;
  stop: number;
  target: number;
  shares: number;
  /** 結構性事件（分割、減資…）的說明，例：「已依 2025/6/18 分割調整」；沒有則為空陣列 */
  notes: string[];
}

function ymd(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

/** 把持倉換算到目前的價格基準（until 省略＝最新；已平倉用 closedAt）。 */
export function adjustTrade(t: Pick<Trade, 'openedAt' | 'entry' | 'stop' | 'target' | 'shares'>, events: AdjEvent[], until?: string): AdjustedTrade {
  const factor = factorBetween(events, t.openedAt, until);
  const notes = events
    .filter(([d, , k]) => STRUCTURAL.has(k) && d > t.openedAt.slice(0, 10) && (!until || d <= until.slice(0, 10)))
    .map(([d, , k]) => `已依 ${ymd(d)} ${KIND_LABEL[k]}調整`);
  return {
    factor,
    entry: t.entry * factor,
    stop: t.stop * factor,
    target: t.target * factor,
    shares: Math.round(t.shares / factor),
    notes,
  };
}

/** 未實現損益（目前價格基準）：(現價 − 換算後進場價) × 換算後股數。 */
export function unrealizedPnl(t: Pick<Trade, 'openedAt' | 'entry' | 'stop' | 'target' | 'shares'>, price: number | null, events: AdjEvent[]): number | null {
  if (price === null) return null;
  const a = adjustTrade(t, events);
  return (price - t.entry * a.factor) * (t.shares / a.factor);
}
