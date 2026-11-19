/**
 * 順風檢查（2026-11-13；探索 › 順風選股；定義見 METHODOLOGY §4.12.2；資料 pipeline/derive/tailwind.py）。純函式，可測。
 *
 * 依 Freddy〈法人級選股實戰〉單元 2、3 的做法：每一類查兩個數字（自己過去 12 個月的含息報酬、同期大盤）→ 順風／中性／逆風；
 * 風格用 ETF 當溫度計、類股用證交所類股報酬指數；風格 ETF 超配的類股若也順風，是同一陣風，不能算成兩份。
 * 用途是排研究的優先順序與替報酬定位，不是進出場訊號。
 */
import type { AttrStock, AttrTags, StyleKey, Tailwind, WindSector, WindState, WindStyle } from '../data/types';

type N = number | null | undefined;
const ok = (v: N): v is number => typeof v === 'number' && Number.isFinite(v);

export const WIND_TEXT: Record<WindState, string> = { tail: '順風', neutral: '中性', head: '逆風' };
/** 三種狀態各自的意思（一句話） */
export const WIND_MEANING: Record<WindState, string> = {
  tail: '自己賺錢，而且贏過大盤：這一類正被市場獎勵',
  neutral: '自己賺錢，但沒有贏過大盤：跟著大盤漲上來的',
  head: '自己賠錢：可以研究，論述要求更高',
};
export const WIND_ORDER: WindState[] = ['tail', 'neutral', 'head'];
/** 三堆各自怎麼用（排研究的優先順序） */
export const WIND_USE: Record<WindState, string> = {
  tail: '研究時間優先放這裡',
  neutral: '可以研究，沒有加分',
  head: '可以研究，論述要求更高',
};

/**
 * 狀態的寫法全站只有一種（2026-11-19 用詞統一）：順風／中性／逆風；未滿 12 個月的在後面加「（暫定）」。
 * 其他變體（把暫定放前面、用別的動詞形容逆風、用正負形容趨勢）都不用；tailwind.test.ts 會檢查。
 */
export const windLabel = (s: WindState | null | undefined, provisional = false): string => (s ? `${WIND_TEXT[s]}${provisional ? '（暫定）' : ''}` : '資料不足');
/** 兩邊都順風時的第二個問題：同一陣風／不同陣風 */
export const sameWindLabel = (same: boolean): string => (same ? '同一陣風' : '不同陣風');

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
export interface MatrixCell { tone: CellTone; /** 清單與矩陣用的短標 */ short: string; text: string }

/** 3×3 矩陣：風格狀態 × 類股狀態 → 這一格怎麼用（排研究順序，不是進出場）。用詞只有順風／中性／逆風。 */
export function matrixCell(style: WindState | null, sector: WindState | null): MatrixCell | null {
  if (!style && !sector) return null;
  // 只有一邊有狀態：照有的那一邊說
  if (!style || !sector) {
    const one = (style ?? sector) as WindState;
    const side = style ? '風格' : '類股';
    const other = style ? '沒有對應的類股指數' : '五種特徵都不突出';
    const short = `${side}${WIND_TEXT[one]}`;
    if (one === 'tail') return { tone: 'ok', short, text: `${side}順風（${other}）：可以優先研究` };
    if (one === 'neutral') return { tone: 'ok', short, text: `${side}中性（${other}）：可以研究，沒有加分` };
    return { tone: 'against', short, text: `${side}逆風（${other}）：可以研究，論述要求更高` };
  }
  if (style === 'tail' && sector === 'tail') return { tone: 'prior', short: '兩邊都順風', text: '兩邊都順風：優先研究，先問是不是同一陣風' };
  if ((style === 'tail' && sector === 'head') || (style === 'head' && sector === 'tail')) {
    return { tone: 'mixed', short: '一邊順風、一邊逆風', text: '一邊順風、一邊逆風：先弄清楚市場在獎勵什麼，這一檔有沒有' };
  }
  if (style === 'head' || sector === 'head') {
    return style === 'head' && sector === 'head'
      ? { tone: 'against', short: '兩邊都逆風', text: '兩邊都逆風：可以研究，論述要求更高' }
      : { tone: 'against', short: `${style === 'head' ? '風格' : '類股'}逆風`, text: `${style === 'head' ? '風格' : '類股'}逆風、另一邊中性：可以研究，論述要求更高` };
  }
  if (style === 'tail') return { tone: 'ok', short: '風格順風', text: '風格順風、類股中性：可以研究，類股沒有加分' };
  if (sector === 'tail') return { tone: 'ok', short: '類股順風', text: '類股順風、風格中性：可以研究，風格沒有加分' };
  return { tone: 'ok', short: '兩邊都中性', text: '兩邊都中性：可以研究，目前沒有加分' };
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

// ---------------------------------------------------------------- 橫條的刻度（0 與大盤兩條線）

export interface BarScale { lo: number; hi: number; /** 0～1 的位置（超出範圍的夾在兩端） */ x: (v: number) => number; /** 超出刻度（極端值被截斷） */ over: (v: number) => boolean }

/**
 * 一張圖共用的刻度：範圍包含 0、大盤與各列的值；極端值（例：單一權值股撐起的類股 +170%）截在大盤的 2.2 倍，
 * 否則其他列全擠在一起、大盤那條線看不出誰過線。values、rm 為小數。
 */
export function barScale(values: N[], rm: N): BarScale {
  const cap = Math.max(2.2 * Math.abs(ok(rm) ? rm : 0), 0.3);
  const vs = [...values.filter(ok), 0, ok(rm) ? rm : 0];
  const lo = Math.max(Math.min(...vs), -cap);
  let hi = Math.min(Math.max(...vs), cap);
  if (hi - lo < 0.01) hi = lo + 0.01;
  return {
    lo, hi,
    x: (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))),
    over: (v) => v > hi + 1e-9 || v < lo - 1e-9,
  };
}

