/**
 * 介面偏好（每台裝置；localStorage）：預設圖表種類、價格基準（還原／原始）、自選異動的漲跌門檻。
 * 設定頁與個股頁、我的股票共用同一組鍵；讀寫失敗（無痕模式）時用預設值。
 */
import { uiConfig } from './config';
import { RANGE_BASIS_KEY } from './rangeReturn';

/** 個股主圖：預設折線、K 線為選項並記住（D2） */
export const CHART_KEY = 'tmf-stock-chart-v2';
export { RANGE_BASIS_KEY };
/** 自選異動的漲跌門檻（%）；預設 config/ui.yml significance.price_pct */
export const MOVER_KEY = 'tmf-mover-pct';
export const MOVER_OPTIONS = [2, 3, 5] as const;

export const readPref = <T extends string>(k: string, allowed: readonly T[], d: T): T => {
  try { const v = localStorage.getItem(k) as T | null; return v && allowed.includes(v) ? v : d; } catch { return d; }
};
export const writePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 無痕模式 */ } };

/** 顯著變化門檻：價格門檻依設定，其他沿用 config */
export function moverTh(): typeof uiConfig.significance {
  const v = Number(readPref(MOVER_KEY, MOVER_OPTIONS.map(String), String(uiConfig.significance.price_pct)));
  return { ...uiConfig.significance, price_pct: Number.isFinite(v) ? v : uiConfig.significance.price_pct };
}
