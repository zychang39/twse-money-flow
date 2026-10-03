/**
 * 回測引擎（TS 版；規則與 pipeline/derive/backtest.py 相同）：
 * T 日收盤後訊號 → T+1 開盤進場 → 持有 N 日後開盤出場；排除開盤即漲停、停牌、處置期間；扣成本；相對加權報酬指數。
 * 訊號預設為「今日新觸發」（今天符合、上一個交易日可判斷但不符合）；條件欄位最晚的資料起始日之前不產生訊號；
 * 出場規則：只看時間／停損／跌破均線（S5）。
 * 審查修正 2026-10-01：滑價（backtest.slippage_pct，買賣各一次）；出場日跌停鎖死（最高價 ≤ 前收 × (1 − 9.5%)）賣不掉，
 * 順延到下一個可成交日開盤（面板沒有 high 時不判斷）。
 */
import { costsConfig, thresholds, type Condition } from './config';

export interface Panel {
  dates: string[];
  codes: string[];
  open: (number | null)[][];
  low: (number | null)[][];
  close: (number | null)[][];
  /** 還原最高價（跌停鎖死判斷）；舊面板沒有時不判斷 */
  high?: (number | null)[][] | null;
  tradable: number[][];
  blocked: [number, number][];
  bench: (number | null)[];
  regimeUp: boolean[];
  isEtf: boolean[];
}

export interface Trade {
  code: string;
  signal: string;
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  gross: number;
  net: number;
  mae: number;
  bench: number | null;
  excess: number | null;
  regimeUp: boolean;
  delisted: boolean;
}

export interface Stats {
  n: number;
  win_rate?: number;
  avg?: number;
  median?: number;
  avg_mae?: number;
  worst_mae?: number;
  avg_excess?: number | null;
  low_reference: boolean;
}

const fin = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** 滑價（單邊，比例）：config/thresholds.yml backtest.slippage_pct（%）。 */
export const slippageRate = (): number => Number(thresholds.backtest.slippage_pct ?? 0) / 100;

export function netReturn(gross: number, isEtf: boolean, discount = costsConfig.commission.discount, slippage = slippageRate()): number {
  const fee = costsConfig.commission.rate * discount;
  const tax = isEtf ? costsConfig.tax.etf : costsConfig.tax.stock;
  return ((1 + gross) * (1 - slippage) * (1 - fee - tax)) / ((1 + slippage) * (1 + fee)) - 1;
}

/** 第 i 列整天跌停鎖死（最高價 ≤ 前一日收盤 × (1 + limitDownPct/100)）→ 當天賣不掉。 */
export function lockedDown(px: Panel, i: number, c: number, limitDownPct: number): boolean {
  if (!px.high || i <= 0) return false;
  const hi = px.high[i]?.[c], prev = px.close[i - 1]?.[c];
  return fin(hi) && fin(prev) && prev > 0 && hi / prev - 1 <= limitDownPct / 100;
}

export function conditionsMask(conditions: Condition[], lookup: (field: string) => (number | null)[][] | null, T: number, C: number): boolean[][] | null {
  const mask = Array.from({ length: T }, () => new Array<boolean>(C).fill(true));
  for (const c of conditions) {
    const arr = lookup(c.field);
    if (!arr) return null;
    for (let t = 0; t < T; t++) {
      for (let j = 0; j < C; j++) {
        if (!mask[t][j]) continue;
        const v = arr[t]?.[j];
        let ok = fin(v);
        if (ok) {
          const x = v as number;
          switch (c.op) {
            case '>': ok = x > (c.value as number); break;
            case '>=': ok = x >= (c.value as number); break;
            case '<': ok = x < (c.value as number); break;
            case '<=': ok = x <= (c.value as number); break;
            case '==': ok = x === (c.value as number); break;
            case 'between': ok = x >= (c.value as number[])[0] && x <= (c.value as number[])[1]; break;
          }
        }
        mask[t][j] = ok;
      }
    }
  }
  return mask;
}

/** 每個條件欄位都有資料（可以判斷成立與否）。 */
export function conditionsEvaluable(conditions: Condition[], lookup: (field: string) => (number | null)[][] | null, T: number, C: number): boolean[][] | null {
  const ok = Array.from({ length: T }, () => new Array<boolean>(C).fill(true));
  for (const c of conditions) {
    const arr = lookup(c.field);
    if (!arr) return null;
    for (let t = 0; t < T; t++) for (let j = 0; j < C; j++) if (ok[t][j] && !fin(arr[t]?.[j])) ok[t][j] = false;
  }
  return ok;
}

