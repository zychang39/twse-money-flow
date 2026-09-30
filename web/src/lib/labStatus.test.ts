import { describe, expect, it } from 'vitest';
import type { EvidenceFile, EvidenceToday } from './evidence';
import { labStatus } from './labStatus';

describe('探索頁功能卡的即時數字（v3 M5-1）', () => {
  it('今日新觸發只算通過驗證的指標、同一檔不重複；更新時間 M/D HH:mm', () => {
    const ev = {
      meta: { generated_at: '2026-09-30T16:20:05+08:00' },
      rows: [
        { id: 'high52', verdict: '有效' }, { id: 'kd_run', verdict: '環境依賴' }, { id: 'macd', verdict: '無效' }, { id: 'combo_three', verdict: '樣本範圍受限' },
      ],
    } as unknown as EvidenceFile;
    const today: EvidenceToday = {
      date: '2026-09-30',
      tests: {
        high52: { t: { '2330': '2026-09-30', '2317': '2026-09-29' }, near: [] },
        kd_run: { t: { '2330': '2026-09-30', '1101': '2026-09-30' }, near: [] },
        macd: { t: { '9999': '2026-09-30' }, near: [] },
      },
    };
    const s = labStatus(ev, today)!;
    expect(s.today).toBe(2);
    expect(s.valid).toBe(1);
    expect(s.env).toBe(1);
    expect(s.updated).toBe('9/30 16:20');
    expect(s.strategies).toBe(2); // near_high（high52）、k_high_5days（kd_run）
    expect(labStatus(null, null)).toBeNull();
  });
});