// ---------------------------------------------------------------- 找股票：從順風的類型到名單

/** tags.json 的一列（舊版資料只有前三欄：其餘補空值） */
export interface TagRow {
  code: string;
  /** 主要風格（最突出的一種）；都不突出 → null */
  main: StyleKey | null;
  sector: string | null;
  /** 屬於哪幾種風格（特徵百分位過門檻，或在那一檔風格 ETF 的持股裡） */
  styles: StyleKey[];
  /** 在風格 ETF 持股裡的權重 % */
  held: Partial<Record<StyleKey, number>>;
  /** 市值（億元） */
  cap: number | null;
  /** 近 12 個月報酬（小數） */
  r12: number | null;
}

export function tagRows(t: AttrTags | null | undefined): TagRow[] {
  return (t?.rows ?? []).map((r) => ({
    code: r[0], main: r[1] ?? null, sector: r[2] ?? null,
    styles: r[3] ?? (r[1] ? [r[1]] : []), held: r[4] ?? {}, cap: r[5] ?? null, r12: r[6] ?? null,
  }));
}

/** 名單上的一檔：兩個狀態與矩陣位置；via＝這一檔是用哪一種風格算狀態的（從某種風格找來的就是那一種，否則是主要風格） */
export interface Candidate extends TagRow { via: StyleKey | null; wind: StockWind; weight: number | null }

const candidate = (tw: Tailwind, r: TagRow, via: StyleKey | null): Candidate => ({
  ...r, via, wind: stockWind(tw, { main: via, sector: r.sector }), weight: via ? r.held[via] ?? null : null,
});
const byCap = (a: TagRow, b: TagRow) => (b.cap ?? -1) - (a.cap ?? -1) || a.code.localeCompare(b.code);

/**
 * 從一種風格找：那一檔風格 ETF 的持股（依權重；課程單元 2 的做法——打開順風類型的持股清單）。
 * wide＝再加上特徵也屬於這一類、但不在 ETF 裡的公司（依市值；通常有幾百檔，預設不列）。依規則產生，非推薦。
 */
export function styleCandidates(tw: Tailwind, rows: TagRow[], key: StyleKey, wide = false): Candidate[] {
  const cs = rows.filter((r) => r.held[key] !== undefined || (wide && r.styles.includes(key))).map((r) => candidate(tw, r, key));
  return cs.sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1) || byCap(a, b));
}

/** 從一個類股找：同產業的公司（依市值）；風格看各自的主要風格 */
export function sectorCandidates(tw: Tailwind, rows: TagRow[], sector: string): Candidate[] {
  return rows.filter((r) => r.sector === sector).sort(byCap).map((r) => candidate(tw, r, r.main));
}

/** 自己的名單（自選或某個群組）：照名單順序；沒有拆解資料的代號（ETF、新上市）不列 */
export function listCandidates(tw: Tailwind, rows: TagRow[], codes: string[]): Candidate[] {
  const by = new Map(rows.map((r) => [r.code, r] as const));
  return codes.flatMap((c) => { const r = by.get(c); return r ? [candidate(tw, r, r.main)] : []; });
}

