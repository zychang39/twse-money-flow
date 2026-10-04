/**
 * 使用者資料（只存在本機 IndexedDB）：自選、設定、選股條件、交易日誌。
 * - 結構有版本號（DB_VERSION）；升級時依序執行 MIGRATIONS。
 * - 匯出為單一 JSON（含 schemaVersion）；匯入舊版本時先套用資料層遷移（EXPORT_MIGRATIONS）。
 */
import { normCode } from '../lib/code';
import { prepareTrade } from '../lib/ritual';
import { DEFAULT_PORTFOLIO, riskLimitOf, type PortfolioSettings } from '../lib/settings';
import { migrateV5 } from './migrations';
import type { Strategy, TrackedSignal } from '../lib/tracking';
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';

export const DB_NAME = 'twse-money-flow';
export const DB_VERSION = 6;

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

/** 出場原因（v5）：停損、時間停損、規則出場（含達目標價）屬於「依計畫出場」；其他＝主觀判斷或未列在計畫中的原因。 */
export type ExitReason = 'stop' | 'time_stop' | 'rule' | 'other';

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
  /** D-01：平倉時計算的還原因子（進場日之後到平倉日的分割、減資、除權息）；平倉價是當時的價格基準。1 或省略＝沒有公司行動 */
  adjFactor?: number;
  /** D-01：平倉時的公司行動說明（例：已依 2025/6/18 分割調整） */
  adjNote?: string;
  // ---- v5（流程頁：合規交易、經驗值）。舊資料由 MIGRATIONS[5]／EXPORT_MIGRATIONS[5] 補上，saveTrade 會為新資料自動填入 ----
  /** 建立這筆持倉紀錄的時間（ISO）。舊交易補為進場日 00:00（台北），且不晚於遷移時間 */
  createdAt?: string;
  /** 進場前檢查表 7 題完成（舊交易依已存的答案推得：lib/checklist.checklistComplete） */
  checklistDone?: boolean;
  /** 計畫風險金額＝(進場價 − 停損價) × 股數；沒有有效停損（停損 ≤ 0 或 ≥ 進場價）時不存 */
  plannedRisk?: number;
  /** 進場當時的每筆風險上限＝本金 × 每筆風險 %（之後改設定不回溯）；舊交易補為遷移當下的設定 */
  riskLimit?: number;
  /** 出場原因；舊交易沒有（未知），不算依計畫出場 */
  exitReason?: ExitReason;
  /** 第一次寫下檢討的時間（ISO）；舊交易補為該筆的 review_done 紀錄時間，沒有紀錄時為平倉日 12:00（台北） */
  reviewedAt?: string;
  /** 記錄平倉的時間（ISO）；舊交易補為平倉日 12:00（台北），且不晚於遷移時間 */
  closedRecordedAt?: string;
}

/**
 * 流程行為紀錄（遊戲化）：只記錄流程行為，不記錄下單次數或損益。day＝該晚流程對應的資料日期。
 * - v5 新增 weekly_review（週報頁按下完成）、legacy_xp（遷移時的「既有經驗值」，id 固定 'legacy-xp'，meta: { xp, level }）。
 * - ritual_done、checklist_done、review_done 是舊版紀錄：保留，不再計經驗值；ritual_done 只用來保留遷移前的連續天數。
 */
export type ActivityType = 'brief_read' | 'checklist_done' | 'review_done' | 'ritual_done' | 'backup' | 'backtest_own' | 'weekly_review' | 'legacy_xp';
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

/**
 * v6（M4 族群）：使用者的族群資料。
 * - kind='custom'：自訂族群（id 以 u- 開頭），members＝全部成員。
 * - kind='edit'：對內建族群的編輯（id＝edit:{族群 id}），members＝加入的成員、removed＝移除的成員。
 * streams＝分段（上游／中游／下游或自訂名稱）→ 代號；notes＝分段備註（'' 為整個族群的備註）。
 */
