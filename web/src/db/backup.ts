/** 單一 JSON 匯出／匯入。匯入舊版匯出檔時，依 EXPORT_MIGRATIONS 逐版升級資料格式。 */
import { DB_VERSION, STORES, getDb, setSetting, type StoreName } from './db';

export const APP_ID = 'twse-money-flow';

export interface BackupFile {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  stores: Partial<Record<StoreName, unknown[]>>;
}

type ExportMigration = (data: BackupFile) => BackupFile;
/** key = 目標版本；把 (key-1) 版的匯出格式轉為 key 版。 */
export const EXPORT_MIGRATIONS: Record<number, ExportMigration> = {
  // v2：新增紀律行為紀錄（遊戲化），舊備份沒有這個 store
  2: (d) => ({ ...d, stores: { ...d.stores, activity: d.stores.activity ?? [] } }),
  // v3：自選加上來源（origin）；舊備份的自選都是使用者自己加入的
  3: (d) => ({
    ...d,
    stores: { ...d.stores, watchlist: (d.stores.watchlist ?? []).map((w) => ({ origin: 'user', ...(w as object) })) },
  }),
};

export async function exportAll(): Promise<BackupFile> {
  const db = await getDb();
  const stores: BackupFile['stores'] = {};
  for (const name of STORES) stores[name] = await db.getAll(name);
  return { app: APP_ID, schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), stores };
}

/** 各 store 的主鍵（與 db.ts 的 keyPath 相同） */
const KEY_PATH: Record<StoreName, string> = { watchlist: 'code', settings: 'key', screens: 'id', trades: 'id', activity: 'id' };
/** 從哪個版本起一定有這個 store（v2 才有 activity） */
const SINCE: Record<StoreName, number> = { watchlist: 0, settings: 0, screens: 0, trades: 0, activity: 2 };

/**
 * E-04：寫入任何資料之前先完整驗證。schemaVersion 必須是整數；該版本應有的 store 都要是陣列；
 * 每一列都要是物件且有主鍵（字串或數字、不可空白）。任何一項不符就拒絕，現有資料完全不動。
 */
export function validateBackup(raw: unknown): BackupFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('檔案格式錯誤：不是備份檔');
  const d = raw as Partial<BackupFile>;
  if (d.app !== APP_ID) throw new Error('不是 twse-money-flow 的備份檔');
  if (typeof d.schemaVersion !== 'number' || !Number.isInteger(d.schemaVersion) || d.schemaVersion < 0) {
    throw new Error('備份檔缺少有效的版本號（schemaVersion）');
  }
  if (d.schemaVersion > DB_VERSION) throw new Error(`備份檔版本 ${d.schemaVersion} 比 App 新，請先更新 App`);
  if (!d.stores || typeof d.stores !== 'object' || Array.isArray(d.stores)) throw new Error('備份檔缺少資料內容（stores）');
  for (const name of STORES) {
    const rows = (d.stores as Record<string, unknown>)[name];
    if (rows === undefined) {
      if (d.schemaVersion >= SINCE[name]) throw new Error(`備份檔缺少「${name}」資料`);
      continue;
    }
    if (!Array.isArray(rows)) throw new Error(`備份檔的「${name}」不是清單`);
    rows.forEach((row, i) => {
      const key = row && typeof row === 'object' ? (row as Record<string, unknown>)[KEY_PATH[name]] : undefined;
      if (!(typeof key === 'string' ? key.trim() : typeof key === 'number' && Number.isFinite(key))) {
        throw new Error(`備份檔的「${name}」第 ${i + 1} 筆缺少 ${KEY_PATH[name]}`);
      }
    });
  }
  return d as BackupFile;
}

export function migrateBackup(data: BackupFile): BackupFile {
  if (data.app !== APP_ID) throw new Error('不是 twse-money-flow 的備份檔');
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 0) throw new Error('備份檔缺少有效的版本號（schemaVersion）');
  if (data.schemaVersion > DB_VERSION) throw new Error(`備份檔版本 ${data.schemaVersion} 比 App 新，請先更新 App`);
  let cur = data;
  for (let v = data.schemaVersion + 1; v <= DB_VERSION; v++) {
    const m = EXPORT_MIGRATIONS[v];
    if (m) cur = m(cur);
    cur = { ...cur, schemaVersion: v };
  }
  return cur;
}

/** 匯入前的預覽：驗證並升級格式，回傳各 store 的筆數（不寫入）。 */
export function previewImport(raw: unknown): { data: BackupFile; counts: Record<StoreName, number> } {
  const data = migrateBackup(validateBackup(raw));
  const counts = Object.fromEntries(STORES.map((n) => [n, (data.stores[n] ?? []).length])) as Record<StoreName, number>;
  return { data, counts };
}

/**
 * 匯入：mode=replace 先清空再寫入；merge 以主鍵覆蓋。
 * E-04：先完整驗證（validateBackup）；寫入過程任何一步出錯就 tx.abort()，清空與寫入一起撤銷。
 */
export async function importAll(raw: unknown, mode: 'replace' | 'merge' = 'replace'): Promise<Record<string, number>> {
  const { data } = previewImport(raw);
  const db = await getDb();
  const counts: Record<string, number> = {};
  const tx = db.transaction(STORES, 'readwrite');
  try {
    for (const name of STORES) {
      const store = tx.objectStore(name);
      if (mode === 'replace') await store.clear();
      const rows = (data.stores[name] ?? []) as never[];
      for (const row of rows) await store.put(row);
      counts[name] = rows.length;
    }
    await tx.done;
  } catch (err) {
    try { tx.abort(); } catch { /* 交易已結束（已自動中止） */ }
    await tx.done.catch(() => undefined);
    throw new Error(`匯入失敗，現有資料未變更：${(err as Error).message}`);
  }
  return counts;
}

export async function markBackedUp(): Promise<void> {
  await setSetting('lastBackupAt', new Date().toISOString());
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
