/**
 * 訊號追蹤（紙上交易，S3；純函式）。
 *
 * - 內建策略的每日新觸發由 pipeline 預先計算（全市場，signals.json）；前端只記錄使用者啟用追蹤「之後」的觸發：
 *   啟用時記下當時最新的資料日 startAfter，只收訊號日 > startAfter 的觸發（前瞻驗證，不回溯）。
 * - 自訂條件：pipeline 無法預先知道條件，改在打開 App 時用 screen_days.json（全市場最近兩個交易日）記錄當天的新觸發；
 *   沒有打開 App 的交易日不會補記（畫面上說明）。
 * - 進場：訊號日隔天開盤（停牌則順延到下一個有開盤價的交易日）；出場：進場後第 N 個交易日開盤（同樣順延）。
 *   報酬用還原價、扣手續費與證交稅（與回測相同的 netReturn）；超額報酬相對加權報酬指數（訊號日收盤到出場前一日收盤）。
 * - 觸發一旦記錄就保存在 IndexedDB（含第一次看到的時間）；出場後把進出場價格寫回紀錄，之後不再受資料檔變動影響。
 */
import { netReturn } from './backtest';
import { isEtfCode as isEtf } from './costs';

export interface SignalsFile {
  dates: string[];
  definition: string;
  presets: { id: string; label: string; subtitle?: string; start?: string; status?: string; triggers: Record<string, string[]> }[];
  /** 加權報酬指數（與 dates 對齊） */
  bench: (number | null)[];
  names: Record<string, string>;
}

/** signals_px.json：最近約 90 個交易日內觸發過的股票，從第一次觸發（dates 的索引 s）起的還原開盤／收盤。 */
export interface SignalPrices {
  dates: string[];
  prices: Record<string, { s: number; o: (number | null)[]; c: (number | null)[] }>;
}

export interface Strategy {
  id: string;
  /** 內建策略 id；自訂條件為 null */
  presetId: string | null;
  name: string;
  conditions: { field: string; op: string; value: number | [number, number] }[];
  /** 持有 N 個交易日 */
  horizon: number;
  /** 啟用時的最新資料日：只記錄訊號日在這之後的觸發 */
  startAfter: string;
  enabledAt: string;
  active: boolean;
}

export interface TrackedSignal {
  /** strategyId|code|signalDate */
  key: string;
  strategyId: string;
  code: string;
  name?: string;
  signalDate: string;
  firstSeen: string;
  /** 出場後寫回（之後不再重算） */
  entryDate?: string;
  entry?: number;
  exitDate?: string;
  exit?: number;
  benchRet?: number | null;
}

export type PositionStatus = 'waiting' | 'holding' | 'closed' | 'unknown';

