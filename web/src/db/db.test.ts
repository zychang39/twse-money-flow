import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addWatch, addWatchMany, clearSampleWatch, getSetting, listActivity, listRecentSearches, listTrades, listWatch, pushRecentSearch, resetDbConnection, saveTrade, setSetting, DB_VERSION, RECENT_MAX } from './db';
import { flowLevel, flowXp } from '../lib/ritual';
import { makeCalendar } from '../lib/tradingCalendar';
import { EXPORT_MIGRATIONS, exportAll, importAll, migrateBackup, previewImport, type BackupFile } from './backup';

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

  it('代號一律轉成大寫（E-08）', async () => {
    await addWatch('00980a');
    await addWatch('00980A'); // 同一檔，不重複
    await addWatchMany([' 2330 ', '00631l'], 'ETF');
    expect((await listWatch()).map((w) => w.code)).toEqual(['00980A', '2330', '00631L']);
    await saveTrade({ id: 'x', code: '00631l', name: 'x', status: 'open', openedAt: '2026-09-01', entry: 1, shares: 1, stop: 0.5, target: 2, reasonType: '', checklist: { market: '', trend: '', revenue: '', valuation: '', reason: '' } });
    expect((await listTrades())[0].code).toBe('00631L');
  });

  it('匯出 → 清空 → 匯入往返', async () => {
    await addWatch('2317');
    await saveTrade({ id: 't1', code: '2317', name: '鴻海', status: 'open', openedAt: '2026-09-01', entry: 200, shares: 1000, stop: 190, target: 230, reasonType: '籌碼', checklist: { market: '偏多', trend: '年線上', revenue: '成長', valuation: '合理', reason: '投信連買' } });
    const backup = await exportAll();
    expect(backup.schemaVersion).toBe(DB_VERSION);
    const json = JSON.parse(JSON.stringify(backup));
    await importAll({ ...json, stores: { watchlist: [], settings: [], screens: [], trades: [], activity: [], strategies: [], tracked: [] } }, 'replace');
    expect(await listWatch()).toEqual([]);
    const counts = await importAll(json, 'replace');
    expect(counts.trades).toBe(1);
    expect((await listTrades())[0].code).toBe('2317');
  });

  it('壞檔匯入（E-04）：先完整驗證，任何錯誤都不改動現有資料', async () => {
    await addWatch('2330');
    await saveTrade({ id: 't1', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-01', entry: 1000, shares: 1000, stop: 900, target: 1200, reasonType: '', checklist: { market: '', trend: '', revenue: '', valuation: '', reason: '' } });
    const bad: unknown[] = [
      null,
      [],
      { app: 'twse-money-flow', schemaVersion: 3 }, // 健檢報告的例子：沒有 stores
      { app: 'twse-money-flow', stores: { watchlist: [] } }, // 沒有版本號
      { app: 'twse-money-flow', schemaVersion: '3', stores: {} },
      { app: 'twse-money-flow', schemaVersion: 2.5, stores: {} },
      { app: 'twse-money-flow', schemaVersion: 3, stores: { watchlist: [], settings: [], screens: [], trades: [] } }, // 缺 activity
      { app: 'twse-money-flow', schemaVersion: 3, stores: { watchlist: {}, settings: [], screens: [], trades: [], activity: [] } },
      { app: 'twse-money-flow', schemaVersion: 3, stores: { watchlist: [{ group: '預設' }], settings: [], screens: [], trades: [], activity: [] } }, // 缺主鍵
      { app: 'twse-money-flow', schemaVersion: 3, stores: { watchlist: [], settings: [], screens: [], trades: [null], activity: [] } },
      { app: 'other', schemaVersion: 3, stores: {} },
    ];
    for (const b of bad) {
      await expect(importAll(b, 'replace')).rejects.toThrow();
      await expect(importAll(b, 'merge')).rejects.toThrow();
    }
    expect((await listWatch()).map((w) => w.code)).toEqual(['2330']);
    expect((await listTrades()).map((t) => t.id)).toEqual(['t1']);
  });

  it('寫入途中出錯會整筆撤銷（tx.abort），清空也一起還原', async () => {
    await addWatch('2330');
    // 主鍵存在但值無法存入 IndexedDB（函式無法結構化複製）→ put 失敗
    const file = { app: 'twse-money-flow', schemaVersion: 3, stores: { watchlist: [{ code: '2317', group: '預設', addedAt: '', order: 0 }], settings: [], screens: [{ id: 's', fn: () => 1 }], trades: [], activity: [] } };
    await expect(importAll(file, 'replace')).rejects.toThrow('現有資料未變更');
    expect((await listWatch()).map((w) => w.code)).toEqual(['2330']);
  });

  it('previewImport 回傳筆數、不寫入', async () => {
    const { counts } = previewImport({ app: 'twse-money-flow', schemaVersion: 1, stores: { watchlist: [{ code: '2330' }], settings: [], screens: [], trades: [] } });
    expect(counts).toEqual({ watchlist: 1, settings: 0, screens: 0, trades: 0, activity: 0, strategies: 0, tracked: 0 });
    expect(await listWatch()).toEqual([]);
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

  it('v4 → v5 升級：既有 60 經驗值原樣保留（legacy_xp）、交易補上 v5 欄位，不清空任何資料', async () => {
    const CK = { market: '中性', trend: '多頭（年線、季線之上）', revenue: '成長', valuation: '合理', reason: '投信連買' };
    const acts = [
      { id: 'a1', type: 'brief_read', day: '2026-09-24', at: '2026-09-24T12:00:00.000Z' },
      { id: 'a2', type: 'checklist_done', day: '2026-09-24', at: '2026-09-24T12:10:00.000Z', meta: { outcome: 'open', code: '2330' } },
      { id: 'a3', type: 'ritual_done', day: '2026-09-24', at: '2026-09-24T12:20:00.000Z' },
      { id: 'a4', type: 'brief_read', day: '2026-09-25', at: '2026-09-25T12:00:00.000Z' },
    ];
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('twse-money-flow', 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        const w = db.createObjectStore('watchlist', { keyPath: 'code' });
        w.createIndex('group', 'group');
        w.createIndex('origin', 'origin');
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('screens', { keyPath: 'id' });
        const t = db.createObjectStore('trades', { keyPath: 'id' });
        t.createIndex('status', 'status');
        t.createIndex('code', 'code');
        const a = db.createObjectStore('activity', { keyPath: 'id' });
        a.createIndex('type', 'type');
        a.createIndex('day', 'day');
        db.createObjectStore('strategies', { keyPath: 'id' });
        db.createObjectStore('tracked', { keyPath: 'key' }).createIndex('strategyId', 'strategyId');
        acts.forEach((x) => a.put(x));
        t.put({ id: 't1', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-24', entry: 100, shares: 1000, stop: 95, target: 120, reasonType: '籌碼', checklist: CK });
        req.transaction!.objectStore('settings').put({ key: 'portfolio', value: { capital: 1_000_000, riskPct: 1, oddLot: false } });
        w.put({ code: '2330', group: '預設', addedAt: '', order: 0, origin: 'user' });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const activity = await listActivity();
    const trades = await listTrades();
    expect(activity.filter((a) => a.type !== 'legacy_xp').map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(activity.find((a) => a.type === 'legacy_xp')?.meta).toMatchObject({ xp: 60, level: 1 });
    expect(trades[0]).toMatchObject({ id: 't1', checklistDone: true, plannedRisk: 5000, riskLimit: 10_000 });
    expect((await listWatch()).map((w) => w.code)).toEqual(['2330']);
    const input = { cal: makeCalendar(null), activities: activity, trades, riskLimit: 10_000, now: new Date().toISOString() };
    expect(flowXp(input)).toBe(60);
    expect(flowLevel(input).text).toBe('60 / 100');
  });

  it('saveTrade 自動補上 v5 欄位；風險上限取設定的本金 × 每筆風險 %', async () => {
    await setSetting('portfolio', { capital: 500_000, riskPct: 2, oddLot: false });
    const base = { id: 'n1', code: '2330', name: '台積電', status: 'open' as const, openedAt: '2026-10-02', entry: 100, shares: 1000, stop: 95, target: 120, reasonType: '籌碼', checklist: { market: '中性', trend: '多頭', revenue: '成長', valuation: '合理', reason: 'x' } };
    await saveTrade(base);
    const [t] = await listTrades();
    expect(t).toMatchObject({ checklistDone: true, plannedRisk: 5000, riskLimit: 10_000 });
    expect(typeof t.createdAt).toBe('string');
    await setSetting('portfolio', { capital: 100_000, riskPct: 1, oddLot: false });
    await saveTrade({ ...t, status: 'closed', closedAt: '2026-10-05', exit: 101, review: '檢討' });
    const [c] = await listTrades();
    expect(c.riskLimit).toBe(10_000); // 進場當時的快照，不回溯
    expect(typeof c.reviewedAt).toBe('string');
    expect(typeof c.closedRecordedAt).toBe('string');
  });

  it('v4 備份檔匯入：補上 legacy_xp（遷移時間＝匯出時間）', () => {
    const old: BackupFile = { app: 'twse-money-flow', schemaVersion: 4, exportedAt: '2026-10-01T00:00:00.000Z', stores: {
      watchlist: [], settings: [], screens: [], strategies: [], tracked: [],
      trades: [], activity: [{ id: 'a', type: 'brief_read', day: '2026-09-30', at: '2026-09-30T12:00:00.000Z' }],
    } };
    const up = migrateBackup(old);
    const legacy = (up.stores.activity as { type: string; at: string; meta: { xp: number } }[]).find((a) => a.type === 'legacy_xp');
    expect(legacy).toMatchObject({ at: '2026-10-01T00:00:00.000Z', meta: { xp: 10 } });
    expect(up.stores.activity).toHaveLength(2);
  });
});
