/** 持股警示：觸及／接近停損、新的或嚴重的風險旗標。只陳述事實，不給操作建議。 */
import type { StockRow } from '../data/types';
import type { Trade } from '../db/db';
import { uiConfig } from './config';
import { fmtPrice } from './format';

export interface HoldingAlert { trade: Trade; row: StockRow | undefined; items: { label: string; detail: string }[]; risk: boolean; score: number }

export function holdingAlerts(open: Trade[], byCode: Map<string, StockRow>, th = uiConfig.significance): HoldingAlert[] {
  const out: HoldingAlert[] = [];
  for (const t of open) {
    const r = byCode.get(t.code);
    const items: { label: string; detail: string }[] = [];
    let score = 0;
    if (!r) {
      // U-01：下市或長期停牌的持股不能無聲消失
      items.push({ label: '無最新行情', detail: '近 20 個交易日沒有成交資料，可能已下市或長期停牌；請自行確認這筆持倉。' });
      score += 80;
    }
    const px = r?.close ?? null;
    if (px !== null && px <= t.stop) {
      items.push({ label: `觸及停損 ${fmtPrice(t.stop)}`, detail: `收盤 ${fmtPrice(px)}，低於你設定的停損價 ${fmtPrice(t.stop - px)} 元。` });
      score += 100;
    } else if (px !== null && px <= t.stop * (1 + th.near_stop_pct / 100)) {
      items.push({ label: `接近停損 ${fmtPrice(t.stop)}`, detail: `收盤 ${fmtPrice(px)}，距停損 ${(((px - t.stop) / t.stop) * 100).toFixed(1)}%。` });
      score += 60;
    }
    const newIds = new Set((r?.new_flags as string[] | undefined) ?? []);
    for (const f of r?.flags ?? []) {
      if (newIds.has(f.id)) {
        items.push({ label: `新風險旗標：${f.label}`, detail: f.detail ?? '' });
        score += 40;
      } else if (f.level === 'danger') {
        items.push({ label: f.label, detail: f.detail ?? '' });
        score += 20;
      }
    }
    out.push({ trade: t, row: r, items, risk: items.length > 0, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
