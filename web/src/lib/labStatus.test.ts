import { describe, expect, it } from 'vitest';
import type { EvidenceFile } from './evidence';
import { labStatus } from './labStatus';
import type { StrategyItem } from './strategies';

describe('探索頁功能卡的即時數字（v3 M5-1；2026-10-02 健檢改用策略分級）', () => {
  const ev = {
    meta: { generated_at: '2026-09-30T16:20:05+08:00' },
    rows: [
      { id: 'high52', verdict: '有效' }, { id: 'kd_run', verdict: '環境依賴' }, { id: 'macd', verdict: '無效' }, { id: 'combo_three', verdict: '樣本範圍受限' },
    ],
  } as unknown as EvidenceFile;
  const strategies = [
    { id: 'a', test: 'high52', grade: '有效', enabled: true, today: [{ code: '2330', name: 'x' }, { code: '2317', name: 'y' }] },
    { id: 'b', test: 'kd_run', grade: '觀察中', enabled: true, today: [{ code: '2330', name: 'x' }, { code: '1101', name: 'z' }] },
    { id: 'c', test: 'macd', grade: '停用', enabled: false, today: [{ code: '9999', name: 'q' }] },
    { id: 'd', test: 'combo_three', grade: '觀察中', enabled: true, limited: true, today: [{ code: '2454', name: 'w' }] },
  ] as unknown as StrategyItem[];
  it('今日新觸發只算上架策略、同一檔不重複；資料不足區另計；策略數依分級；更新時間 M/D HH:mm', () => {
    const s = labStatus(ev, strategies)!;
    expect(s.today).toBe(3); // 2330、2317、1101（停用的 9999 不算；資料不足區的 2454 另計）
    expect(s.todayExcluded).toBe(1);
    expect(s.grades).toEqual({ valid: 1, sig_only: 0, watch: 2, invalid: 1, listed: 3, total: 4 });
    expect(s.valid).toBe(1);
    expect(s.env).toBe(1);
    expect(s.updated).toBe('9/30 16:20');
    expect(labStatus(null, null)).toBeNull();
  });
});
