/**
 * v3 M5-2 列表排序（策略庫、指標效度表、選股內建條件共用）。
 * 指標效度表與選股：預設判定分級（有效 → 環境依賴 → 不穩定 → 樣本不足／受限 → 無效）→ 同級內先依有效性排名（有值時）、再依日曆時間法 t 值由高到低。
 * 策略庫（2026-10-02 分級版）：預設有效性排名（1 在前、沒有排名的在後），另有校正後 t、40 日扣成本超額、勝率、每月觸發數、類別。
 * 不預設依超額報酬排序（超額大的常是樣本少、t 低的指標）。選擇存 localStorage（每個列表各自一個鍵）。
 */

export type SortKey = 'verdict' | 't' | 'excess' | 'health' | 'today' | 'name' | 'rank' | 't_corr' | 'win' | 'per_month' | 'family';
export type SortDir = 'desc' | 'asc';
export interface SortState { key: SortKey; dir: SortDir }
export interface SortOption { key: SortKey; label: string }
/** 一個列表可用的選項與預設值 */
export interface SortOptions { options: SortOption[]; fallback: SortState }

export interface Sortable {
  label: string;
  verdict?: string | null;
  t?: number | null;
  excess?: number | null;
  health?: number | null;
  today?: number | null;
  /** 2026-10-01 精簡清單的有效性排名（1 最前）；有值時預設排序同級內先依排名 */
  rank?: number | null;
  t_corr?: number | null;
  win?: number | null;
  per_month?: number | null;
  family?: string | null;
}

/** 指標效度表、選股內建條件 */
export const SORT_OPTIONS: SortOption[] = [
  { key: 'verdict', label: '判定分級（預設）' },
  { key: 't', label: '證據強度（t）' },
  { key: 'excess', label: '10 日超額' },
  { key: 'health', label: '近期健康度' },
  { key: 'today', label: '今日新觸發數' },
  { key: 'name', label: '名稱' },
];

/** 策略庫（三個分級區塊共用同一個選擇） */
export const STRATEGY_SORT_OPTIONS: SortOption[] = [
  { key: 'rank', label: '有效性排名（預設）' },
  { key: 't_corr', label: '校正後 t' },
  { key: 'excess', label: '40 日扣成本超額' },
  { key: 'win', label: '勝率' },
  { key: 'per_month', label: '每月觸發數' },
  { key: 'family', label: '類別' },
];

export const DEFAULT_SORT: SortState = { key: 'verdict', dir: 'desc' };
export const STRATEGY_DEFAULT_SORT: SortState = { key: 'rank', dir: 'asc' };

export const EVIDENCE_SORT: SortOptions = { options: SORT_OPTIONS, fallback: DEFAULT_SORT };
export const STRATEGY_SORT: SortOptions = { options: STRATEGY_SORT_OPTIONS, fallback: STRATEGY_DEFAULT_SORT };

/** 文字型與排名型的鍵預設由小到大（名稱筆畫、類別筆畫、排名 1 在前）。 */
export const defaultDir = (key: SortKey): SortDir => (key === 'name' || key === 'family' || key === 'rank' ? 'asc' : 'desc');

/** 方向按鈕的文字：[由高到低, 由低到高] 的對應說法。 */
export function dirLabels(key: SortKey): { desc: string; asc: string } {
  if (key === 'name' || key === 'family') return { desc: '筆畫多到少', asc: '筆畫少到多' };
  if (key === 'rank') return { desc: '排名後的在前', asc: '排名前的在前' };
  return { desc: '由高到低', asc: '由低到高' };
}

/** 判定分級：數字越小越前面。 */
export function verdictTier(v: string | null | undefined): number {
  switch (v) {
    case '有效': return 0;
    case '環境依賴': return 1;
    case '不穩定': return 2;
    case '樣本不足':
    case '樣本範圍受限': return 3;
    case '無效': return 4;
    default: return 5;
  }
}

const num = (v: number | null | undefined, dir: SortDir): number =>
  v === null || v === undefined || !Number.isFinite(v) ? (dir === 'desc' ? -Infinity : Infinity) : v;

/** 數值比較：空值一律排最後（不論方向）。 */
function cmpNum(a: number | null | undefined, b: number | null | undefined, dir: SortDir): number {
  const sign = dir === 'desc' ? -1 : 1;
  const va = num(a, dir), vb = num(b, dir);
  const na = !Number.isFinite(va), nb = !Number.isFinite(vb);
  if (na !== nb) return na ? 1 : -1;
  if (na && nb) return 0;
  return va === vb ? 0 : (va - vb) * sign;
}

/** 排序（不改變原陣列）；空值一律排在最後，同值依名稱。 */
export function sortItems<T extends Sortable>(items: T[], s: SortState): T[] {
  const sign = s.dir === 'desc' ? -1 : 1;
  const byName = (a: T, b: T) => a.label.localeCompare(b.label, 'zh-Hant');
  return [...items].sort((a, b) => {
    let d: number;
    if (s.key === 'verdict') {
      // 由高到低＝有效在前；同級內 t 由高到低（方向反轉時整體倒過來）
      d = (verdictTier(a.verdict) - verdictTier(b.verdict)) * -sign;
      if (!d && (a.rank != null || b.rank != null)) d = (num(a.rank, 'asc') - num(b.rank, 'asc')) * -sign;
      if (!d) d = (num(b.t, 'desc') - num(a.t, 'desc')) * -sign;
    } else if (s.key === 'name') {
      d = byName(a, b) * (s.dir === 'asc' ? 1 : -1);
    } else if (s.key === 'family') {
      // 類別筆畫 → 同類別內依有效性排名（1 在前，沒有排名的在後）
      const fa = a.family ?? '', fb = b.family ?? '';
      if (!fa !== !fb) return fa ? -1 : 1;
      d = fa.localeCompare(fb, 'zh-Hant') * (s.dir === 'asc' ? 1 : -1);
      if (!d) d = cmpNum(a.rank, b.rank, 'asc');
    } else {
      d = cmpNum(a[s.key], b[s.key], s.dir);
    }
    return d || byName(a, b);
  });
}

export function sortLabel(s: SortState, opts: SortOptions = EVIDENCE_SORT): string {
  const all = [...opts.options, ...SORT_OPTIONS, ...STRATEGY_SORT_OPTIONS];
  const opt = all.find((o) => o.key === s.key)?.label.replace('（預設）', '') ?? '';
  return `${opt}・${dirLabels(s.key)[s.dir]}`;
}

export function loadSort(list: string, opts: SortOptions = EVIDENCE_SORT): SortState {
  try {
    const raw = localStorage.getItem(`tmf-sort-${list}`);
    const v = raw ? (JSON.parse(raw) as Partial<SortState>) : null;
    if (v && opts.options.some((o) => o.key === v.key) && (v.dir === 'asc' || v.dir === 'desc')) return { key: v.key as SortKey, dir: v.dir };
  } catch {
    /* 私密瀏覽、被封鎖：用預設 */
  }
  return opts.fallback;
}

export function saveSort(list: string, s: SortState): void {
  try {
    localStorage.setItem(`tmf-sort-${list}`, JSON.stringify(s));
  } catch {
    /* 不影響畫面 */
  }
}
