/** 結論句（每頁最上方的一句白話）。只陳述狀態，不含交易建議字眼。 */
import type { EnvState } from './envState';

export function tonightConclusion(o: { holdings: number; alerts: number; env: EnvState; watchChanges: number }): [string, string] {
  const first = o.holdings === 0
    ? o.watchChanges > 0 ? `今晚自選股有 ${o.watchChanges} 檔出現顯著變化，` : '今晚自選股沒有顯著變化，'
    : o.alerts > 0 ? `今晚 ${o.alerts} 檔持股需要注意，` : '今晚持股沒有需要注意的事，';
  const env = {
    conservative: '大盤資金環境偏保守。',
    neutral: '大盤資金環境中性。',
    aggressive: '大盤資金環境偏積極。',
    unknown: '大盤資金指標資料不足。',
  }[o.env];
  return [first, env];
}

export function mineConclusion(o: { holdings: number; alerts: number; dir: 'up' | 'down' | 'flat'; periodName: string }): [string, string] {
  if (!o.holdings) return ['還沒有持倉。', '自選股的變化在下方。'];
  const move = o.dir === 'up' ? `持股${o.periodName}上漲，` : o.dir === 'down' ? `持股${o.periodName}下跌，` : `持股${o.periodName}持平，`;
  return [move, o.alerts ? `${o.alerts} 檔需要注意。` : '沒有需要注意的持股。'];
}
