/**
 * 個股頁走勢圖的資料（SPEC §5.4，stock 2026-10）：純函式。
 * - 1M 以上：日 K（開高低收、成交量張）＋ 20／60 日均線；K 棒超過 MAX_DAILY_BARS 根時合成週 K（開＝週首開、高低＝週內極值、
 *   收＝週末收、量＝週合計），均線取每週最後一天的值。價格基準（還原／原始）由頁面決定：還原＝開高低收 × 當日還原因子。
 * - 5Y／ALL 超過個股檔範圍時改用長歷史檔（只有收盤）：只能畫折線、沒有成交量；ALL 為週線取樣。
 * - 1D／1W：個股 5 分 K（原始價、量為股 → 換成張）；1D＝最近一個交易日、1W＝最近 5 個交易日；虛線＝前收（1W 為第一天的前收）。
 * - 區間漲跌＝最後收盤 ÷ 基準 − 1；日 K 的基準＝區間第一根（區間開始前最後一個交易日）收盤，與 HeroChart 相同。
 */
import type { LongHistory, StockHistory, StockIntraday } from '../data/types';
import { LONG_PERIODS, WEEKLY_PERIODS, periodStart, weekKey, weeklyIndices, type Period } from './periods';
import type { RangeBasis } from './rangeReturn';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Bar {
  /** 日期（YYYY-MM-DD）或盤中時間（YYYY-MM-DDTHH:MM） */
  t: string;
  o: N;
  h: N;
  l: N;
  c: number;
  /** 成交量（張） */
  v: N;
  /** 前一根（日 K：前一個交易日；盤中：當日前收）收盤，給「該日漲跌」讀值 */
  prev: N;
}

export type ChartKind = 'daily' | 'weekly' | 'close' | 'intraday';

export interface ChartSeries {
  kind: ChartKind;
  bars: Bar[];
  /** 區間漲跌的基準；盤中為前收（虛線） */
  base: number;
  /** 盤中：是否畫前收虛線 */
  baseLine: boolean;
  ma20: N[];
  ma60: N[];
  /** 有開高低（可畫 K 線） */
  ohlc: boolean;
  hasVolume: boolean;
  /** 1W：每一天第一根的索引（日分隔線） */
  dayStarts: number[];
  /** 區間資料不足（個股上市不到所選期間） */
  truncated: boolean;
  /** 視窗實際涵蓋的交易日數與起日（週 K、週線取樣前） */
  span?: { days: number; since: string };
}

export const STOCK_CHART_PERIODS: Period[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'];
export const INTRADAY_PERIODS: Period[] = ['1D', '1W'];
/** 日 K 超過這麼多根改畫週 K（370pt 寬約 1.2pt／根以下已看不出 K 棒） */
export const MAX_DAILY_BARS = 300;

/** 簡單移動平均（缺值跳過但仍佔位；需要 n 個有效值）。 */
export function maOver(values: N[], n: number): N[] {
  const out: N[] = [];
  const win: number[] = [];
  let s = 0;
  for (const v of values) {
    if (ok(v)) {
      win.push(v);
      s += v;
      if (win.length > n) s -= win.shift()!;
    }
    out.push(ok(v) && win.length === n ? s / n : null);
  }
  return out;
}

/** 週 K：同一 ISO 週合成一根。均線取每週最後一天。 */
export function weeklyAggregate(bars: Bar[], ma20: N[], ma60: N[]): { bars: Bar[]; ma20: N[]; ma60: N[] } {
  const out: Bar[] = [];
  const m20: N[] = [];
  const m60: N[] = [];
  let cur: Bar | null = null;
  let key = '';
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const k = weekKey(b.t.slice(0, 10));
    if (!cur || k !== key) {
      if (cur) out.push(cur);
      cur = { ...b };
      key = k;
      m20.push(ma20[i] ?? null);
      m60.push(ma60[i] ?? null);
      continue;
    }
    cur.h = ok(cur.h) && ok(b.h) ? Math.max(cur.h, b.h) : cur.h ?? b.h;
    cur.l = ok(cur.l) && ok(b.l) ? Math.min(cur.l, b.l) : cur.l ?? b.l;
    cur.c = b.c;
    cur.t = b.t;
    cur.v = ok(cur.v) || ok(b.v) ? (cur.v ?? 0) + (b.v ?? 0) : null;
    m20[m20.length - 1] = ma20[i] ?? null;
    m60[m60.length - 1] = ma60[i] ?? null;
  }
  if (cur) out.push(cur);
  // 週 K 的 prev＝前一週收盤
  for (let i = 0; i < out.length; i++) out[i].prev = i > 0 ? out[i - 1].c : out[i].prev;
  return { bars: out, ma20: m20, ma60: m60 };
}