export interface Position {
  sig: TrackedSignal;
  status: PositionStatus;
  entryDate?: string;
  entry?: number;
  exitDate?: string;
  exit?: number;
  /** 持有中：最新收盤；已出場：出場價 */
  mark?: number;
  /** 扣成本的報酬（小數） */
  ret?: number;
  benchRet?: number | null;
  excess?: number | null;
  /** 已持有的交易日數（持有中） */
  held?: number;
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const trackKey = (strategyId: string, code: string, date: string) => `${strategyId}|${code}|${date}`;

/** 內建策略：從 signals.json 取出啟用之後的新觸發（還沒記錄過的）。 */
export function collectPresetTriggers(st: Strategy, file: SignalsFile, known: Set<string>, now: string): TrackedSignal[] {
  const p = file.presets.find((x) => x.id === st.presetId);
  if (!p) return [];
  const out: TrackedSignal[] = [];
  for (const [d, codes] of Object.entries(p.triggers)) {
    if (d <= st.startAfter) continue;
    for (const code of codes) {
      const key = trackKey(st.id, code, d);
      if (!known.has(key)) out.push({ key, strategyId: st.id, code, name: file.names[code], signalDate: d, firstSeen: now });
    }
  }
  return out.sort((a, b) => a.signalDate.localeCompare(b.signalDate) || a.code.localeCompare(b.code));
}

/** 自訂條件：今天（最新資料日）的新觸發；只在最新資料日晚於 startAfter 時記錄。 */
export function collectCustomTriggers(st: Strategy, date: string, codes: Iterable<string>, known: Set<string>, now: string, names: Record<string, string> = {}): TrackedSignal[] {
  if (date <= st.startAfter) return [];
  return [...codes].map((code) => ({ key: trackKey(st.id, code, date), strategyId: st.id, code, name: names[code], signalDate: date, firstSeen: now }))
    .filter((s) => !known.has(s.key));
}

/** 價格序列（還原價），dates 與 open／close 對齊。 */
export interface PriceSeries { dates: string[]; open: (number | null)[]; close: (number | null)[] }

export function seriesFromSignals(file: SignalPrices, code: string): PriceSeries | null {
  const p = file.prices[code];
  if (!p) return null;
  return { dates: file.dates.slice(p.s), open: p.o, close: p.c };
}

/** 從索引 i 起第一個有開盤價的交易日。 */
function firstOpen(px: PriceSeries, i: number): number {
  let k = i;
  while (k < px.dates.length && !fin(px.open[k])) k++;
  return k;
}

/**
 * 一筆追蹤訊號的狀態。已出場且寫回價格的紀錄直接用紀錄的值。
 * bench：加權報酬指數（dates 對齊 benchDates）；沒有時超額報酬為 null。
 */
export function evaluate(sig: TrackedSignal, horizon: number, px: PriceSeries | null, bench?: { dates: string[]; values: (number | null)[] }): Position {
  const etf = isEtf(sig.code);
  if (fin(sig.entry) && fin(sig.exit) && sig.exitDate) {
    const ret = netReturn(sig.exit / sig.entry - 1, etf);
    const b = sig.benchRet ?? null;
    return { sig, status: 'closed', entryDate: sig.entryDate, entry: sig.entry, exitDate: sig.exitDate, exit: sig.exit, mark: sig.exit, ret, benchRet: b, excess: b === null ? null : ret - b };
  }
  if (!px) return { sig, status: 'unknown' };
  const t = px.dates.indexOf(sig.signalDate);
  if (t < 0) return { sig, status: 'unknown' };
  const last = px.dates.length - 1;
  const e = firstOpen(px, t + 1);
  if (e > last) return { sig, status: 'waiting' };
  const entry = px.open[e] as number;
  const benchAt = (d: string) => { if (!bench) return null; const i = bench.dates.indexOf(d); return i >= 0 && fin(bench.values[i]) ? bench.values[i] : null; };
  const b0 = benchAt(sig.signalDate);
  const x = e + horizon;
  if (x > last) {
    let m = last;
    while (m > e && !fin(px.close[m])) m--;
    const mark = fin(px.close[m]) ? (px.close[m] as number) : entry;
    const ret = netReturn(mark / entry - 1, etf);
    const b1 = benchAt(px.dates[last]);
    const benchRet = b0 !== null && b1 !== null ? b1 / b0 - 1 : null;
    return { sig, status: 'holding', entryDate: px.dates[e], entry, mark, ret, benchRet, excess: benchRet === null ? null : ret - benchRet, held: last - e + 1 };
  }
  const xi = firstOpen(px, x);
  if (xi > last) return { sig, status: 'holding', entryDate: px.dates[e], entry, held: last - e + 1 };
  const exit = px.open[xi] as number;
  const ret = netReturn(exit / entry - 1, etf);
  const b1 = benchAt(px.dates[Math.max(xi - 1, t)]);
  const benchRet = b0 !== null && b1 !== null ? b1 / b0 - 1 : null;
  return { sig, status: 'closed', entryDate: px.dates[e], entry, exitDate: px.dates[xi], exit, mark: exit, ret, benchRet, excess: benchRet === null ? null : ret - benchRet };
}

export interface TrackStats { closed: number; open: number; waiting: number; winRate: number | null; avg: number | null; median: number | null; avgExcess: number | null }

/** 策略累計（只算已出場的）：勝率、平均與中位數報酬、平均超額報酬（皆為 %）。 */
export function trackStats(ps: Position[]): TrackStats {
  const closed = ps.filter((p) => p.status === 'closed' && fin(p.ret));
  const rets = closed.map((p) => p.ret as number).sort((a, b) => a - b);
  const n = rets.length;
  const exc = closed.map((p) => p.excess).filter(fin);
  return {
    closed: n,
    open: ps.filter((p) => p.status === 'holding').length,
    waiting: ps.filter((p) => p.status === 'waiting').length,
    winRate: n ? (rets.filter((r) => r > 0).length / n) * 100 : null,
    avg: n ? (rets.reduce((s, r) => s + r, 0) / n) * 100 : null,
    median: n ? (n % 2 ? rets[(n - 1) / 2] : (rets[n / 2 - 1] + rets[n / 2]) / 2) * 100 : null,
    avgExcess: exc.length ? (exc.reduce((s, r) => s + r, 0) / exc.length) * 100 : null,
  };
}

/** 已出場但紀錄還沒寫回價格 → 回傳要寫回的紀錄（之後不再受資料檔變動影響）。 */
export function settle(p: Position): TrackedSignal | null {
  if (p.status !== 'closed' || fin(p.sig.exit)) return null;
  return { ...p.sig, entryDate: p.entryDate, entry: p.entry, exitDate: p.exitDate, exit: p.exit, benchRet: p.benchRet ?? null };
}

/** 明天開盤要出場的追蹤部位（持有中、再過一個交易日就滿 N 日）。 */
export function exitsTomorrow(ps: Position[], horizon: number): Position[] {
  return ps.filter((p) => p.status === 'holding' && p.held === horizon);
}
