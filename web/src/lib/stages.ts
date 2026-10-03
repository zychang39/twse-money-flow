/**
 * 分段更新的狀態列（M3.4；今晚頁）。純函式。
 * 2026-10-02 健檢 M1-2：依交易日曆判斷。休市日不是「等待」，而是「休市・最近交易日 10/2：收盤行情 完成・法人 完成・信用 未更新」；
 * 交易日第一段（14:15）開始前寫「今天尚未開始更新（約 14:15 起）」，不列三個「等待」。
 */
import type { Meta } from '../data/types';
import { md } from './format';
import type { TradingCalendar } from './tradingCalendar';

export const STAGE_ORDER = ['close', 'insti', 'credit'] as const;
export type StageId = (typeof STAGE_ORDER)[number];

export interface StageItem { id: StageId; label: string; text: string; state: 'done' | 'late' | 'waiting' }

export interface StageLine {
  kind: 'today' | 'before' | 'holiday';
  /** 整列前面的說明：「休市・最近交易日 10/2：」；交易日為空 */
  prefix: string;
  /** 沒有分段項目時的一句話（例：「今天尚未開始更新（約 14:15 起）」） */
  message: string | null;
  items: StageItem[];
}

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

/** 休市日：最近交易日各段的結果（完成／逾時／未更新），不再「等待」。 */
function holidayItems(meta: Pick<Meta, 'stages' | 'schedule'>, lastTradingDay: string): StageItem[] {
  const sch = meta.schedule;
  if (!sch) return [];
  const st = meta.stages && meta.stages.date === lastTradingDay ? meta.stages : null;
  return STAGE_ORDER.map((id) => {
    const s = st?.[id];
    const label = sch[id]?.label ?? id;
    if (s?.status === 'done') return { id, label, text: '完成', state: 'done' };
    if (s?.status === 'late') return { id, label, text: '逾時', state: 'late' };
    return { id, label, text: '未更新', state: 'waiting' };
  });
}

/**
 * 狀態列：today＝台北時間今天（YYYY-MM-DD）、hm＝台北時間現在「HH:MM」（沒有給就不判斷開始時間）。
 * - 今天不是交易日 → 最近交易日（calendar.previous）的結果，前綴「休市・最近交易日 M/D：」
 * - 交易日、第一段排程時間之前 → 「今天尚未開始更新（約 14:15 起）」
 * - 其餘 → 原本的今日分段（完成／逾時／等待）
 */
export function stageLine(meta: Pick<Meta, 'stages' | 'schedule'>, today: string, calendar?: TradingCalendar | null, hm?: string | null): StageLine {
  const sch = meta.schedule;
  if (!sch) return { kind: 'today', prefix: '', message: null, items: [] };
  if (calendar && !calendar.isTradingDay(today)) {
    const last = calendar.previous(today);
    return { kind: 'holiday', prefix: `休市・最近交易日 ${md(last)}：`, message: null, items: holidayItems(meta, last) };
  }
  const first = sch[STAGE_ORDER[0]]?.time;
  const started = meta.stages?.date === today && STAGE_ORDER.some((id) => meta.stages?.[id]);
  if (hm && first && hm < first && !started) {
    return { kind: 'before', prefix: '', message: `今天尚未開始更新（約 ${first} 起）`, items: [] };
  }
  return { kind: 'today', prefix: '', message: null, items: stageItems(meta, today) };
}

/** 整列的純文字（無障礙標籤、測試用）：「休市・最近交易日 10/2：收盤行情 完成・法人 完成・信用 未更新」 */
export function stageLineText(line: StageLine): string {
  if (line.message) return line.message;
  return `${line.prefix}${line.items.map((s) => `${s.label} ${s.text}`).join('・')}`;
}