/** 日 K（或週 K、長歷史收盤）視窗。 */
export function dailySeries(h: Pick<StockHistory, 'd' | 'o' | 'h' | 'l' | 'c' | 'v' | 'af'>, period: Period, basis: RangeBasis, long?: LongHistory | null): ChartSeries | null {
  const useLong = !!long && LONG_PERIODS.includes(period) && long.d.length > h.d.length && (period === 'ALL' || periodStart(h.d, period).truncated);
  if (useLong && long) {
    const f = (i: number) => (basis === 'adj' ? long.af[i] ?? 1 : 1);
    const closes = long.c.map((c, i) => (ok(c) ? c * f(i) : null));
    const { start, truncated } = periodStart(long.d, period);
    let idx: number[] = [];
    for (let i = start; i < long.d.length; i++) if (ok(closes[i])) idx.push(i);
    if (WEEKLY_PERIODS.includes(period)) {
      const keep = weeklyIndices(idx.map((i) => long.d[i]));
      idx = keep.map((k) => idx[k]);
    }
    if (idx.length < 2) return null;
    const bars: Bar[] = idx.map((i, k) => ({ t: long.d[i], o: null, h: null, l: null, c: closes[i] as number, v: null, prev: k > 0 ? (closes[idx[k - 1]] as number) : null }));
    const days = long.d.length - start;
    return { kind: 'close', bars, base: bars[0].c, baseLine: false, ma20: bars.map(() => null), ma60: bars.map(() => null), ohlc: false, hasVolume: false, dayStarts: [], truncated, span: { days, since: long.d[start] } };
  }
  const f = (i: number) => (basis === 'adj' ? h.af[i] ?? 1 : 1);
  const sc = (a: N[], i: number) => (ok(a[i]) ? (a[i] as number) * f(i) : null);
  const closes = h.c.map((_, i) => sc(h.c, i));
  const ma20 = maOver(closes, 20);
  const ma60 = maOver(closes, 60);
  const { start, truncated } = periodStart(h.d, period);
  const bars: Bar[] = [];
  const m20: N[] = [];
  const m60: N[] = [];
  let prev: N = null;
  for (let i = 0; i < h.d.length; i++) {
    const c = closes[i];
    if (!ok(c)) continue;
    if (i >= start) {
      bars.push({ t: h.d[i], o: sc(h.o, i), h: sc(h.h, i), l: sc(h.l, i), c, v: ok(h.v[i]) ? h.v[i] : null, prev });
      m20.push(ma20[i]);
      m60.push(ma60[i]);
    }
    prev = c;
  }
  if (!bars.length) return null;
  const base = bars[0].c;
  const span = { days: bars.length, since: bars[0].t };
  if (bars.length > MAX_DAILY_BARS) {
    const w = weeklyAggregate(bars, m20, m60);
    return { kind: 'weekly', bars: w.bars, base, baseLine: false, ma20: w.ma20, ma60: w.ma60, ohlc: true, hasVolume: true, dayStarts: [], truncated, span };
  }
  return { kind: 'daily', bars, base, baseLine: false, ma20: m20, ma60: m60, ohlc: true, hasVolume: true, dayStarts: [], truncated, span };
}

