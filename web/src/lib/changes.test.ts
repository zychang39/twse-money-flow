import { describe, expect, it } from 'vitest';
import { instReasonText } from './changes';

describe('#8 清單列理由：數字在前、格式精簡', () => {
  it('M3：「外資＋投信 −24,000 張・量 70%」：完整張數（不縮寫成萬）', () => {
    expect(instReasonText(-24_000, 34_286)).toBe('外資＋投信 −24,000\u00a0張・量\u00a070%');
    expect(instReasonText(315, 1_000)).toBe('外資＋投信 +315\u00a0張・量\u00a032%');
  });
  it('大數字也不出現萬', () => {
    expect(instReasonText(-2_400_000, 3_428_600)).not.toContain('萬');
  });
});
