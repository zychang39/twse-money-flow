/**
 * 順風檢查（2026-11-13；探索 › 報酬拆解 › 順風檢查；定義見 METHODOLOGY §4.12.2；資料 pipeline/derive/tailwind.py）。純函式，可測。
 *
 * 依 Freddy〈法人級選股實戰〉單元 2、3 的做法：每一類查兩個數字（自己過去 12 個月的含息報酬、同期大盤）→ 順風／中性／逆風；
 * 風格用 ETF 當溫度計、類股用證交所類股報酬指數；風格 ETF 超配的類股若也順風，是同一陣風，不能算成兩份。
 * 用途是排研究的優先順序與替報酬定位，不是進出場訊號。
 */
import type { AttrStock, StyleKey, Tailwind, WindSector, WindState, WindStyle } from '../data/types';

type N = number | null | undefined;
const ok = (v: N): v is number => typeof v === 'number' && Number.isFinite(v);

export const WIND_TEXT: Record<WindState, string> = { tail: '順風', neutral: '中性', head: '逆風' };
/** 三種狀態各自的意思（一句話） */
export const WIND_MEANING: Record<WindState, string> = {
  tail: '自己賺錢，而且贏過大盤：這一類正被市場獎勵',
  neutral: '自己賺錢，但沒有贏過大盤：跟著大盤漲上來的',
  head: '自己賠錢：要研究就得逆著風做',
};
export const WIND_ORDER: WindState[] = ['tail', 'neutral', 'head'];

/** 兩個數字 → 三種狀態（與 pipeline 的 state_of 相同；順風檢查表的試算用）。r、rm 為小數；near＝幾個百分點內算幾乎一樣 */
export function windState(r: N, rm: N, near = 1): WindState | null {
  if (!ok(r) || !ok(rm)) return null;
  if (r <= 0) return 'head';
  return (r - rm) * 100 > near ? 'tail' : 'neutral';
}

export interface StyleNow { state: WindState | null; provisional: boolean; r: number | null; rm: number | null }

/** 風格目前的狀態：有 12 個月就用 12 個月；未滿 12 個月用有資料以來的同一段期間（暫定） */
export function styleNow(st: WindStyle, tw: Tailwind): StyleNow {
  if (st.state) return { state: st.state, provisional: false, r: st.r['12'] ?? null, rm: tw.market.r['12'] ?? null };
  if (st.since) return { state: st.since.state, provisional: true, r: st.since.r, rm: st.since.rm };
  return { state: null, provisional: false, r: null, rm: null };
}

/** 依狀態分三堆（每堆依 12 個月報酬由高到低） */
export function byState<T extends { state: WindState | null; r: Record<string, number | null> }>(items: T[]): Record<WindState, T[]> {
  const out: Record<WindState, T[]> = { tail: [], neutral: [], head: [] };
  for (const x of items) if (x.state) out[x.state].push(x);
  for (const k of WIND_ORDER) out[k].sort((a, b) => (b.r['12'] ?? -9) - (a.r['12'] ?? -9));
  return out;
}

/** 跟上個月底比：狀態換了的項目 */
export function changed<T extends { state: WindState | null; prev: WindState | null }>(items: T[]): T[] {
  return items.filter((x) => x.state && x.prev && x.state !== x.prev);
}

/** 相對大盤的月報酬的相關（月報酬的同步性）；重疊不到 6 個月 → null */
export function excessCorr(a: (number | null)[], b: (number | null)[], mkt: (number | null)[], idx: number[]): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const i of idx) {
    const x = a[i]; const y = b[i]; const m = mkt[i];
    if (ok(x) && ok(y) && ok(m)) { xs.push(x - m); ys.push(y - m); }
  }
  if (xs.length < 6) return null;
  const mx = xs.reduce((p, v) => p + v, 0) / xs.length;
  const my = ys.reduce((p, v) => p + v, 0) / ys.length;
  let sxy = 0; let sxx = 0; let syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxx > 1e-12 && syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
}

export interface WindPair { a: string; b: string; corr: number }

/**
 * 順風的類股之間：近 12 個月「相對大盤的月報酬」高度同步的組合（可能是同一陣風）。
 * 同步只是線索：要說得出共同的驅動變數（收入是不是最終來自同一群客戶的同一筆支出）才算判斷。
 */
export function sameWindPairs(tw: Tailwind, mkt: (number | null)[], cut = tw.same_wind_corr): WindPair[] {
  const tails = tw.sectors.filter((s) => s.state === 'tail');
  const n = mkt.length;
  const idx = Array.from({ length: Math.min(12, n) }, (_, i) => n - Math.min(12, n) + i);
  const out: WindPair[] = [];
  for (let i = 0; i < tails.length; i++) {
    for (let j = i + 1; j < tails.length; j++) {
      const c = excessCorr(tails[i].m, tails[j].m, mkt, idx);
      if (c !== null && c >= cut) out.push({ a: tails[i].key, b: tails[j].key, corr: c });
    }
  }
  return out.sort((x, y) => y.corr - x.corr);
}

export interface Overweight { s: string; w: number; wm: number; d: number; state: WindState | null }

/** 風格 ETF 跟大盤比、超配最多的幾個類股（至少 1 個百分點；附各自的類股狀態）；沒有持股資料 → [] */
export function overweights(st: WindStyle, tw: Tailwind, n = 3): Overweight[] {
  const by = new Map(tw.sectors.map((x) => [x.key, x.state] as const));
  return (st.weights?.rows ?? []).filter((r) => r.d >= 1).slice(0, n).map((r) => ({ ...r, state: by.get(r.s) ?? null }));
}

