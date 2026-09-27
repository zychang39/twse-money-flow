import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addWatch, addWatchMany, clearSampleWatch, getSetting, listRecentSearches, listTrades, listWatch, pushRecentSearch, resetDbConnection, saveTrade, setSetting, DB_VERSION, RECENT_MAX } from './db';
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

  it('v2 → v3 升級：既有自選、設定、交易原樣保留，自選補上來源 user', async () => {
    // 以 v2 結構建立舊資料庫（模擬既有使用者）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('twse-money-flow', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const w = db.createObjectStore('watchlist', { keyPath: 'code' });
        w.createIndex('group', 'group');
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('screens', { keyPath: 'id' });
        const t = db.createObjectStore('trades', { keyPath: 'id' });
        t.createIndex('status', 'status');
        t.createIndex('code', 'code');
        const a = db.createObjectStore('activity', { keyPath: 'id' });
        a.createIndex('type', 'type');
        a.createIndex('day', 'day');
        w.put({ code: '2330', group: '半導體', addedAt: '2026-01-01', order: 0, note: '核心' });
        w.put({ code: '2317', group: '預設', addedAt: '2026-01-02', order: 1 });
        req.transaction!.objectStore('settings').put({ key: 'theme', value: 'dark' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const items = await listWatch();
    expect(items.map((w) => [w.code, w.group, w.origin, w.note])).toEqual([['2330', '半導體', 'user', '核心'], ['2317', '預設', 'user', undefined]]);
    expect(await getSetting('theme', 'auto')).toBe('dark');
  });

  it('範例自選：一次加入、標示來源，一鍵清除不影響自己加入的', async () => {
    await addWatch('2603');
    expect(await addWatchMany(['2330', '2317', '2603'], '範例', 'sample')).toBe(2);
    expect((await listWatch()).map((w) => `${w.code}:${w.origin}`)).toEqual(['2603:user', '2330:sample', '2317:sample']);
    expect(await clearSampleWatch()).toBe(2);
    expect((await listWatch()).map((w) => w.code)).toEqual(['2603']);
  });

  it('最近搜尋：最新在前、不重複、最多 RECENT_MAX 筆', async () => {
    for (let i = 0; i < RECENT_MAX + 2; i++) await pushRecentSearch(String(1000 + i));
    await pushRecentSearch('1003');
    const r = await listRecentSearches();
    expect(r[0]).toBe('1003');
    expect(r.length).toBe(RECENT_MAX);
    expect(new Set(r).size).toBe(r.length);
  });

  it('v2 備份檔匯入時自選補上來源 user', () => {
    const old: BackupFile = { app: 'twse-money-flow', schemaVersion: 2, exportedAt: '', stores: { watchlist: [{ code: '2330', group: '預設', addedAt: '', order: 0 }] } };
    const up = migrateBackup(old);
    expect((up.stores.watchlist as { origin: string }[])[0].origin).toBe('user');
  });
});
