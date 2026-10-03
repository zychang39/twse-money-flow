import { describe, expect, it } from 'vitest';
import { envConclusion, envCounts, envInfo, type EnvValidation, type Light } from './envState';

const light = (id: string, state: Light['state']): Light => ({ id, label: id, state, value: '', basis: '' });
const v = (show: boolean): EnvValidation => ({ period: ['2017-01-03', '2026-10-02'], days: 2300, states: [], show_conclusion: show, reason: '' });

describe('envCounts／envConclusion（2026-10 改版）', () => {
  it('計數格式：風險 3／有利 1／中性 1', () => {
    const env = envInfo([light('a', 'red'), light('b', 'red'), light('c', 'red'), light('d', 'green'), light('e', 'yellow')]);
    expect(envCounts(env)).toBe('風險 3／有利 1／中性 1');
    expect(env.state).toBe('conservative');
  });
  it('驗證不顯著時不下「保守」結論', () => {
    const env = envInfo([light('a', 'red')]);
    expect(envConclusion(env, v(false))).toBeNull();
    expect(envConclusion(env, null)).toBeNull();
    expect(envConclusion(env, v(true))).toBe('保守');
  });
  it('全部資料累積中', () => {
    const env = envInfo([light('a', 'gray')]);
    expect(envCounts(env)).toBe('資料累積中');
    expect(envConclusion(env, v(true))).toBeNull();
  });
});
