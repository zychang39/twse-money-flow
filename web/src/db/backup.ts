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
export const EXPORT_MIGRATIONS: Record<number, ExportMigration> = {};

export async function exportAll(): Promise<BackupFile> {
  const db = await getDb();
  const stores: BackupFile['stores'] = {};
  for (const name of STORES) stores[name] = await db.getAll(name);
  return { app: APP_ID, schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), stores };
}

export function migrateBackup(data: BackupFile): BackupFile {
  if (data.app !== APP_ID) throw new Error('不是 twse-money-flow 的備份檔');
  if (data.schemaVersion > DB_VERSION) throw new Error(`備份檔版本 ${data.schemaVersion} 比 App 新，請先更新 App`);
  let cur = data;
  for (let v = data.schemaVersion + 1; v <= DB_VERSION; v++) {
    const m = EXPORT_MIGRATIONS[v];
    if (m) cur = m(cur);
    cur = { ...cur, schemaVersion: v };
  }
  return cur;
}

/** 匯入：mode=replace 先清空再寫入；merge 以主鍵覆蓋。 */
export async function importAll(raw: unknown, mode: 'replace' | 'merge' = 'replace'): Promise<Record<string, number>> {
  if (!raw || typeof raw !== 'object') throw new Error('檔案格式錯誤');
  const data = migrateBackup(raw as BackupFile);
  const db = await getDb();
  const counts: Record<string, number> = {};
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const store = tx.objectStore(name);
    if (mode === 'replace') await store.clear();
    const rows = (data.stores[name] ?? []) as never[];
    for (const row of rows) await store.put(row);
    counts[name] = rows.length;
  }
  await tx.done;
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
