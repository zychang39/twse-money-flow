/**
 * 個股頁的動能、營收成長、獲利品質（純函式；定義見 METHODOLOGY §4.8）。
 * 動能一律用還原收盤；營收用 revenue 表（近 24 個月，年增率）；獲利用 quarters（單季 EPS、毛利率、近四季 ROE）。
 */
import { numberFormat } from './format';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const F1 = numberFormat(1);
const F2 = numberFormat(2);

/** 最後一個交易日的 n 日簡單均線（不足 n 日 → null）。 */
export function smaLast(values: N[], n: number): N {
  const v = values.filter(ok);
  if (v.length < n) return null;
  let s = 0;
  for (let i = v.length - n; i < v.length; i++) s += v[i];
  return s / n;
}

export type Alignment = 'bull' | 'bear' | 'mixed' | 'na';
export const ALIGN_NAME: Record<Alignment, string> = { bull: '多頭排列', bear: '空頭排列', mixed: '均線糾結', na: '均線資料不足' };

export interface MomentumFacts {
  close: N;
  rs: N;
  /** 距 52 週高點 %（≤ 0） */
  dist52: N;
  ma: { n: number; value: N; above: boolean | null }[];
  alignment: Alignment;
  /** 當日量 ÷ 20 日均量 */
  volRatio: N;
}

export const MA_DAYS = [20, 60, 240] as const;

export function momentumFacts(adj: N[], metrics: { rs_percentile?: unknown; dist_52w_high?: unknown; volume_ratio_20?: unknown }): MomentumFacts {
  const vals = adj.filter(ok);
  const close = vals.length ? vals[vals.length - 1] : null;
  const ma = MA_DAYS.map((n) => {
    const value = smaLast(adj, n);
    return { n, value, above: value === null || close === null ? null : close > value };
  });
  const [a, b, c] = ma.map((m) => m.value);
  const alignment: Alignment = a === null || b === null || c === null ? 'na' : a > b && b > c ? 'bull' : a < b && b < c ? 'bear' : 'mixed';
  return {
    close,
    rs: ok(metrics.rs_percentile) ? metrics.rs_percentile : null,
    dist52: ok(metrics.dist_52w_high) ? metrics.dist_52w_high : null,
    ma,
    alignment,
    volRatio: ok(metrics.volume_ratio_20) ? metrics.volume_ratio_20 : null,
  };
}

/** 「RS 87，站上全部均線」「RS 14，跌破 20／240 日線」 */
export function momentumAnswer(f: MomentumFacts): string {
  const rs = f.rs === null ? 'RS —' : `RS ${Math.round(f.rs)}`;
  const known = f.ma.filter((m) => m.above !== null);
  if (!known.length) return `${rs}，均線資料不足`;
  const below = known.filter((m) => !m.above).map((m) => m.n);
  if (!below.length) return `${rs}，站上全部均線`;
  if (below.length === known.length) return `${rs}，跌破全部均線`;
  return `${rs}，跌破 ${below.join('／')} 日線`;
}

// ------------------------------------------------------------------ 營收成長
export interface RevenueRow { ym: string; revenue: number; yoy: N; mom: N }
export interface RevenueFacts {
  /** 近 12 個月（舊到新） */
  last12: RevenueRow[];
  latest: RevenueRow | null;
  /** 最新一個月營收 ≥ 前 11 個月（含）最大值 → 創 12 個月新高 */
  newHigh: boolean;
  /** 由最新一個月往回數，年增率 > 0 的連續月數 */
  growthMonths: number;
  /** 近 3 個月平均年增率 */
  yoy3m: N;
}

export function revenueFacts(rows: RevenueRow[]): RevenueFacts {
  const last12 = rows.slice(-12);
  const latest = rows.length ? rows[rows.length - 1] : null;
  const prior = rows.slice(-12, -1).map((r) => r.revenue);
  const newHigh = !!latest && prior.length >= 11 && latest.revenue >= Math.max(...prior);
  let growthMonths = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const y = rows[i].yoy;
    if (!ok(y) || y <= 0) break;
    growthMonths++;
  }
  const y3 = rows.slice(-3).map((r) => r.yoy).filter(ok);
  return { last12, latest, newHigh, growthMonths, yoy3m: y3.length === 3 ? (y3[0] + y3[1] + y3[2]) / 3 : null };
}

/** 「8 月營收年增 20.6%，創 12 個月新高，連續 12 個月成長」 */
export function revenueAnswer(f: RevenueFacts): string {
  if (!f.latest) return '沒有月營收資料（ETF 或資料累積中）';
  const m = Number(f.latest.ym.slice(5, 7));
  const parts = [`${m} 月營收年增 ${f.latest.yoy === null ? '—' : `${F1.format(f.latest.yoy)}%`}`];
  if (f.newHigh) parts.push('創 12 個月新高');
  if (f.growthMonths >= 2) parts.push(`連續 ${f.growthMonths} 個月成長`);
  return parts.join('，');
}

