/**
 * 深淺色（v3 M1-4）：預設深色、不跟隨系統；可選深色／淺色／跟隨系統。
 * 設定存在 localStorage 的單一鍵（THEME_KEY）；index.html 的 inline script 在第一次繪製前讀同一個鍵套用，避免閃白。
 * PWA 狀態列顏色（meta theme-color）同步更新。
 */
export type ThemePref = 'dark' | 'light' | 'system';
export const THEME_KEY = 'tmf-theme';
export const THEME_DEFAULT: ThemePref = 'dark';
export const THEME_OPTIONS: [ThemePref, string][] = [['dark', '深色'], ['light', '淺色'], ['system', '跟隨系統']];
/** 與 tokens.css 的 --status-bar 相同 */
export const STATUS_BAR: Record<'dark' | 'light', string> = { dark: '#000000', light: '#f4f4f6' };

export function parseTheme(v: string | null | undefined): ThemePref {
  return v === 'light' || v === 'system' || v === 'dark' ? v : THEME_DEFAULT;
}

export function getThemePref(): ThemePref {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return THEME_DEFAULT;
  }
}

/** 實際套用的深淺（跟隨系統時看 prefers-color-scheme）。 */
export function resolvedTheme(pref: ThemePref, systemDark: boolean): 'dark' | 'light' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m) => {
    // 跟隨系統：兩個 meta 各自以 media 對應；固定深／淺：兩個都設成同一色
    m.content = pref === 'system' ? STATUS_BAR[m.media.includes('dark') ? 'dark' : 'light'] : STATUS_BAR[pref];
  });
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* 無痕模式：只套用本次 */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event('theme-change'));
}
