import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addWatch, getSetting, listTrades, listWatch, resetDbConnection, saveTrade, setSetting, DB_VERSION } from './db';
import { EXPORT_MIGRATIONS, exportAll, importAll, migrateBackup, type BackupFile } from './backup';

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('twse-money-flow');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

describe('IndexedDB 與備份', () => {
  it('自選與設定讀寫', async () => {
    await addWatch('2330');
    await addWatch('0050', 'ETF');
    await addWatch('2330'); // 重複不新增
    expect((await listWatch()).map((w) => w.code)).toEqual(['2330', '0050']);
    await setSetting('theme', 'dark');
    expect(await getSetting('theme', 'auto')).toBe('dark');
  });

  it('匯出 → 清空 → 匯入往返', async () => {
    await addWatch('2317');
    await saveTrade({ id: 't1', code: '2317', name: '鴻海', status: 'open', openedAt: '2026-09-01', entry: 200, shares: 1000, stop: 190, target: 230, reasonType: '籌碼', checklist: { market: '偏多', trend: '年線上', revenue: '成長', valuation: '合理', reason: '投信連買' } });
    const backup = await exportAll();
    expect(backup.schemaVersion).toBe(DB_VERSION);
    const json = JSON.parse(JSON.stringify(backup));
    await importAll({ ...json, stores: { watchlist: [], settings: [], screens: [], trades: [] } }, 'replace');
    expect(await listWatch()).toEqual([]);
    const counts = await importAll(json, 'replace');
    expect(counts.trades).toBe(1);
    expect((await listTrades())[0].code).toBe('2317');
  });

  it('舊版匯出檔依遷移升級；拒絕未知或較新版本', () => {
    EXPORT_MIGRATIONS[DB_VERSION + 1] = (d) => d; // 不影響目前版本
    const old: BackupFile = { app: 'twse-money-flow', schemaVersion: 0, exportedAt: '', stores: {} };
    expect(migrateBackup(old).schemaVersion).toBe(DB_VERSION);
    expect(() => migrateBackup({ ...old, app: 'other' })).toThrow();
    expect(() => migrateBackup({ ...old, schemaVersion: DB_VERSION + 5 })).toThrow();
    delete EXPORT_MIGRATIONS[DB_VERSION + 1];
  });
});
