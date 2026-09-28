/** 持股警示：觸及／接近停損、新的或嚴重的風險旗標。只陳述事實，不給操作建議。 */
import type { StockHistory, StockRow } from '../data/types';
import { adjustTrade, eventsFor } from './corpActions';
import type { Trade } from '../db/db';
import { uiConfig } from './config';
import { fmtPrice } from './format';

export interface HoldingAlert { trade: Trade; row: StockRow | undefined; items: { label: string; detail: string }[]; risk: boolean; score: number }

/**
 * hist：已載入的個股檔（有的話用完整的還原事件換算停損；沒有則用 summary 的近期事件 adj_ev）。
 * D-01：停損價依進場日之後的分割、減資、除權息換算到目前價格基準再比較，避免分割後出現假的「觸及停損」。
 */
export function holdingAlerts(open: Trade[], byCode: Map<string, StockRow>, th = uiConfig.significance, hist?: Map<string, StockHistory | null>): HoldingAlert[] {
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
    const adj = adjustTrade(t, eventsFor(r, hist?.get(t.code)));
    const stop = adj.stop;
    const note = adj.notes.length ? `（${adj.notes.join('、')}，原停損 ${fmtPrice(t.stop)}）` : '';
    if (px !== null && px <= stop) {
      items.push({ label: `觸及停損 ${fmtPrice(stop)}`, detail: `收盤 ${fmtPrice(px)}，低於你設定的停損價 ${fmtPrice(stop - px)} 元${note}。` });
      score += 100;
    } else if (px !== null && px <= stop * (1 + th.near_stop_pct / 100)) {
      items.push({ label: `接近停損 ${fmtPrice(stop)}`, detail: `收盤 ${fmtPrice(px)}，距停損 ${(((px - stop) / stop) * 100).toFixed(1)}%${note}。` });
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