/** 今日新觸發：今天成立、上一個交易日可判斷但不成立（第一天沒有前一日可比，不算）。 */
export function newTriggers(mask: boolean[][], evaluable: boolean[][]): boolean[][] {
  return mask.map((row, t) => row.map((v, j) => t > 0 && v && !mask[t - 1][j] && evaluable[t - 1][j]));
}

export interface FieldCoverage { field: string; stocks: number; first_date: string | null }

/** 每個條件欄位：有資料的股票數、資料起始日。 */
export function fieldCoverage(conditions: Condition[], lookup: (field: string) => (number | null)[][] | null, dates: string[], C: number): FieldCoverage[] {
  return conditions.map((c) => {
    const arr = lookup(c.field);
    if (!arr) return { field: c.field, stocks: 0, first_date: null };
    const has = new Array<boolean>(C).fill(false);
    let first: string | null = null;
    arr.forEach((row, t) => row.forEach((v, j) => { if (fin(v)) { has[j] = true; if (first === null) first = dates[t]; } }));
    return { field: c.field, stocks: has.filter(Boolean).length, first_date: first };
  });
}

/** 資料涵蓋起始日之前不產生訊號。 */
export function eligible(mask: boolean[][], dates: string[], start: string | null): boolean[][] {
  return mask.map((row, t) => row.map((v) => !!start && v && dates[t] >= start));
}

export interface RunResult {
  trades: Record<number, Trade[]>;
  excluded: { limit_up: number; suspended: number; disposition: number; no_future: number; locked_exit: number };
  decay: (number | null)[];
  decayN: number[];
}

export type ExitRule = 'time' | 'stop' | 'trailing';

/** 停損規則的提前出場：回傳 [出場日索引, 出場價（null＝該日開盤）]；沒有提前出場回傳 [x, null]。 */
function findExit(px: Panel, c: number, e: number, x: number, entry: number, rule: ExitRule, stopPct: number, ma: (number | null)[][] | null): [number, number | null] {
  const T = px.dates.length;
  if (rule === 'stop') {
    const stopPx = entry * (1 + stopPct / 100);
    for (let i = e; i < Math.min(x, T); i++) {
      const lo = px.low[i][c];
      if (fin(lo) && lo <= stopPx) {
        const op = px.open[i][c];
        return [i, i === e || !fin(op) ? stopPx : Math.min(op, stopPx)];
      }
    }
  } else if (rule === 'trailing' && ma) {
    for (let i = e; i < Math.min(x - 1, T - 1); i++) {
      const cl = px.close[i][c], m = ma[i][c];
      if (fin(cl) && fin(m) && cl < m) return [i + 1, null];
    }
  }
  return [x, null];
}

