import { describe, expect, it } from 'vitest';
import { THEME_DEFAULT, parseTheme, resolvedTheme } from './theme';
import { readFileSync } from 'node:fs';

describe('深淺色', () => {
  it('預設深色，不跟隨系統；未知值回到預設', () => {
    expect(THEME_DEFAULT).toBe('dark');
    expect(parseTheme(null)).toBe('dark');
    expect(parseTheme('auto')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
  });
  it('跟隨系統時才看 prefers-color-scheme', () => {
    expect(resolvedTheme('dark', false)).toBe('dark');
    expect(resolvedTheme('light', true)).toBe('light');
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
  });
  it('index.html 在第一次繪製前以同一個 localStorage 鍵套用', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain("localStorage.getItem('tmf-theme')");
    // inline script 必須在 meta theme-color 之後（才能改它）、在樣式與模組之前
    expect(head.indexOf("getItem('tmf-theme')")).toBeGreaterThan(head.lastIndexOf('<meta name="theme-color"'));
  });
});
