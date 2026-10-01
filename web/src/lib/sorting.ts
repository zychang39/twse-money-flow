/**
 * v3 M5-2 列表排序（策略庫、指標效度表、選股內建條件共用）。
 * 預設：判定分級（有效 → 環境依賴 → 不穩定 → 樣本不足／受限 → 無效）→ 同級內先依有效性排名（2026-10-01 精簡清單，有值時）、再依日曆時間法 t 值由高到低。
 * 不預設依超額報酬排序（超額大的常是樣本少、t 低的指標）。選擇存 localStorage（每個列表各自一個鍵）。
 */

export type SortKey = 'verdict' | 't' | 'excess' | 'health' | 'today' | 'name';
export type SortDir = 'desc' | 'asc';
export interface SortState { key: SortKey; dir: SortDir }

export interface Sortable {
  label: string;
  verdict?: string | null;
  t?: number | null;
  excess?: number | null;
  health?: number | null;
  today?: number | null;
  /** 2026-10-01 精簡清單的有效性排名（1 最前）；有值時預設排序同級內先依排名 */
  rank?: number | null;
}

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'verdict', label: '判定分級（預設）' },
  { key: 't', label: '證據強度（t）' },
  { key: 'excess', label: '10 日超額' },
  { key: 'health', label: '近期健康度' },
  { key: 'today', label: '今日新觸發數' },
  { key: 'name', label: '名稱' },
];

export const DEFAULT_SORT: SortState = { key: 'verdict', dir: 'desc' };

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
    } else {
      const va = num(a[s.key], s.dir), vb = num(b[s.key], s.dir);
      const na = !Number.isFinite(va), nb = !Number.isFinite(vb);
      if (na !== nb) return na ? 1 : -1;
      d = va === vb ? 0 : (va - vb) * sign;
    }
    return d || byName(a, b);
  });
}

export function sortLabel(s: SortState): string {
  const opt = SORT_OPTIONS.find((o) => o.key === s.key)?.label.replace('（預設）', '') ?? '';
  const dir = s.key === 'name' ? (s.dir === 'asc' ? '筆畫少到多' : '筆畫多到少') : s.dir === 'desc' ? '由高到低' : '由低到高';
  return `${opt}・${dir}`;
}

export function loadSort(list: string): SortState {
  try {
    const raw = localStorage.getItem(`tmf-sort-${list}`);
    const v = raw ? (JSON.parse(raw) as Partial<SortState>) : null;
    if (v && SORT_OPTIONS.some((o) => o.key === v.key) && (v.dir === 'asc' || v.dir === 'desc')) return { key: v.key as SortKey, dir: v.dir };
  } catch {
    /* 私密瀏覽、被封鎖：用預設 */
  }
  return DEFAULT_SORT;
}

export function saveSort(list: string, s: SortState): void {
  try {
    localStorage.setItem(`tmf-sort-${list}`, JSON.stringify(s));
  } catch {
    /* 不影響畫面 */
  }
}