/** 低配最多的類股（台股通常是半導體：大盤被單一權值股主導） */
export function biggestUnderweight(st: WindStyle, tw: Tailwind): Overweight | null {
  const rows = st.weights?.rows ?? [];
  const r = rows[rows.length - 1];
  if (!r || r.d >= 0) return null;
  return { ...r, state: tw.sectors.find((x) => x.key === r.s)?.state ?? null };
}

/** 風格贏大盤的那一段裡，類股配置解釋了多少：excess＝贏大盤（小數）、alloc＝類股配置、rest＝其他（比較接近特徵本身） */
export function allocSplit(st: WindStyle, tw: Tailwind): { excess: number; alloc: number; rest: number } | null {
  const r = st.r['12']; const rm = tw.market.r['12']; const a = st.weights?.alloc;
  if (!ok(r) || !ok(rm) || !ok(a)) return null;
  return { excess: r - rm, alloc: a, rest: r - rm - a };
}

export type CellTone = 'prior' | 'ok' | 'mixed' | 'against';
export interface MatrixCell { tone: CellTone; text: string }

/** 3×3 矩陣：風格狀態 × 類股狀態 → 這一格怎麼用（排研究順序，不是進出場） */
export function matrixCell(style: WindState | null, sector: WindState | null): MatrixCell | null {
  if (!style && !sector) return null;
  // 只有一邊有狀態：照有的那一邊說
  if (!style || !sector) {
    const one = (style ?? sector) as WindState;
    const side = style ? '風格' : '類股';
    const other = style ? '沒有對應的類股指數' : '五種特徵都不突出';
    if (one === 'tail') return { tone: 'ok', text: `${side}順風（${other}）：可以優先研究` };
    if (one === 'neutral') return { tone: 'ok', text: `${side}中性（${other}）：可以研究，沒有風幫忙` };
    return { tone: 'against', text: `${side}逆風（${other}）：逆著風做，論述要求更高` };
  }
  if (style === 'tail' && sector === 'tail') return { tone: 'prior', text: '兩邊都順風：優先研究，先問是不是同一陣風' };
  if ((style === 'tail' && sector === 'head') || (style === 'head' && sector === 'tail')) {
    return { tone: 'mixed', text: '兩陣風方向相反：先弄清楚市場在獎勵什麼，這一檔有沒有' };
  }
  if (style === 'head' || sector === 'head') {
    return { tone: 'against', text: style === 'head' && sector === 'head' ? '兩邊都逆風：逆著風做，論述要求更高' : '有一邊逆風：知道自己逆著風做，另一邊也沒有加分' };
  }
  if (style === 'tail') return { tone: 'ok', text: '風格順風、類股中性：可以研究，類股沒有風幫忙' };
  if (sector === 'tail') return { tone: 'ok', text: '類股順風、風格中性：可以研究，風格沒有風幫忙' };
  return { tone: 'ok', text: '兩邊都中性：可以研究，不急；目前沒有風幫忙' };
}

export interface StockWind {
  style: WindStyle | null;
  styleState: WindState | null;
  provisional: boolean;
  sector: WindSector | null;
  sectorState: WindState | null;
  cell: MatrixCell | null;
  /** 兩個都順風時：風格 ETF 有沒有超配這個類股（同一陣風）；持股資料還沒有 → null */
  sameWind: { same: boolean; d: number; etf: string } | null;
}

/** 個股的兩個狀態（所屬風格、所屬類股）與矩陣位置 */
export function stockWind(tw: Tailwind, s: Pick<AttrStock, 'main' | 'sector'>): StockWind {
  const style = s.main ? tw.styles.find((x) => x.key === s.main) ?? null : null;
  const sector = s.sector ? tw.sectors.find((x) => x.key === s.sector) ?? null : null;
  const now = style ? styleNow(style, tw) : null;
  const styleState = now?.state ?? null;
  const sectorState = sector?.state ?? null;
  let sameWind: StockWind['sameWind'] = null;
  if (style && sector && styleState === 'tail' && sectorState === 'tail' && style.weights) {
    const row = style.weights.rows.find((r) => r.s === sector.key);
    const d = row?.d ?? -(sector.w ?? 0);
    sameWind = { same: d > 0, d, etf: style.etf };
  }
  return { style, styleState, provisional: now?.provisional ?? false, sector, sectorState, cell: matrixCell(styleState, sectorState), sameWind };
}

/** 個股屬於哪幾種風格：特徵百分位 ≥ 門檻，或出現在那一檔風格 ETF 的持股裡 */
export function stockStyles(tw: Tailwind, s: Pick<AttrStock, 'styles' | 'held'>): { key: StyleKey; pct: number | null; held: number | null; belongs: boolean }[] {
  return tw.styles.map((st) => {
    const pct = s.styles[st.key] ?? null;
    const held = s.held[st.key] ?? null;
    return { key: st.key, pct, held, belongs: (pct !== null && pct >= tw.style_pct) || held !== null };
  });
}

/** 類股指數被單一權值股主導（最大權值股占比 ≥ 門檻）：類股的狀態反映的可能是那一家 */
export const dominated = (s: WindSector, tw: Tailwind): boolean => !!s.top && s.top.w >= tw.top_weight_warn;
