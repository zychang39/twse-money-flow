/** 衝動攔截：新增持倉前，若符合 config/ui.yml 的條件，列出目前的風險事實（語氣中性、不說教）。 */
import type { StockRow } from '../data/types';
import type { EnvInfo } from './envState';
import { uiConfig } from './config';

export function impulseFacts(row: StockRow | undefined, env: EnvInfo | null, cfg = uiConfig.impulse): string[] {
  const facts: string[] = [];
  if (cfg.env_conservative && env?.state === 'conservative') {
    facts.push(`資金環境為「保守」：${env.red.map((l) => `${l.label} ${l.value}`).join('、')}。`);
  }
  const gap = row?.ma20_gap as number | null | undefined;
  if (gap !== null && gap !== undefined && gap > cfg.ma20_gap_pct) {
    facts.push(`${row!.name} 收盤高於 20 日均線 ${gap.toFixed(1)}%（提醒門檻 ${cfg.ma20_gap_pct}%）。`);
  }
  const p5 = row?.price_change_5d as number | null | undefined;
  if (p5 !== null && p5 !== undefined && p5 > cfg.price_change_5d_pct) {
    facts.push(`${row!.name} 近 5 日上漲 ${p5.toFixed(1)}%（提醒門檻 ${cfg.price_change_5d_pct}%）。`);
  }
  return facts;
}
