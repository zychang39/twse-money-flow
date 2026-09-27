/**
 * 使用者資料（只存在本機 IndexedDB）：自選、設定、選股條件、交易日誌。
 * - 結構有版本號（DB_VERSION）；升級時依序執行 MIGRATIONS。
 * - 匯出為單一 JSON（含 schemaVersion）；匯入舊版本時先套用資料層遷移（EXPORT_MIGRATIONS）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'twse-money-flow';
export const DB_VERSION = 2;

export interface WatchItem {
  code: string;
  group: string;
  addedAt: string;
  order: number;
  note?: string;
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
  watchlist: { key: string; value: WatchItem; indexes: { group: string } };
  settings: { key: string; value: Setting };
  screens: { key: string; value: SavedScreen };
  trades: { key: string; value: Trade; indexes: { status: string; code: string } };
  activity: { key: string; value: Activity; indexes: { type: string; day: string } };
}

export type StoreName = 'watchlist' | 'settings' | 'screens' | 'trades' | 'activity';
export const STORES: StoreName[] = ['watchlist', 'settings', 'screens', 'trades', 'activity'];

type Migration = (db: IDBPDatabase<Schema>) => void;

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
};

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function getDb(name = DB_NAME): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(name, DB_VERSION, {
      upgrade(db, oldVersion, newVersion) {
        for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) MIGRATIONS[v]?.(db);
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

export async function addWatch(code: string, group = '預設'): Promise<void> {
  const db = await getDb();
  if (await db.get('watchlist', code)) return;
  const count = await db.count('watchlist');
  await db.put('watchlist', { code, group, addedAt: new Date().toISOString(), order: count });
  notify();
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
