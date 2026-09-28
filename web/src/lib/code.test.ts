import { describe, expect, it } from 'vitest';
import { normCode } from './code';

describe('normCode（E-08）', () => {
  it('小寫、空白、網址編碼', () => {
    expect(normCode('00980a')).toBe('00980A');
    expect(normCode(' 2330 ')).toBe('2330');
    expect(normCode('00631l%20')).toBe('00631L');
    expect(normCode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
