/**
 * 回測引擎（TS 版；規則與 pipeline/derive/backtest.py 相同）：
 * T 日收盤後訊號 → T+1 開盤進場 → 持有 N 日後開盤出場；排除開盤即漲停、停牌、處置期間；扣成本；相對加權報酬指數。
 */
import { costsConfig, thresholds, type Condition } from './config';

export interface Panel {
  dates: string[];
  codes: string[];
  open: (number | null)[][];
  low: (number | null)[][];
  close: (number | null)[][];
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

export function netReturn(gross: number, isEtf: boolean, discount = costsConfig.commission.discount): number {
  const fee = costsConfig.commission.rate * discount;
  const tax = isEtf ? costsConfig.tax.etf : costsConfig.tax.stock;
  return ((1 + gross) * (1 - fee - tax)) / (1 + fee) - 1;
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

export interface RunResult {
  trades: Record<number, Trade[]>;
  excluded: { limit_up: number; suspended: number; disposition: number; no_future: number };
  decay: (number | null)[];
  decayN: number[];
}

export function run(signals: boolean[][], px: Panel, horizons: number[] = thresholds.backtest.horizons, decayDays: number = thresholds.backtest.decay_days,
  limitUpPct: number = thresholds.backtest.limit_up_pct): RunResult {
  const T = px.dates.length;
  const blocked = new Set(px.blocked.map(([t, c]) => `${t}:${c}`));
  const trades: Record<number, Trade[]> = {};
  horizons.forEach((h) => (trades[h] = []));
  const excluded = { limit_up: 0, suspended: 0, disposition: 0, no_future: 0 };
  const decaySum = new Array(decayDays).fill(0);
  const decayN = new Array(decayDays).fill(0);
  const limitUp = limitUpPct / 100;
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
        let k = x;
        while (k < T && !(px.tradable[k][c] && fin(px.open[k][c]))) k++;
        let exitI: number;
        let exitPx: number;
        let delisted = false;
        if (k < T) {
          exitI = k;
          exitPx = px.open[k][c] as number;
        } else {
          exitI = e;
          for (let i = T - 1; i >= e; i--) if (fin(px.close[i][c])) { exitI = i; break; }
          exitPx = px.close[exitI][c] as number;
          delisted = true;
        }
        let worst = Infinity;
        for (let i = e; i < exitI; i++) { const lo = px.low[i][c]; if (fin(lo) && lo < worst) worst = lo; }
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
    worst_mae: Math.min(...mae) * 100,
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
