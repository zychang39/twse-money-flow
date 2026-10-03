import { describe, expect, it } from 'vitest';
import { asofNote, asofText, lastValidDate } from './asof';

describe('各區塊資料日（2026-10-02 健檢 M1-4）', () => {
  it('lastValidDate：序列最後一個有值的日期（信用到 10/1、法人到 10/2）', () => {
    const d = ['2026-09-30', '2026-10-01', '2026-10-02'];
    expect(lastValidDate(d, [1, 2, null])).toBe('2026-10-01');
    expect(lastValidDate(d, [1, 2, 3])).toBe('2026-10-02');
    expect(lastValidDate(d, [null, null, null])).toBeNull();
    expect(lastValidDate(undefined, undefined)).toBeNull();
  });
  it('asofText／asofNote：資料日與「尚未公布」加註；沒有日期附原因', () => {
    expect(asofText('2026-10-01')).toBe('資料日 10/1');
    expect(asofText(null, '尚未抓取')).toBe('資料日 —（尚未抓取）');
    expect(asofNote('2026-10-01', '2026-10-02')).toBe('（10/2 尚未公布）');
    expect(asofNote('2026-10-02', '2026-10-02')).toBe('');
  });
});