/** 3×3 矩陣各格的檔數；鍵＝`${風格狀態}-${類股狀態}`，只有一邊有狀態的算在 one */
export function matrixCounts(cs: Candidate[]): { cells: Record<string, number>; one: number } {
  const cells: Record<string, number> = {};
  let one = 0;
  for (const c of cs) {
    const a = c.wind.styleState; const b = c.wind.sectorState;
    if (a && b) cells[`${a}-${b}`] = (cells[`${a}-${b}`] ?? 0) + 1;
    else if (a || b) one += 1;
  }
  return { cells, one };
}
export const cellKey = (c: Candidate): string | null => (c.wind.styleState && c.wind.sectorState ? `${c.wind.styleState}-${c.wind.sectorState}` : null);

/** 能力圈（課程單元 2 的第一步）：熟悉的類股、決定不碰的類股。存在 IndexedDB 的設定（鍵 `circle`） */
export interface Circle { know: string[]; skip: string[] }
export const EMPTY_CIRCLE: Circle = { know: [], skip: [] };
export const normCircle = (c: Partial<Circle> | null | undefined): Circle => ({
  know: Array.isArray(c?.know) ? c.know.filter((x) => typeof x === 'string') : [],
  skip: Array.isArray(c?.skip) ? c.skip.filter((x) => typeof x === 'string') : [],
});
/** 一個類股只會在一邊：設成熟悉就從不碰拿掉，反之亦然；再點一次取消 */
export function toggleCircle(c: Circle, side: keyof Circle, sector: string): Circle {
  const other: keyof Circle = side === 'know' ? 'skip' : 'know';
  const on = c[side].includes(sector);
  return { ...c, [side]: on ? c[side].filter((x) => x !== sector) : [...c[side], sector], [other]: c[other].filter((x) => x !== sector) } as Circle;
}
export const circleOf = (c: Circle, sector: string | null): 'know' | 'skip' | null => (!sector ? null : c.know.includes(sector) ? 'know' : c.skip.includes(sector) ? 'skip' : null);

export interface PoolCheck {
  n: number;
  /** 檔數落在 5～12（少於 5 排不出高下，多於 12 看不完） */
  sizeOk: boolean;
  /** 最多的類股與檔數 */
  top: [string, number] | null;
  /** 超過一半在同一個類股（至少 4 檔才判斷） */
  crowded: boolean;
  /** 兩邊都順風 */
  both: number;
  /** 兩邊都順風而且是同一陣風（風格 ETF 超配這個類股）：不能當成兩份 */
  same: number;
  /** 有任一邊逆風 */
  head: number;
}

/** 名單檢查（課程作業 1 的自評方向）：檔數、是不是押同一個類股、兩邊都順風的有幾檔其實是同一陣風 */
export function poolCheck(cs: Candidate[]): PoolCheck {
  const count = new Map<string, number>();
  for (const c of cs) if (c.sector) count.set(c.sector, (count.get(c.sector) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    n: cs.length,
    sizeOk: cs.length >= 5 && cs.length <= 12,
    top,
    crowded: !!top && cs.length >= 4 && top[1] > cs.length / 2,
    both: cs.filter((c) => c.wind.cell?.tone === 'prior').length,
    same: cs.filter((c) => c.wind.sameWind?.same).length,
    head: cs.filter((c) => c.wind.styleState === 'head' || c.wind.sectorState === 'head').length,
  };
}

/**
 * 未滿 12 個月的風格 ETF：已有幾個月的資料、哪一天滿 12 個月（畫面寫「目前 11.6 個月・12/1 滿 12 個月」，不只寫「資料累積中」）。
 * 新版資料直接帶 months、full；舊版由資料起點推算（起點往後 12 個月的同一天）。
 */
export function sinceInfo(st: Pick<WindStyle, 'since'>, date: string): { months: number; full: string } | null {
  const sn = st.since;
  if (!sn) return null;
  const a = new Date(`${sn.start}T00:00:00Z`);
  const b = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const full = new Date(a);
  full.setUTCFullYear(a.getUTCFullYear() + 1);
  return {
    months: sn.months ?? Math.round(((b.getTime() - a.getTime()) / 86_400_000 / 30.44) * 10) / 10,
    full: sn.full ?? full.toISOString().slice(0, 10),
  };
}
