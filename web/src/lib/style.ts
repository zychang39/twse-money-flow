/**
 * 投資風格（v3 M3）：波段動能／長期投資。決定個股頁區塊順序、預設期間與一句話結論的側重點。
 * 存在 localStorage 單一鍵（與深淺色相同理由：個股頁第一次繪製就要知道順序，IndexedDB 是非同步的）。
 */
import type { Period } from './periods';

export type InvestStyle = 'swing' | 'long';
export const STYLE_KEY = 'tmf-style';
export const STYLE_DEFAULT: InvestStyle = 'swing';
export const STYLE_NAME: Record<InvestStyle, string> = { swing: '波段動能', long: '長期投資' };
export const STYLE_DESC: Record<InvestStyle, string> = {
  swing: '先看動能、法人與信用籌碼；預設期間 1Y',
  long: '先看營收成長、獲利品質與估值；預設期間 5Y',
};
export const STYLE_PERIOD: Record<InvestStyle, Period> = { swing: '1Y', long: '5Y' };

export type SectionId = 'conclusion' | 'signals' | 'scores' | 'momentum' | 'institutional' | 'credit' | 'structure' | 'revenue' | 'profit' | 'valuation' | 'events';

/**
 * 主角價格與走勢固定在最上方，以下依風格排序。
 * 波段動能（M3）：結論 → 有效訊號面板 → 四環分數 → 動能 → 法人 → 信用與空方 → 籌碼結構 → 營收與基本面 → 估值 → 事件。
 */
export const SECTION_ORDER: Record<InvestStyle, SectionId[]> = {
  swing: ['conclusion', 'signals', 'scores', 'momentum', 'institutional', 'credit', 'structure', 'revenue', 'valuation', 'events'],
  long: ['conclusion', 'scores', 'revenue', 'profit', 'valuation', 'structure', 'institutional', 'credit', 'signals', 'events'],
};

export function parseStyle(v: string | null | undefined): InvestStyle {
  return v === 'long' || v === 'swing' ? v : STYLE_DEFAULT;
}

export function getStyle(): InvestStyle {
  try {
    return parseStyle(localStorage.getItem(STYLE_KEY));
  } catch {
    return STYLE_DEFAULT;
  }
}

export function setStyle(s: InvestStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, s);
  } catch {
    /* 無痕模式：只影響本次 */
  }
  window.dispatchEvent(new Event('style-change'));
}