// ------------------------------------------------------------------ 獲利品質
export interface QuarterRow { period: string; revenue: N; gross_margin: N; net_income: N; eps?: N; roe?: N }
export interface ProfitFacts {
  quarters: QuarterRow[];
  /** 近四季 EPS 合計（任一季缺 → null） */
  eps4: N;
  /** 去年同期的近四季 EPS 合計 */
  eps4Prev: N;
  gm: N;
  /** 毛利率與去年同季相比（百分點） */
  gmYoY: N;
  roe: N;
}

function sum4(qs: QuarterRow[]): N {
  if (qs.length < 4) return null;
  let s = 0;
  for (const q of qs) { if (!ok(q.eps)) return null; s += q.eps; }
  return s;
}

export function profitFacts(quarters: QuarterRow[]): ProfitFacts {
  const q = quarters;
  const n = q.length;
  const last = n ? q[n - 1] : null;
  const ly = n >= 5 ? q[n - 5] : null;
  return {
    quarters: q,
    eps4: sum4(q.slice(-4)),
    eps4Prev: n >= 8 ? sum4(q.slice(-8, -4)) : null,
    gm: last && ok(last.gross_margin) ? last.gross_margin : null,
    gmYoY: last && ly && ok(last.gross_margin) && ok(ly.gross_margin) ? last.gross_margin - ly.gross_margin : null,
    roe: last && ok(last.roe) ? last.roe : null,
  };
}

/** 「近四季 EPS 8.00 元，ROE 15.2%，毛利率較去年同季 +1.3 個百分點」 */
export function profitAnswer(f: ProfitFacts): string {
  if (!f.quarters.length) return '沒有季財報資料';
  const parts: string[] = [];
  if (f.eps4 !== null) parts.push(`近四季 EPS ${F2.format(f.eps4)} 元${f.eps4Prev ? `（去年同期 ${F2.format(f.eps4Prev)}）` : ''}`);
  if (f.roe !== null) parts.push(`ROE ${F1.format(f.roe)}%`);
  if (f.gmYoY !== null) parts.push(`毛利率較去年同季 ${f.gmYoY >= 0 ? '+' : '−'}${F1.format(Math.abs(f.gmYoY))} 個百分點`);
  return parts.length ? parts.join('，') : '季財報欄位不足';
}

// ------------------------------------------------------------------ 本益比河流
/** 百分位（線性內插；p 為 0–100）。 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = ((sorted.length - 1) * p) / 100;
  const a = Math.floor(k);
  const b = Math.min(sorted.length - 1, a + 1);
  return sorted[a] + (sorted[b] - sorted[a]) * (k - a);
}

export interface PeRiver {
  dates: string[];
  close: N[];
  /** 本益比倍數（自身區間第 20／50／80 百分位）與對應的股價線＝倍數 × 隱含 EPS（收盤 ÷ 本益比） */
  bands: { p: number; pe: number; values: N[] }[];
}

/**
 * 本益比河流：區間（預設近 3 年＝750 個交易日）內本益比的第 20／50／80 百分位 × 每日隱含近四季 EPS。
 * 與合理價「本益比河流」方法一致（fair.methods），只是畫成逐日的線；本益比 ≤ 0 或缺值的日子不畫。
 * 隱含 EPS＝收盤 ÷ 本益比，取近 20 個交易日的中位數去除四捨五入雜訊。
 */
export function peRiver(dates: string[], close: N[], pe: N[], days = 750, ps = [20, 50, 80]): PeRiver | null {
  const start = Math.max(0, dates.length - days);
  const d = dates.slice(start);
  const c = close.slice(start);
  const p = pe.slice(start);
  const valid = p.filter((v): v is number => ok(v) && v > 0).sort((a, b) => a - b);
  if (valid.length < 20) return null;
  const raw = c.map((x, i) => (ok(x) && ok(p[i]) && p[i]! > 0 ? x / p[i]! : null));
  // 隱含 EPS 理論上一季才變一次；官方本益比只到小數 2 位，逐日相除會有雜訊 → 取近 20 日中位數
  const eps = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 19), i + 1).filter(ok).sort((a, b) => a - b);
    return w.length ? percentile(w, 50) : null;
  });
  return {
    dates: d,
    close: c,
    bands: ps.map((q) => {
      const m = percentile(valid, q);
      return { p: q, pe: m, values: eps.map((e) => (e === null ? null : e * m)) };
    }),
  };
}
