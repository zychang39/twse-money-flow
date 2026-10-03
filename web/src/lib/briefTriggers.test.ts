import { describe, expect, it } from 'vitest';
import { gradeId, newTriggers } from './briefTriggers';

describe('newTriggers', () => {
  it('只算上架策略、股票去重', () => {
    const r = newTriggers({ date: '2026-10-02', strategies: [
      { id: 'a', grade: { id: 'valid' }, today: [{ code: '2330' }, { code: '2454' }] },
      { id: 'b', grade: '觀察中', today: [{ code: '2330' }] },
      { id: 'c', grade: { id: 'invalid' }, today: [{ code: '3037' }] },
      { id: 'd', grade: '有效', today: [] },
    ] });
    expect(r).toEqual({ date: '2026-10-02', stocks: 2, strategies: 2 });
  });
  it('舊版與新版 grade', () => {
    expect(gradeId('停用')).toBe('invalid');
    expect(gradeId({ id: 'sig_only' })).toBe('sig_only');
    expect(gradeId(null)).toBe('invalid');
  });
});