export interface UserGroup {
  id: string;
  kind: 'custom' | 'edit';
  base?: string;
  name: string;
  members: string[];
  removed?: string[];
  streams?: Record<string, string[]>;
  notes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface Schema extends DBSchema {
  watchlist: { key: string; value: WatchItem; indexes: { group: string; origin: string } };
  settings: { key: string; value: Setting };
  screens: { key: string; value: SavedScreen };
  trades: { key: string; value: Trade; indexes: { status: string; code: string } };
  activity: { key: string; value: Activity; indexes: { type: string; day: string } };
  strategies: { key: string; value: Strategy };
  tracked: { key: string; value: TrackedSignal; indexes: { strategyId: string } };
  groups: { key: string; value: UserGroup };
}

export type StoreName = 'watchlist' | 'settings' | 'screens' | 'trades' | 'activity' | 'strategies' | 'tracked' | 'groups';
export const STORES: StoreName[] = ['watchlist', 'settings', 'screens', 'trades', 'activity', 'strategies', 'tracked', 'groups'];

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
  // v4：訊號追蹤（S3）：追蹤策略與已記錄的觸發
  4: (db) => {
    db.createObjectStore('strategies', { keyPath: 'id' });
    const t = db.createObjectStore('tracked', { keyPath: 'key' });
    t.createIndex('strategyId', 'strategyId');
  },
  // v5：流程頁（合規交易、經驗值）。交易補上 v5 欄位、既有經驗值與等級原樣寫成一筆 legacy_xp；不刪除、不改動任何既有值
  5: async (_db, tx) => {
    const trades = await tx.objectStore('trades').getAll();
    const activity = await tx.objectStore('activity').getAll();
    const portfolio = (await tx.objectStore('settings').get('portfolio'))?.value as PortfolioSettings | undefined;
    const out = migrateV5({ trades, activity, portfolio }, new Date().toISOString());
    for (const t of out.trades) await tx.objectStore('trades').put(t);
    for (const a of out.addedActivity) await tx.objectStore('activity').put(a);
  },
  // v6：自訂族群與內建族群的編輯（M4）
  6: (db) => {
    db.createObjectStore('groups', { keyPath: 'id' });
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

export async function addWatch(rawCode: string, group = '預設', origin: WatchOrigin = 'user'): Promise<boolean> {
  const code = normCode(rawCode);
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
  for (const code of [...new Set(codes.map(normCode))]) {
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
  await (await getDb()).delete('watchlist', normCode(code));
  notify();
}

export async function updateWatch(item: WatchItem): Promise<void> {
  await (await getDb()).put('watchlist', item);
  notify();
}

export async function isWatched(code: string): Promise<boolean> {
  return !!(await (await getDb()).get('watchlist', normCode(code)));
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
/** 儲存交易；v5 欄位（建立時間、檢查表完成、計畫風險、風險上限快照、檢討時間、平倉紀錄時間）缺少時自動補上（lib/ritual.prepareTrade）。 */
export async function saveTrade(t: Trade): Promise<void> {
  const db = await getDb();
  const prev = await db.get('trades', t.id);
  const portfolio = ((await db.get('settings', 'portfolio'))?.value as PortfolioSettings | undefined) ?? DEFAULT_PORTFOLIO;
  await db.put('trades', prepareTrade(prev, { ...t, code: normCode(t.code) }, riskLimitOf(portfolio), new Date().toISOString()));
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

// ------------------------------------------------------------------ 訊號追蹤（S3）
export async function listStrategies(): Promise<Strategy[]> {
  return (await getDb()).getAll('strategies');
}
export async function saveStrategy(st: Strategy): Promise<void> {
  await (await getDb()).put('strategies', st);
  notify();
}
/** 刪除追蹤策略與它的全部紀錄。 */
export async function deleteStrategy(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['strategies', 'tracked'], 'readwrite');
  await tx.objectStore('strategies').delete(id);
  const keys = await tx.objectStore('tracked').index('strategyId').getAllKeys(id);
  for (const k of keys) await tx.objectStore('tracked').delete(k);
  await tx.done;
  notify();
}
export async function listTracked(): Promise<TrackedSignal[]> {
  return (await getDb()).getAll('tracked');
}
/** 寫入新觸發或出場後的價格；不通知（避免畫面重複計算），由呼叫端決定何時重新讀取。 */
export async function putTracked(rows: TrackedSignal[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  const tx = db.transaction('tracked', 'readwrite');
  for (const r of rows) await tx.store.put(r);
  await tx.done;
}

// ------------------------------------------------------------------ 族群（v6）
export async function listGroups(): Promise<UserGroup[]> {
  return (await getDb()).getAll('groups');
}
export async function getGroup(id: string): Promise<UserGroup | undefined> {
  return (await getDb()).get('groups', id);
}
export async function saveGroup(g: UserGroup): Promise<void> {
  await (await getDb()).put('groups', { ...g, updatedAt: new Date().toISOString() });
  notify();
}
export async function deleteGroup(id: string): Promise<void> {
  await (await getDb()).delete('groups', id);
  notify();
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
