import { describe, expect, it } from 'vitest';
import { THEME_DEFAULT, parseTheme } from './theme';

describe('theme（只做深色）', () => {
  it('任何舊設定值都回到深色', () => {
    expect(THEME_DEFAULT).toBe('dark');
    expect(parseTheme('light')).toBe('dark');
    expect(parseTheme('system')).toBe('dark');
    expect(parseTheme(null)).toBe('dark');
  });
});
