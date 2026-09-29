/** 分段更新的狀態列（M3.4；今晚頁）。純函式。 */
import type { Meta } from '../data/types';

export const STAGE_ORDER = ['close', 'insti', 'credit'] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export interface StageItem { id: StageId; label: string; text: string; state: 'done' | 'late' | 'waiting' }

/** 「收盤行情 14:20 完成」「法人 等待（約 15:30）」「信用 逾時・下一次補抓」；目標日不是今天時全部視為等待。 */
export function stageItems(meta: Pick<Meta, 'stages' | 'schedule'>, today: string): StageItem[] {
  const sch = meta.schedule;
  if (!sch) return [];
  const st = meta.stages && meta.stages.date === today ? meta.stages : null;
  return STAGE_ORDER.map((id) => {
    const s = st?.[id];
    const label = sch[id]?.label ?? id;
    if (s?.status === 'done') return { id, label, text: `${s.at} 完成`, state: 'done' };
    if (s?.status === 'late') return { id, label, text: '逾時・下一段補抓', state: 'late' };
    return { id, label, text: `等待（約 ${sch[id]?.time ?? '—'}）`, state: 'waiting' };
  });
}