export function run(signals: boolean[][], px: Panel, horizons: number[] = thresholds.backtest.horizons, decayDays: number = thresholds.backtest.decay_days,
  limitUpPct: number = thresholds.backtest.limit_up_pct, rule: ExitRule = 'time', stopPct: number = thresholds.backtest.stop_loss_pct ?? -7,
  ma: (number | null)[][] | null = null): RunResult {
  const T = px.dates.length;
  const blocked = new Set(px.blocked.map(([t, c]) => `${t}:${c}`));
  const trades: Record<number, Trade[]> = {};
  horizons.forEach((h) => (trades[h] = []));
  const excluded = { limit_up: 0, suspended: 0, disposition: 0, no_future: 0, locked_exit: 0 };
  const decaySum = new Array(decayDays).fill(0);
  const decayN = new Array(decayDays).fill(0);
  const limitUp = limitUpPct / 100;
  const limitDown = Number(thresholds.backtest.limit_down_pct ?? -9.5);
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < px.codes.length; c++) {
      if (!signals[t][c]) continue;
      const e = t + 1;
      if (e >= T) { excluded.no_future++; continue; }
      const entry = px.open[e][c];
      if (!px.tradable[e][c] || !fin(entry)) { excluded.suspended++; continue; }
      const prevClose = px.close[t][c];
      if (fin(prevClose) && prevClose > 0 && entry / prevClose - 1 >= limitUp) { excluded.limit_up++; continue; }
      if (blocked.has(`${e}:${c}`)) { excluded.disposition++; continue; }
      const etf = px.isEtf[c];
      for (let k = 1; k <= decayDays; k++) {
        const i = e + k - 1;
        const cl = i < T ? px.close[i][c] : null;
        if (fin(cl)) { decaySum[k - 1] += netReturn(cl / entry - 1, etf); decayN[k - 1]++; }
      }
      for (const h of horizons) {
        const x = e + h;
        if (x >= T) continue;
        let [k, fixedPx] = findExit(px, c, e, x, entry, rule, stopPct, ma);
        if (fixedPx !== null && lockedDown(px, k, c, limitDown)) { fixedPx = null; k++; } // 停損觸及當天鎖死 → 下一個可成交日開盤
        while (fixedPx === null && k < T && !(px.tradable[k][c] && fin(px.open[k][c]) && !lockedDown(px, k, c, limitDown))) k++;
        for (let i = x; i < Math.min(k, T); i++) if (lockedDown(px, i, c, limitDown)) { excluded.locked_exit++; break; }
        let exitI: number;
        let exitPx: number;
        let delisted = false;
        if (fixedPx !== null) {
          exitI = k;
          exitPx = fixedPx;
        } else if (k < T) {
          exitI = k;
          exitPx = px.open[k][c] as number;
        } else {
          exitI = e;
          for (let i = T - 1; i >= e; i--) if (fin(px.close[i][c])) { exitI = i; break; }
          exitPx = px.close[exitI][c] as number;
          delisted = true;
        }
        let worst = Infinity;
        for (let i = e; i < exitI + (fixedPx !== null ? 1 : 0); i++) { const lo = px.low[i][c]; if (fin(lo) && lo < worst) worst = lo; }
        if (worst === Infinity) worst = entry;
        worst = Math.min(worst, exitPx);
        const gross = exitPx / entry - 1;
        const net = netReturn(gross, etf);
        const b0 = px.bench[t];
        const b1 = px.bench[Math.max(exitI - 1, t)];
        const bench = fin(b0) && fin(b1) && b0 > 0 ? b1 / b0 - 1 : null;
        trades[h].push({
          code: px.codes[c], signal: px.dates[t], entryDate: px.dates[e], exitDate: px.dates[exitI], entry, exit: exitPx,
          gross, net, mae: worst / entry - 1, bench, excess: bench === null ? null : net - bench, regimeUp: px.regimeUp[t], delisted,
        });
      }
    }
  }
  return { trades, excluded, decay: decaySum.map((s, i) => (decayN[i] ? s / decayN[i] : null)), decayN };
}

export function nonOverlapping(trades: Trade[]): Trade[] {
  const sorted = [...trades].sort((a, b) => (a.code === b.code ? a.entryDate.localeCompare(b.entryDate) : a.code.localeCompare(b.code)));
  const lastExit = new Map<string, string>();
  const out: Trade[] = [];
  for (const tr of sorted) {
    const le = lastExit.get(tr.code);
    if (le !== undefined && tr.entryDate < le) continue;
    out.push(tr);
    lastExit.set(tr.code, tr.exitDate);
  }
  return out.sort((a, b) => a.signal.localeCompare(b.signal));
}

export function stats(trades: Trade[]): Stats {
  const n = trades.length;
  const minSamples = thresholds.backtest.min_samples as number;
  if (!n) return { n: 0, low_reference: true };
  const net = trades.map((t) => t.net).sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const median = n % 2 ? net[(n - 1) / 2] : (net[n / 2 - 1] + net[n / 2]) / 2;
  const exc = trades.map((t) => t.excess).filter(fin);
  const mae = trades.map((t) => t.mae);
  return {
    n,
    win_rate: (trades.filter((t) => t.net > 0).length / n) * 100,
    avg: mean(net) * 100,
    median: median * 100,
    avg_mae: mean(mae) * 100,
    // 大量交易時展開運算子會超出呼叫堆疊（Maximum call stack size exceeded），改用 reduce
    worst_mae: mae.reduce((m, x) => (x < m ? x : m), Infinity) * 100,
    avg_excess: exc.length ? mean(exc) * 100 : null,
    low_reference: n < minSamples,
  };
}

export interface HorizonSummary {
  all: Stats; non_overlap: Stats; in_sample?: Stats; out_of_sample?: Stats; regime_up?: Stats; regime_down?: Stats; oos_cut?: string;
}

