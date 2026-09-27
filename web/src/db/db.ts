/**
 * 使用者資料（只存在本機 IndexedDB）：自選、設定、選股條件、交易日誌。
 * - 結構有版本號（DB_VERSION）；升級時依序執行 MIGRATIONS。
 * - 匯出為單一 JSON（含 schemaVersion）；匯入舊版本時先套用資料層遷移（EXPORT_MIGRATIONS）。
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';

export const DB_NAME = 'twse-money-flow';
export const DB_VERSION = 3;

/** 自選的來源：自己加入、歡迎卡的範例（可一鍵清除）、從系統清單「熱門動能」複製或挑選。 */
export type WatchOrigin = 'user' | 'sample' | 'hot';

export interface WatchItem {
  code: string;
  group: string;
  addedAt: string;
  order: number;
  note?: string;
  /** v3 起；舊資料在升級時補為 'user' */
  origin?: WatchOrigin;
}

export interface SavedScreen {
  id: string;
  name: string;
  conditions: { field: string; op: string; value: number | [number, number] }[];
  createdAt: string;
}

export interface ChecklistAnswers {
  market: string;
  trend: string;
  revenue: string;
  valuation: string;
  reason: string;
}

export interface Trade {
  id: string;
  code: string;
  name: string;
  status: 'open' | 'closed';
  openedAt: string;
  entry: number;
  shares: number;
  stop: number;
  target: number;
  reasonType: string;
  checklist: ChecklistAnswers;
  closedAt?: string;
  exit?: number;
  review?: string;
  errorTags?: string[];
  fees?: number;
  dividends?: { date: string; cash: number; shares: number }[];
}

/** 紀律行為紀錄（遊戲化）：只記錄紀律行為，不記錄下單次數或損益。day＝該晚儀式對應的資料日期。 */
export type ActivityType = 'brief_read' | 'checklist_done' | 'review_done' | 'ritual_done' | 'backup' | 'backtest_own';
export interface Activity {
  id: string;
  type: ActivityType;
  day: string;
  at: string;
  meta?: Record<string, string | number | boolean>;
}

export interface Setting {
  key: string;
  value: unknown;
}

interface Schema extends DBSchema {
  watchlist: { key: string; value: WatchItem; indexes: { group: string; origin: string } };
  settings: { key: string; value: Setting };
  screens: { key: string; value: SavedScreen };
  trades: { key: string; value: Trade; indexes: { status: string; code: string } };
  activity: { key: string; value: Activity; indexes: { type: string; day: string } };
}

export type StoreName = 'watchlist' | 'settings' | 'screens' | 'trades' | 'activity';
export const STORES: StoreName[] = ['watchlist', 'settings', 'screens', 'trades', 'activity'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpgradeTx = IDBPTransaction<Schema, any, 'versionchange'>;
type Migration = (db: IDBPDatabase<Schema>, tx: UpgradeTx) => void | Promise<void>;

/** 結構遷移：key 為升級後的版本號。新增版本時只能往後加，不改舊的。 */
export const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    const w = db.createObjectStore('watchlist', { keyPath: 'code' });
    w.createIndex('group', 'group');
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('screens', { keyPath: 'id' });
    const t = db.createObjectStore('trades', { keyPath: 'id' });
    t.createIndex('status', 'status');
    t.createIndex('code', 'code');
  },
  2: (db) => {
    const a = db.createObjectStore('activity', { keyPath: 'id' });
    a.createIndex('type', 'type');
    a.createIndex('day', 'day');
  },
  // v3：自選加上來源（origin）與索引；既有自選一律視為使用者自己加入的，資料原樣保留
  3: async (_db, tx) => {
    const store = tx.objectStore('watchlist');
    store.createIndex('origin' as never, 'origin');
    let cursor = await store.openCursor();
    while (cursor) {
      if (!cursor.value.origin) await cursor.update({ ...cursor.value, origin: 'user' });
      cursor = await cursor.continue();
    }
  },
};

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function getDb(name = DB_NAME): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(name, DB_VERSION, {
      async upgrade(db, oldVersion, newVersion, tx) {
        for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) await MIGRATIONS[v]?.(db, tx);
      },
    });
  }
  return dbPromise;
}

/** 測試用：關閉並重設連線。 */
export async function resetDbConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

// ------------------------------------------------------------------ 自選
export async function listWatch(): Promise<WatchItem[]> {
  const items = await (await getDb()).getAll('watchlist');
  return items.sort((a, b) => a.order - b.order);
}

