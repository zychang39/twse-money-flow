import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../db/db', () => ({
  getSetting: async <T>(k: string, d: T) => (store.has(k) ? (store.get(k) as T) : d),
  setSetting: async (k: string, v: unknown) => void store.set(k, v),
}));
const { baseline, commit, resetSeen } = await import('./seen');

const snap = (date: string) => ({ at: `${date}T23:00`, date, rows: {} });

describe('上次查看（seen）', () => {
  beforeEach(() => { store.clear(); resetSeen(); });

  it('同一次使用只寫一次；資料更新到新的一天再寫一次（基準不停在舊的一天）', async () => {
    await commit('watch', snap('2026-10-12'));
    await commit('watch', snap('2026-10-12'));
    expect((store.get('seen:watch') as { date: string }).date).toBe('2026-10-12');
    await commit('watch', snap('2026-10-13'));
    expect((store.get('seen:watch') as { date: string }).date).toBe('2026-10-13');
    await commit('watch', snap('2026-10-12'));
    expect((store.get('seen:watch') as { date: string }).date).toBe('2026-10-13');
    expect(await baseline('watch')).toBeNull(); // 本次的基準固定是開啟時讀到的那一份
  });
});
