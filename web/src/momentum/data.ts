/**
 * 動能流程的資料：由資料分支（momentum_flow/web/*.json）直接讀取，不經過既有的 build-web／部署（隔離規則）。
 * 網址帶當天日期避開 CDN 與 service worker 快取；讀取失敗只影響本頁（入口卡片顯示「—」）。
 */
export const MOMENTUM_BASE = 'https://raw.githubusercontent.com/zychang39/twse-money-flow/data/momentum_flow/web/';

export type Tri = 1 | 0 | -1;
export type KRow = [Tri, ...(number | null)[]];
export interface CandidateRow {
  code: string; name: string; level: 'A' | 'B' | 'C'; group: string | null; group_name: string | null;
  rs: number | null; pr1m: number | null; pr3m: number | null; pr12m: number | null; close: number | null;
  ref: boolean; pullback: boolean; k: KRow[]; n_pass: number; pass: boolean; new: boolean; near: string | null;
}
export interface Funnel { candidates: number; pass: number; k: Record<string, { pass: number; fail: string[]; na: string[] }> }
export interface MarketState { state: 1 | 2 | 3 | null; raw: 1 | 2 | 3 | null; exposure: number | null; entered: string | null; countdown: number | null }
export interface Latest {
  version: number; generated: string; date: string; market: MarketState; funnel: Funnel;
  lists: { pass: CandidateRow[]; new: CandidateRow[]; near: CandidateRow[] }; candidates: number;
  /** 全部候選的名稱（漏斗明細用；舊資料沒有） */
  names?: Record<string, string>;
  k_names: string[]; k_labels: Record<string, string>; k_cols: Record<string, string[]>;
  params: { k: string; v: string; n: string }[]; signals: Record<string, number>;
  review: { R: string; next: string; day: number }; lists_from: string | null;
  /** 注意／處置名單已取得到這一天（約 17:00 公布）；早於 date 時基準日的 K5 為資料不足 */
  lists_through?: string | null;
  stock_cols: string[]; stocks: Record<string, (number | string | null)[]>; groups: Record<string, string>;
  /** 動能環境（2026-10-09；舊資料沒有） */
  regime?: RegimeNow;
}
export interface RegimeFlag { k: string; label: string; primary: boolean; res: Tri; value: number | null; thr: number | null }
export interface RegimeNow {
  date: string; score: number | null; label: string | null; cap: number | null; since: string | null;
  flags: RegimeFlag[]; year: { tailwind: number; neutral: number; headwind: number }; history: (number | null)[];
}
export interface Perf {
  cagr?: number | null; vol?: number | null; mdd?: number | null; calmar?: number | null; sharpe?: number | null;
  worst_month?: number | null; underwater_days?: number; final?: number; excess_mean?: number | null; excess_t?: number | null; bench_cagr?: number | null;
}
export interface PeriodPerf { full: Perf; first?: Perf; second?: Perf }
export interface CondCell { on: number | null; off: number | null; n_on: number; n_off: number; hit_on: number | null; hit_off: number | null; diff: number | null; t: number | null }
export type CondMetric = 'prem' | 'flow' | 'flow_x' | 'size';
export interface CondRow { k: string; label: string; primary: boolean; full: Record<CondMetric, CondCell>; first: Record<CondMetric, CondCell>; second: Record<CondMetric, CondCell> }
export interface LevelCell { label: string; n: number; prem: number | null; flow: number | null; flow_x: number | null; size: number | null }
export interface LevRow extends Perf {
  k: string; label: string; calls: number; call_dates: string[]; dead: boolean; interest: number; lev_costs: number;
  avg_L: number | null; max_L: number | null; gross_avg: number | null; gross_max: number | null; worst_12m: number | null;
}
export type VariantKey = 'always' | 'state' | 'regime';
export interface AttribPart { annual: number | null; t: number | null }
export interface Research {
  period: [string, string]; split: string; split_dates: string[]; months: number;
  variants: Record<VariantKey, { label: string; perf: PeriodPerf; trades: number; invested: number | null; exposure: number | null }>;
  yearly: ({ year: string; bench: number | null; ew: number | null; tailwind: number | null } & Record<VariantKey, number | null>)[];
  curve: { dates: string[]; bench: number[]; ew: number[] } & Record<VariantKey, number[]>;
  attribution: Record<'state' | 'regime', { invested: number | null; selection: AttribPart; size: AttribPart; cash: AttribPart; total: AttribPart }>;
  idle_in_0050: Record<'state' | 'regime', PeriodPerf>;
  bench_perf: PeriodPerf; ew_perf: PeriodPerf;
  conditions: (CondRow | { k: 'levels'; levels: LevelCell[] })[];
  leverage: Record<'state' | 'regime', LevRow[]>;
  factor: { holdings_avg: number | null; perf: Perf; ew_liq_perf: Perf };
  params: Record<string, number | string>;
}
export interface History { date: string; cols: string[]; rows: [string, number | null, number | null, number | null, number | null, number | null][] }
export interface BacktestFile {
  date: string; period: [string, string]; years: string[]; params: Record<string, number | string>;
  summary: Record<string, number | null>; yearly: { year: string; ret: number | null; bench: number | null; ew: number | null; turnover: number | null; mdd: number | null; trades: number }[];
  curve: { dates: string[]; nav: (number | null)[]; bench: (number | null)[]; ew: (number | null)[] };
  filters: { k: string; label: string; mean_diff: number | null; t: number | null; periods: number; avg_p: number | null; avg_f: number | null; enough: boolean }[];
  notes: string[];
  /** 長期研究：報酬分解、動能環境條件、變體、槓桿（2026-10-09；舊資料沒有） */
  research?: Research;
}

