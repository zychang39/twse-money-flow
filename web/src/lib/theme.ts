/**
 * 外觀（2026-10 恢復環境光改版）：只做深色（DECISIONS #304）。
 * 舊版的深色／淺色／跟隨系統設定（localStorage `tmf-theme`）一律視為深色；index.html 的 inline script 在第一次繪製前套用。
 * PWA 狀態列顏色（meta theme-color）固定為黑。
 */
export type ThemePref = 'dark';
export const THEME_KEY = 'tmf-theme';
export const THEME_DEFAULT: ThemePref = 'dark';
/** 與 tokens.css 的 --status-bar 相同 */
export const STATUS_BAR = '#000000';

/** 舊設定值（light／system）一律回到深色。 */
export function parseTheme(_v?: string | null): ThemePref {
  return THEME_DEFAULT;
}

export function applyTheme(): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', 'dark');
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = STATUS_BAR; });
}
