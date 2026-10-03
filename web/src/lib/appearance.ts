/**
 * 外觀：只做深色（lib/theme.ts，index.html 在第一次繪製前已套用）；顯示設定寫在 <html> 的 data 屬性：
 * data-help（新手＝顯示解讀行／精簡＝只在超過提醒門檻時亮橘點）、data-tablabels（分頁列顯示文字）。
 */
import { getSetting } from '../db/db';
import { applyTheme } from './theme';

export type HelpLevel = 'novice' | 'compact';

export async function applyAppearance(): Promise<void> {
  applyTheme();
  const root = document.documentElement;
  root.dataset.help = (await getSetting<string>('helpLevel', 'novice')) === 'compact' ? 'compact' : 'novice';
  root.dataset.tablabels = (await getSetting<boolean>('tabLabels', false)) ? 'on' : 'off';
}

/** 目前的說明層級（同步讀取 <html data-help>）。 */
export function helpLevel(): HelpLevel {
  return typeof document !== 'undefined' && document.documentElement.dataset.help === 'compact' ? 'compact' : 'novice';
}