const mem = new Map<string, Promise<unknown>>();

export async function fetchMomentum<T>(name: string, base = MOMENTUM_BASE): Promise<T> {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `${base}${name}?d=${day}`;
  const hit = mem.get(url);
  if (hit) return hit as Promise<T>;
  const p = fetch(url, { cache: 'no-cache' }).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}：${name}`);
    return (await r.json()) as T;
  });
  mem.set(url, p);
  p.catch(() => mem.delete(url));
  return p;
}

/**
 * 探索卡片的摘要：一般瀏覽器一律讀取（資料分支已有 momentum_flow/）。自動化測試（navigator.webdriver）在第一次成功開過
 * 動能流程頁之前（localStorage 旗標）不發外部請求：既有冒煙測試要求每頁沒有 console error，也不應依賴外部網路與資料分支。
 * （2026-10-09：原本對所有瀏覽器都等旗標，使用者第一次看到的卡片一律是「—」，改成只限自動化環境。）
 */
export const SEEN_KEY = 'tmf-momentum-seen';
export function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 隱私模式等 */ }
}
export function hasSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export const loadLatest = () => fetchMomentum<Latest>('latest.json').then((l) => { markSeen(); return l; });
export const loadHistory = () => fetchMomentum<History>('history.json');
export const loadBacktest = () => fetchMomentum<BacktestFile>('backtest.json');

/** 自動化環境、而且還沒成功開過本頁 → 探索卡片不讀摘要。 */
export function skipSummary(seen: boolean, webdriver: boolean): boolean {
  return webdriver && !seen;
}
const isAutomation = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

/** 探索入口卡片的一行：「狀態 N・曝險 X%・篩出 n 檔」；讀取失敗（或自動化環境還沒開過本頁）回 null（卡片顯示「—」）。 */
export async function loadSummary(): Promise<string | null> {
  if (skipSummary(hasSeen(), isAutomation())) return null;
  try {
    const l = await loadLatest();
    const m = l.market;
    const state = m.state === null ? '—' : String(m.state);
    const exp = m.exposure === null ? '—' : `${Math.round(m.exposure * 100)}%`;
    return `狀態 ${state}・曝險 ${exp}・篩出 ${l.funnel.pass} 檔`;
  } catch {
    return null;
  }
}

export const STATE_LABEL: Record<number, string> = { 1: '狀態 1', 2: '狀態 2', 3: '狀態 3' };
export const STATE_DESC: Record<number, string> = { 1: '收盤在 60 日線與 240 日線之上', 2: '收盤在 60 日線之下、240 日線之上', 3: '收盤在 240 日線之下' };
