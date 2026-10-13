import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDataUpdate, getDataVersion, loadMeta, onDataUpdate } from './api';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('資料版本檢查（checkDataUpdate）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('伺服器的 generated_at 和目前用的不同 → 清掉快取、通知重讀；相同 → 不動', async () => {
    let server = { generated_at: '2026-10-12T22:00:00+08:00', market_date: '2026-10-12' };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(server));
    const deleted: string[] = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { delete: async (k: string) => (deleted.push(k), true) });

    expect((await loadMeta()).market_date).toBe('2026-10-12');
    const v0 = getDataVersion();
    expect(await checkDataUpdate(0, 1_000)).toBe(false);
    expect(getDataVersion()).toBe(v0);

    // 部署了新資料：記憶體裡仍是舊的 meta
    server = { generated_at: '2026-10-13T22:13:42+08:00', market_date: '2026-10-13' };
    const heard = vi.fn();
    const off = onDataUpdate(heard);
    expect(await checkDataUpdate(0, 2_000)).toBe(true);
    off();
    expect(getDataVersion()).toBe(v0 + 1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(['data-v1']);
    expect((await loadMeta()).market_date).toBe('2026-10-13');
    // 版本檢查繞過 service worker 與 HTTP 快取；一般讀取向伺服器確認
    expect(fetchMock.mock.calls.some(([, init]) => init?.cache === 'no-store')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => ['no-store', 'no-cache'].includes(String(init?.cache)))).toBe(true);
  });

  it('間隔內重複呼叫直接略過；離線時沿用快取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await checkDataUpdate(0, 10_000)).toBe(false);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await checkDataUpdate(60_000, 20_000)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