/** 1D／1W 盤中 5 分 K。 */
export function intradaySeries(x: StockIntraday | null | undefined, period: Period): ChartSeries | null {
  if (!x?.days?.length) return null;
  const days = period === '1D' ? x.days.slice(-1) : x.days.slice(-5);
  const bars: Bar[] = [];
  const dayStarts: number[] = [];
  for (const d of days) {
    const first = bars.length;
    for (const [t, o, hi, lo, c, v] of d.bars) {
      if (!ok(c)) continue;
      bars.push({ t: `${d.date}T${t}`, o, h: hi, l: lo, c, v: ok(v) ? v / 1000 : null, prev: d.prev_close });
    }
    if (bars.length > first) dayStarts.push(first);
  }
  if (!bars.length) return null;
  const base = ok(days[0].prev_close) ? days[0].prev_close : bars[0].o ?? bars[0].c;
  return { kind: 'intraday', bars, base, baseLine: ok(days[0].prev_close), ma20: [], ma60: [], ohlc: true, hasVolume: bars.some((b) => ok(b.v)), dayStarts: period === '1W' ? dayStarts : [], truncated: false };
}

/** 價格範圍（含均線、基準），K 線模式用高低、折線模式用收盤。 */
export function priceExtent(s: ChartSeries, candle: boolean): [number, number] {
  let lo = Infinity, hi = -Infinity;
  const add = (v: N | undefined) => { if (ok(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (const b of s.bars) {
    if (candle && s.ohlc) { add(b.h ?? b.c); add(b.l ?? b.c); } else add(b.c);
  }
  for (const v of s.ma20) add(v);
  for (const v of s.ma60) add(v);
  if (s.baseLine) add(s.base);
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-9) { const pad = Math.abs(hi) * 0.01 || 1; return [lo - pad, hi + pad]; }
  return [lo, hi];
}

/** Y 軸整數刻度：步長取 1／2／5 × 10ᵏ（至少 1），約 count 格；回傳範圍內的刻度。 */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  if (!(hi > lo)) return [Math.round(lo)];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

/** 區間漲跌（基準 → 第 at 根）。 */
export function periodChangeAt(s: ChartSeries, at = s.bars.length - 1): { abs: number; pct: number | null } {
  const v = s.bars[at].c;
  return { abs: v - s.base, pct: s.base ? ((v - s.base) / s.base) * 100 : null };
}

/** 第 at 根相對前一根（盤中為當日前收）的漲跌。 */
export function barChange(s: ChartSeries, at = s.bars.length - 1): { abs: number; pct: number | null } | null {
  const b = s.bars[at];
  if (!ok(b.prev)) return null;
  return { abs: b.c - b.prev, pct: b.prev ? ((b.c - b.prev) / b.prev) * 100 : null };
}

/** 所選期間內還原價與原始價是否不同（期間內有除權息、分割等還原事件）→ 才顯示「還原」字樣。 */
export function adjDiffers(h: Pick<StockHistory, 'd' | 'af'>, period: Period): boolean {
  const { start } = periodStart(h.d, period);
  for (let i = Math.max(0, start); i < h.af.length; i++) if (Math.abs((h.af[i] ?? 1) - 1) > 1e-9) return true;
  return false;
}

/** 個股檔最後兩個有收盤的交易日：「當日漲跌」一律用日資料（週 K、週線取樣的相鄰兩點相隔一週）。 */
export function dailyChange(h: Pick<StockHistory, 'd' | 'c' | 'af'>, basis: RangeBasis): { abs: number; pct: number | null; date: string } | null {
  let i = h.c.length - 1;
  while (i >= 0 && !ok(h.c[i])) i--;
  let j = i - 1;
  while (j >= 0 && !ok(h.c[j])) j--;
  if (i < 0 || j < 0) return null;
  const f = (k: number) => (basis === 'adj' ? h.af[k] ?? 1 : 1);
  const a = (h.c[i] as number) * f(i), b = (h.c[j] as number) * f(j);
  return { abs: a - b, pct: b ? ((a - b) / b) * 100 : null, date: h.d[i] };
}
