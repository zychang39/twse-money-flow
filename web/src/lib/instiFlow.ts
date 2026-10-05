/**
 * 個股籌碼分頁「法人」區塊（2026-10-06 合併舊摘要表、舊每日表與每日明細子頁的法人分段）。純函式，可測。
 * 資料一律用個股檔的 chip 區塊（chipRows；與每日明細同一套，最多 60 個交易日＋前一日種子列）。
 * - 區間合計：先以股數相加再換算（sumConverted）；佔量＝區間淨買賣超 ÷ 同期成交量，只計已公布的日子。
 * - 三大法人合計用官方數字（chip.tot），不自行加總。
 */
import { type ChipBlock, type ChipRow, VIEW_COLS, type ViewCol, chipRows, recent, sumConverted, streak } from './chips';
import type { InstParty } from './stockFacts';

export const INSTI_PERIODS = [5, 10, 20, 60] as const;
export type InstiDays = (typeof INSTI_PERIODS)[number];
/** 20、60 日預設只列最新 10 列，其餘就地展開 */
export const INSTI_FOLD = 10;
export const INSTI_PARTIES: InstParty[] = ['foreign', 'trust', 'dealer', 'total'];
export const INSTI_PARTY_LABEL: Record<InstParty, string> = { foreign: '外資', trust: '投信', dealer: '自營商', total: '合計' };
/** 表格欄（沿用每日明細的欄定義：外資含外資自營商、自營商＝自行＋避險、合計＝官方三大法人合計） */
export const INSTI_COLS: Record<InstParty, ViewCol> = {
  foreign: VIEW_COLS.insti[0],
  trust: VIEW_COLS.insti[1],
  dealer: VIEW_COLS.insti[2],
  total: VIEW_COLS.insti[3],
};

// ------------------------------------------------------------------ 使用者上次選的區間與法人（全站共用，localStorage）
export const PREFS_KEY = 'tmf-insti';
export interface InstiPrefs { days: InstiDays; party: InstParty }
export const DEFAULT_PREFS: InstiPrefs = { days: 20, party: 'foreign' };

export function parsePrefs(raw: string | null | undefined): InstiPrefs {
  try {
    const p = JSON.parse(raw ?? 'null') as Partial<InstiPrefs> | null;
    const days = INSTI_PERIODS.includes(p?.days as InstiDays) ? (p!.days as InstiDays) : DEFAULT_PREFS.days;
    const party = INSTI_PARTIES.includes(p?.party as InstParty) ? (p!.party as InstParty) : DEFAULT_PREFS.party;
    return { days, party };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function loadPrefs(): InstiPrefs {
  try { return parsePrefs(localStorage.getItem(PREFS_KEY)); } catch { return DEFAULT_PREFS; }
}

export function savePrefs(p: InstiPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* 私密瀏覽、儲存空間已滿：只是不記住 */ }
}

// ------------------------------------------------------------------ 區間
export interface PartyTotal { party: InstParty; lots: number | null; pctVolume: number | null; streak: number }

export interface InstiWindow {
  days: number;
  /** 新到舊 */
  rows: ChipRow[];
  /** 全部列（舊到新，含種子列） */
  all: ChipRow[];
  /** 區間內沒有三大法人資料的日子（新到舊） */
  missing: string[];
  totals: Record<InstParty, PartyTotal>;
}

const hasInsti = (r: ChipRow) => r.total !== null || r.foreign !== null || r.trust !== null || r.dealer !== null;

export function instiWindow(chip: ChipBlock | null | undefined, days: number): InstiWindow | null {
  if (!chip || chip.d.length < 2) return null;
  const all = chipRows(chip);
  const rows = recent(all, days);
  const totals = Object.fromEntries(INSTI_PARTIES.map((p) => [p, {
    party: p,
    lots: sumConverted(rows, p, 'lots'),
    pctVolume: sumConverted(rows, p, 'pct'),
    // 連續天數從最新一個已公布的日子往回數（尚未公布的日子不打斷連續）
    streak: streak(all.slice(1).filter(hasInsti).map((r) => r[p])),
  }])) as Record<InstParty, PartyTotal>;
  return { days, rows, all, missing: rows.filter((r) => !hasInsti(r)).map((r) => r.date), totals };
}

/** 區間內單日絕對值最大（張）；沒有資料為 null */
export function maxAbsLots(rows: ChipRow[], party: InstParty): number | null {
  let m: number | null = null;
  for (const r of rows) {
    const v = r[party];
    if (v === null) continue;
    m = Math.max(m ?? 0, Math.abs(v / 1000));
  }
  return m;
}

/** 摘要標題：「外資連賣 3 日・投信無連續」 */
export function streakTitle(t: Record<InstParty, PartyTotal>): string {
  const s = (n: number) => (n === 0 ? '無連續' : `連${n > 0 ? '買' : '賣'} ${Math.abs(n)}${Math.abs(n) >= 60 ? '+' : ''} 日`);
  return `外資${s(t.foreign.streak)}・投信${s(t.trust.streak)}`;
}

/** 表格目前顯示的列：5、10 日全部；20、60 日預設最新 10 列 */
export function shownCount(total: number, expanded: boolean): number {
  return expanded ? total : Math.min(total, INSTI_FOLD);
}
