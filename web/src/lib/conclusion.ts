/**
 * 結論句（每頁最上方的一句白話）。只陳述狀態，不含交易建議字眼。
 *
 * 排版規則（手機 393 寬、標題 26px 約 13 個全形字一行）：
 * - 每個子句 ≤ 12 個全形字寬；子句之間用「，」，整句最多兩行。
 * - 數字前後用不換行空白（\u00a0），搭配標題的 word-break: keep-all，只會在標點後換行，
 *   不會出現「化，」這種單字加標點落到下一行、或數字與單位被拆開的情況。
 */
import type { EnvState } from './envState';

const NB = '\u00a0';
const n = (v: number) => `${NB}${v}${NB}`;

const ENV_TEXT: Record<EnvState, string> = {
  conservative: '資金環境偏保守',
  neutral: '資金環境中性',
  aggressive: '資金面有利',
  unknown: '資金指標資料不足',
};

/** 今晚：持股優先（有持股時），否則自選；後半句是資金環境。 */
export function tonightConclusion(o: { holdings: number; alerts: number; env: EnvState; watchChanges: number; watchCount?: number }): string {
  const first = o.holdings > 0
    ? o.alerts > 0 ? `持股${n(o.alerts)}檔需要注意` : '持股都沒有異狀'
    : o.watchCount === 0 ? '還沒有自選與持股'
    : o.watchChanges > 0 ? `自選${n(o.watchChanges)}檔有顯著變化` : '自選沒有顯著變化';
  return `${first}，${ENV_TEXT[o.env]}。`;
}

/** 我的股票頁首副資訊（2026-10-03：以數字陳述，不寫敘事句）：「自選 8 檔・異動 2 檔・持倉 3 檔・警示 1 檔」。 */
export function mineConclusion(o: { watchCount: number; watchChanges: number; holdings: number; alerts: number }): string {
  const hold = o.holdings ? `・持倉${n(o.holdings)}檔・警示${n(o.alerts)}檔` : '';
  if (!o.watchCount) return `無自選股${hold}`;
  return `自選${n(o.watchCount)}檔・異動${n(o.watchChanges)}檔${hold}`;
}

/** 持股分段的頁首副資訊：「持倉 2 檔・近 3 個月上漲・警示 0 檔」。 */
export function holdConclusion(o: { holdings: number; alerts: number; dir: 'up' | 'down' | 'flat'; periodName: string }): string {
  if (!o.holdings) return '無持倉';
  const move = o.dir === 'up' ? '上漲' : o.dir === 'down' ? '下跌' : '持平';
  return `持倉${n(o.holdings)}檔・${o.periodName}${move}・警示${n(o.alerts)}檔`;
}
