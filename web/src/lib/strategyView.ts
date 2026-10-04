/**
 * 策略詳情（M5）的純函式：期間鍵與文字、年度統計、逐筆訊號的期間篩選、分布直方圖、最大／最小 10 筆。
 * 資料：strategy/{id}.json（StrategyPack）與 strategy/{id}-signals.json（逐筆）。分級一律以全期間計算，這裡只做檢視。
 */
import type { BenchKey, PeriodView, StrategyPack, YearRow } from '../data/types';

export type PortBench = 'tr' | '0050' | '00631L';
/** 組合層級的比較基準：等權沒有「持有不動」的組合，改用 0050 */
export const portBench = (b: BenchKey): PortBench => (b === 'ew' ? '0050' : b);

/** 篩選列的固定選項（年份另開選單） */
export const QUICK_PERIODS = ['all', 'last:5', 'last:3', 'last:1'] as const;

export function periodLabel(key: string): string {
  if (key === 'all') return '全部';
  const [k, v] = key.split(':');
  if (k === 'last') return `近 ${v} 年`;
  if (k === 'from') return `${v} 起`;
  if (k === 'year') return `${v} 年`;
  return key;
}

/** 可選的年份（自某年起／只看某年）：依 pack.periods 實際存在的鍵 */
export function yearKeys(pack: Pick<StrategyPack, 'periods'>): { from: string[]; year: string[] } {
  const ks = Object.keys(pack.periods);
  const pick = (p: string) => ks.filter((k) => k.startsWith(`${p}:`)).map((k) => k.slice(p.length + 1)).sort();
  return { from: pick('from'), year: pick('year') };
}

const ym = (iso: string) => `${iso.slice(0, 4)}/${Number(iso.slice(5, 7))}`;

/** 期間不是全部時的說明：「檢視 2022 起・n／708 筆・分級以全期間為準」；small＝n < 100 */
export function periodNote(key: string, view: PeriodView | undefined, allN: number): { text: string; small: boolean } | null {
  if (key === 'all' || !view) return null;
  const [k, v] = key.split(':');
  const what = k === 'year' ? `${v} 年` : k === 'from' ? `${v} 起` : `近 ${v} 年（${ym(view.from)} 起）`;
  return { text: `檢視 ${what}・${view.card.n.toLocaleString('zh-TW')}／${allN.toLocaleString('zh-TW')} 筆・分級以全期間為準`, small: view.card.n < 100 };
}

/** 與期間重疊的年份列 */
export function yearsIn(years: YearRow[], view: Pick<PeriodView, 'from' | 'to'> | undefined): YearRow[] {
  if (!view) return years;
  const a = view.from.slice(0, 4), b = view.to.slice(0, 4);
  return years.filter((y) => y.year >= a && y.year <= b);
}

const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export interface YearSummary {
  m: number;
  avg: number | null; avgB: number | null;
  beat: number;
  loss: number; lossB: number;
  worst: number | null; worstB: number | null;
}

/** 逐年檢視的四個統計格：年平均報酬、勝過基準年數、虧損年數、單年最大虧損（各附基準） */
export function yearSummary(rows: YearRow[], b: PortBench): YearSummary {
  const both = rows.filter((r) => fin(r.port) && fin(r.bench[b]));
  const p = both.map((r) => r.port as number), q = both.map((r) => r.bench[b] as number);
  return {
    m: both.length,
    avg: mean(p), avgB: mean(q),
    beat: both.filter((r) => (r.port as number) > (r.bench[b] as number)).length,
    loss: p.filter((x) => x < 0).length, lossB: q.filter((x) => x < 0).length,
    worst: p.length ? Math.min(...p) : null, worstB: q.length ? Math.min(...q) : null,
  };
}

export interface Signals {
  n: number;
  signal?: string[]; entry?: (string | null)[]; code?: string[];
  [k: string]: unknown;
}

/** 期間內的逐筆索引（以訊號日判斷，與期間檢視的筆數一致） */
export function signalIdx(sig: Signals | null | undefined, from: string, to: string): number[] {
  const d = sig?.signal ?? [];
  const out: number[] = [];
  for (let i = 0; i < d.length; i++) if (d[i] >= from && d[i] <= to) out.push(i);
  return out;
}

export const exKey = (b: BenchKey) => `ex_${b}`;

/** 逐筆 40 日超額（相對所選基準） */
export function excessOf(sig: Signals | null | undefined, idx: number[], b: BenchKey): { i: number; v: number }[] {
  const col = (sig?.[exKey(b)] as (number | null)[] | undefined) ?? [];
  return idx.map((i) => ({ i, v: col[i] as number })).filter((x) => fin(x.v));
}

export interface Hist { lo: number; width: number; counts: number[]; mean: number | null; median: number | null; n: number; under: number; over: number }

/** 分布直方圖：區間取 1%–99% 分位（兩端以外合併到第一／最後一格並計數），格寬取整數 % */
export function histogram(vals: number[], bins = 24): Hist {
  const s = vals.filter(fin).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { lo: 0, width: 1, counts: [], mean: null, median: null, n: 0, under: 0, over: 0 };
  const q = (p: number) => s[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  let a = Math.floor(q(0.01)), b = Math.ceil(q(0.99));
  if (b <= a) b = a + 1;
  const width = Math.max(1, Math.ceil((b - a) / bins));
  a = Math.floor(a / width) * width;
  const k = Math.max(1, Math.ceil((b - a) / width));
  const counts = new Array<number>(k).fill(0);
  let under = 0, over = 0;
  for (const v of s) {
    let j = Math.floor((v - a) / width);
    if (j < 0) { under++; j = 0; }
    if (j >= k) { over++; j = k - 1; }
    counts[j]++;
  }
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { lo: a, width, counts, mean: mean(s), median, n, under, over };
}

/** 最大與最小 k 筆（依超額） */
export function extremes(xs: { i: number; v: number }[], k = 10): { top: { i: number; v: number }[]; bottom: { i: number; v: number }[] } {
  const s = xs.slice().sort((a, b) => b.v - a.v);
  return { top: s.slice(0, k), bottom: s.slice(-k).reverse() };
}

/** 週資料的年份淡色直條：每一年的起訖索引 */
export function yearStripes(dates: string[]): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = [];
  dates.forEach((d, i) => {
    const y = d.slice(0, 4);
    const last = out[out.length - 1];
    if (last && last.label === y) last.to = i;
    else out.push({ from: i, to: i, label: y });
  });
  // 標籤只留得下的：首尾不完整年份的寬度很窄時省略文字（直條保留）
  return out.map((s) => ({ ...s, to: Math.min(dates.length - 1, s.to + (s.to < dates.length - 1 ? 1 : 0)) }));
}

/** 滾動 3 年圖上標出所選期間（以月份索引） */
export function monthMark(months: string[], from: string, to: string): { from: number; to: number } | null {
  if (!months.length) return null;
  const a = months.findIndex((m) => m >= from.slice(0, 7));
  let b = -1;
  for (let i = months.length - 1; i >= 0; i--) if (months[i] <= to.slice(0, 7)) { b = i; break; }
  if (a < 0 || b < 0 || b < a) return null;
  return { from: a, to: b };
}
