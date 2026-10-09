import { describe, expect, it } from 'vitest';
import { skipSummary } from './data';

describe('探索卡片摘要（2026-10-09）', () => {
  it('一般瀏覽器一律讀取；自動化環境在開過本頁之前不讀', () => {
    expect(skipSummary(false, false)).toBe(false);
    expect(skipSummary(true, false)).toBe(false);
    expect(skipSummary(false, true)).toBe(true);
    expect(skipSummary(true, true)).toBe(false);
  });
});