export async function addWatch(code: string, group = '預設', origin: WatchOrigin = 'user'): Promise<boolean> {
  const db = await getDb();
  if (await db.get('watchlist', code)) return false;
  const count = await db.count('watchlist');
  await db.put('watchlist', { code, group, addedAt: new Date().toISOString(), order: count, origin });
  notify();
  return true;
}

/** 一次加入多檔（同一個交易）；已在自選的略過。回傳實際加入的檔數。 */
export async function addWatchMany(codes: string[], group: string, origin: WatchOrigin = 'user'): Promise<number> {
  const db = await getDb();
  const tx = db.transaction('watchlist', 'readwrite');
  let order = await tx.store.count();
  let added = 0;
  const now = new Date().toISOString();
  for (const code of codes) {
    if (await tx.store.get(code)) continue;
    await tx.store.put({ code, group, addedAt: now, order: order++, origin });
    added++;
  }
  await tx.done;
  if (added) notify();
  return added;
}

/** 清除歡迎卡加入的範例自選（使用者自己加入或移到其他群組的不受影響）。 */
export async function clearSampleWatch(): Promise<number> {
  const db = await getDb();
  const items = await db.getAllFromIndex('watchlist', 'origin', 'sample');
  const tx = db.transaction('watchlist', 'readwrite');
  for (const w of items) await tx.store.delete(w.code);
  await tx.done;
  if (items.length) notify();
  return items.length;
}

export async function removeWatch(code: string): Promise<void> {
  await (await getDb()).delete('watchlist', code);
  notify();
}

export async function updateWatch(item: WatchItem): Promise<void> {
  await (await getDb()).put('watchlist', item);
  notify();
}

export async function isWatched(code: string): Promise<boolean> {
  return !!(await (await getDb()).get('watchlist', code));
}

// ------------------------------------------------------------------ 設定
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await getDb()).get('settings', key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('settings', { key, value });
  notify();
}

// ------------------------------------------------------------------ 最近搜尋（存在設定；最多 8 筆，最新在前）
export const RECENT_MAX = 8;
export async function listRecentSearches(): Promise<string[]> {
  return getSetting<string[]>('recentSearches', []);
}
export async function pushRecentSearch(code: string): Promise<void> {
  const cur = await listRecentSearches();
  await setSetting('recentSearches', [code, ...cur.filter((c) => c !== code)].slice(0, RECENT_MAX));
}
export async function clearRecentSearches(): Promise<void> {
  await setSetting('recentSearches', []);
}

// ------------------------------------------------------------------ 選股條件
export async function listScreens(): Promise<SavedScreen[]> {
  return (await getDb()).getAll('screens');
}
export async function saveScreen(s: SavedScreen): Promise<void> {
  await (await getDb()).put('screens', s);
  notify();
}
export async function deleteScreen(id: string): Promise<void> {
  await (await getDb()).delete('screens', id);
  notify();
}

// ------------------------------------------------------------------ 交易日誌
export async function listTrades(): Promise<Trade[]> {
  const all = await (await getDb()).getAll('trades');
  return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}
export async function saveTrade(t: Trade): Promise<void> {
  await (await getDb()).put('trades', t);
  notify();
}
export async function deleteTrade(id: string): Promise<void> {
  await (await getDb()).delete('trades', id);
  notify();
}

// ------------------------------------------------------------------ 紀律行為紀錄（遊戲化）
export async function listActivity(): Promise<Activity[]> {
  return (await getDb()).getAll('activity');
}
export async function logActivity(type: ActivityType, day: string, meta?: Activity['meta']): Promise<Activity> {
  const a: Activity = { id: uid(), type, day, at: new Date().toISOString(), ...(meta ? { meta } : {}) };
  await (await getDb()).put('activity', a);
  notify();
  return a;
}
/** 同一天同類型只記一次（例如「看完今晚簡報」）。 */
export async function logActivityOnce(type: ActivityType, day: string, meta?: Activity['meta']): Promise<boolean> {
  const db = await getDb();
  const existing = await db.getAllFromIndex('activity', 'day', day);
  if (existing.some((a) => a.type === type)) return false;
  await logActivity(type, day, meta);
  return true;
}

// ------------------------------------------------------------------ 變更通知（讓畫面重新讀取）
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  listeners.forEach((fn) => fn());
}
export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
