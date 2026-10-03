import { describe, expect, it } from 'vitest';
import { envInfo, envVerdict, type Light } from './envState';

const light = (id: string, state: Light['state']): Light => ({ id, label: id, state, value: '', basis: '' });

describe('資金環境判定的說明（M1-7）', () => {
  it('有風險 → 保守，並寫出「任一項風險即保守」', () => {
    const env = envInfo([light('a', 'red'), light('b', 'red'), light('c', 'red'), light('d', 'green'), light('e', 'yellow')]);
    expect(env.state).toBe('conservative');
    expect(envVerdict(env)).toBe('3 項風險 → 保守（任一項風險即保守）');
  });
  it('沒有風險且 ≥ 3 項有利 → 積極', () => {
    const env = envInfo([light('a', 'green'), light('b', 'green'), light('c', 'green'), light('d', 'yellow')]);
    expect(envVerdict(env)).toBe('沒有風險、3 項有利 → 積極（沒有風險且有利 ≥ 3 項）');
  });
  it('沒有風險但有利不足 → 中性', () => {
    const env = envInfo([light('a', 'green'), light('b', 'yellow'), light('c', 'gray')]);
    expect(envVerdict(env)).toBe('沒有風險、1 項有利 → 中性（有利不足 3 項）');
  });
  it('全部累積中 → 資料不足', () => {
    expect(envVerdict(envInfo([light('a', 'gray')]))).toBe('資料不足（指標都還沒有資料）');
  });
});
