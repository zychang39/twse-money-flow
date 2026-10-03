import { describe, expect, it } from 'vitest';
import { ritualAnswer } from './ritual';

const rings = (done: boolean[]) => ({ rings: done.map((d) => ({ done: d })), complete: done.every(Boolean) });

describe('紀律答案（M1-2）：休市日不寫「還差」', () => {
  it('交易日：已完成／還差 N 項', () => {
    expect(ritualAnswer(rings([true, true, true]), true, '2026-10-02')).toBe('今晚的紀律已完成');
    expect(ritualAnswer(rings([false, true, false]), true, '2026-10-02')).toBe('今晚的紀律：還差 2 項');
  });
  it('休市日：不計入連續天數，寫上一交易日已完成 X／3', () => {
    const s = ritualAnswer(rings([true, true, false]), false, '2026-10-02');
    expect(s).toBe('今天休市，不計入連續天數；上一交易日 10/2 的紀律：已完成 2／3');
    expect(s).not.toContain('還差');
    expect(ritualAnswer(rings([true, true, true]), false, '2026-10-02')).toBe('今天休市，不計入連續天數；上一交易日 10/2 的紀律：已完成 3／3');
  });
  it('休市日但沒有上一交易日的日期：仍然不留白', () => {
    expect(ritualAnswer(rings([false, false, false]), false, null)).toBe('今天休市，不計入連續天數；上一交易日的紀律：已完成 0／3');
  });
});