export function summarize(res: RunResult, split: number = thresholds.backtest.oos_split) {
  const horizons: Record<string, HorizonSummary> = {};
  for (const [h, trades] of Object.entries(res.trades)) {
    if (!trades.length) { horizons[h] = { all: stats([]), non_overlap: stats([]) }; continue; }
    const sigs = [...new Set(trades.map((t) => t.signal))].sort();
    const first = Date.parse(sigs[0]);
    const last = Date.parse(sigs[sigs.length - 1]);
    const days = Math.round((last - first) / 86400000);
    const cut = new Date(first + Math.floor(days * split) * 86400000).toISOString().slice(0, 10);
    horizons[h] = {
      all: stats(trades),
      non_overlap: stats(nonOverlapping(trades)),
      in_sample: stats(trades.filter((t) => t.signal <= cut)),
      out_of_sample: stats(trades.filter((t) => t.signal > cut)),
      regime_up: stats(trades.filter((t) => t.regimeUp)),
      regime_down: stats(trades.filter((t) => !t.regimeUp)),
      oos_cut: cut,
    };
  }
  return { horizons, excluded: res.excluded, decay: res.decay, decay_n: res.decayN };
}

/** n 日簡單均線（逐日、逐檔；不足 n 個連續有效收盤為 null）。 */
export function movingAverage(close: (number | null)[][], n: number): (number | null)[][] {
  const T = close.length, C = close[0]?.length ?? 0;
  const out = Array.from({ length: T }, () => new Array<number | null>(C).fill(null));
  for (let j = 0; j < C; j++) {
    let sum = 0, cnt = 0;
    for (let t = 0; t < T; t++) {
      const v = close[t][j];
      if (fin(v)) { sum += v; cnt++; } else { sum = 0; cnt = 0; }
      if (cnt > n) { const old = close[t - n][j] as number; sum -= old; cnt = n; }
      if (cnt === n) out[t][j] = sum / n;
    }
  }
  return out;
}

const statsByHorizon = (res: RunResult) => Object.fromEntries(Object.entries(res.trades).map(([h, tr]) => [h, { all: stats(tr), non_overlap: stats(nonOverlapping(tr)) }]));

/**
 * 完整回測報告（自訂條件；欄位與 pipeline 預先計算的內建策略相同）：
 * 訊號定義、資料涵蓋（樣本範圍受限）、各股訊號數、每天符合的對照、停損與移動停損的並列比較。
 */
export function buildReport(conditions: Condition[], lookup: (field: string) => (number | null)[][] | null, px: Panel, labels: (f: string) => string = (f) => f) {
  const T = px.dates.length, C = px.codes.length;
  const mask = conditionsMask(conditions, lookup, T, C);
  const ev = conditionsEvaluable(conditions, lookup, T, C);
  if (!mask || !ev) return null;
  const cov = fieldCoverage(conditions, lookup, px.dates, C);
  const firsts = cov.map((c) => c.first_date);
  const start = firsts.length && firsts.every(Boolean) ? (firsts as string[]).sort().at(-1)! : null;
  const level = eligible(mask, px.dates, start);
  const nw = eligible(newTriggers(mask, ev), px.dates, start);
  const bt = thresholds.backtest;
  const res = run(nw, px);
  const t0 = start ? px.dates.findIndex((d) => d >= start) : 0;
  let universe = 0;
  for (let j = 0; j < C; j++) { for (let t = Math.max(0, t0); t < T; t++) if (fin(px.close[t][j])) { universe++; break; } }
  const counts = new Map<string, number>();
  let firstSig: string | null = null, lastSig: string | null = null, signals = 0, signalsLevel = 0;
  nw.forEach((row, t) => row.forEach((v, j) => { if (v) { signals++; counts.set(px.codes[j], (counts.get(px.codes[j]) ?? 0) + 1); firstSig ??= px.dates[t]; lastSig = px.dates[t]; } }));
  level.forEach((row) => row.forEach((v) => { if (v) signalsLevel++; }));
  const ratio = Number(bt.coverage_limited_ratio ?? 0.5);
  const fields = cov.map((c) => ({ ...c, label: labels(c.field) }));
  const ma = movingAverage(px.close, Number(bt.trailing_ma ?? 20));
  return {
    ...summarize(res),
    trades_raw: res.trades,
    signal_definition: 'new' as const,
    signals,
    signals_level: signalsLevel,
    first_signal: firstSig,
    last_signal: lastSig,
    coverage: {
      start, price_start: px.dates[0] ?? null, universe, fields,
      limited: fields.some((f) => f.stocks < universe * ratio),
      stocks_in_sample: counts.size,
      by_code: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    },
    level: statsByHorizon(run(level, px)),
    exit_rules: {
      stop: { pct: Number(bt.stop_loss_pct ?? -7), horizons: statsByHorizon(run(nw, px, undefined, undefined, undefined, 'stop')) },
      trailing: { ma: Number(bt.trailing_ma ?? 20), horizons: statsByHorizon(run(nw, px, undefined, undefined, undefined, 'trailing', undefined, ma)) },
    },
    period: { start, end: px.dates[T - 1] ?? null },
  };
}
