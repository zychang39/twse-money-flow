/**
 * 訊號追蹤的資料同步（S3）：把啟用之後的新觸發寫進 IndexedDB、計算每筆部位的狀態、出場後寫回價格。
 * 計算規則見 lib/tracking.ts；這裡只負責讀檔與存取。
 */
import { loadScreenDays, loadSignals, loadStock } from '../data/api';
import { listStrategies, listTracked, putTracked } from '../db/db';
import { newTriggerCodes } from './screener';
import type { Condition } from './config';
import {
  collectCustomTriggers, collectPresetTriggers, evaluate, seriesFromSignals, settle,
  type Position, type PriceSeries, type SignalsFile, type Strategy, type TrackedSignal,
} from './tracking';

/** 把啟用之後的新觸發寫進 IndexedDB。沒有啟用中的策略就不下載任何資料。回傳新增筆數。 */
export async function syncTracking(now = new Date().toISOString()): Promise<number> {
  const strategies = (await listStrategies()).filter((s) => s.active);
  if (!strategies.length) return 0;
  const known = new Set((await listTracked()).map((t) => t.key));
  const file = strategies.some((s) => s.presetId) ? await loadSignals().catch(() => null) : null;
  const days = strategies.some((s) => !s.presetId) ? await loadScreenDays().catch(() => null) : null;
  const rows: TrackedSignal[] = [];
  for (const st of strategies) {
    if (st.presetId && file) rows.push(...collectPresetTriggers(st, file, known, now));
    else if (!st.presetId && days) {
      const codes = newTriggerCodes(days, st.conditions as Condition[]);
      if (codes) rows.push(...collectCustomTriggers(st, days.dates[1], codes, known, now, file?.names ?? {}));
    }
  }
  await putTracked(rows);
  return rows.length;
}

/** 個股檔 → 還原開盤／收盤序列（signals.json 沒有這檔的價格時使用，例如自訂條件）。 */
async function seriesFromStock(code: string): Promise<PriceSeries | null> {
  const h = await loadStock(code).catch(() => null);
  if (!h) return null;
  return {
    dates: h.d,
    open: h.o.map((v, i) => (v === null ? null : v * (h.af[i] ?? 1))),
    close: h.c.map((v, i) => (v === null ? null : v * (h.af[i] ?? 1))),
  };
}

export interface StrategyView { strategy: Strategy; positions: Position[] }

/** 每個策略的部位狀態；出場但還沒寫回的紀錄順便寫回。 */
export async function loadPositions(strategies: Strategy[], tracked: TrackedSignal[], file: SignalsFile | null): Promise<StrategyView[]> {
  const cache = new Map<string, Promise<PriceSeries | null>>();
  const series = (code: string) => {
    if (!cache.has(code)) {
      const fromFile = file ? seriesFromSignals(file, code) : null;
      cache.set(code, fromFile ? Promise.resolve(fromFile) : seriesFromStock(code));
    }
    return cache.get(code)!;
  };
  const bench = file ? { dates: file.dates, values: file.bench } : undefined;
  const settled: TrackedSignal[] = [];
  const out: StrategyView[] = [];
  for (const st of strategies) {
    const mine = tracked.filter((t) => t.strategyId === st.id).sort((a, b) => b.signalDate.localeCompare(a.signalDate) || a.code.localeCompare(b.code));
    const positions: Position[] = [];
    for (const sig of mine) {
      const done = typeof sig.exit === 'number';
      const p = evaluate(sig, st.horizon, done ? null : await series(sig.code), bench);
      const s = settle(p);
      if (s) settled.push(s);
      positions.push(p);
    }
    out.push({ strategy: st, positions });
  }
  await putTracked(settled);
  return out;
}
