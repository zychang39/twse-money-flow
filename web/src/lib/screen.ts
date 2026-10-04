/** screen.json（pipeline evidence/run.py）：各上架策略的目前篩出、觸發日、第 k 日、觸發以來報酬與今日新觸發。 */
import type { Grade } from './strategies';

export interface ScreenStrategy { id: string; label: string; subtitle?: string; grade: Grade; limited?: boolean; rank?: number | null; date: string; cols: string[]; rows: [string, string, number, number | null][]; new: string[] }
export interface ScreenFile { strategies: ScreenStrategy[] }

export const GRADE_ORDER: Grade[] = ['valid', 'sig_only', 'watch', 'invalid'];

export interface Hit { id: string; label: string; grade: Grade; trigger: string; day: number; ret: number | null; isNew: boolean }
export interface ScreenItem { code: string; hits: Hit[] }

/** 依策略篩選、合併成每檔一列（同一檔被多個策略篩出時列出全部策略；排序：觸發日新到舊 → 分級 → 代號） */
export function screenItems(file: ScreenFile | null | undefined, pick: string, view: 'new' | 'all'): ScreenItem[] {
  const by = new Map<string, Hit[]>();
  for (const s of file?.strategies ?? []) {
    if (pick !== 'all' && s.id !== pick) continue;
    const fresh = new Set(s.new);
    for (const [code, trigger, day, ret] of s.rows) {
      const isNew = fresh.has(code);
      if (view === 'new' && !isNew) continue;
      const list = by.get(code) ?? [];
      list.push({ id: s.id, label: s.label, grade: s.grade, trigger, day, ret, isNew });
      by.set(code, list);
    }
  }
  const rank = (h: Hit[]) => Math.min(...h.map((x) => GRADE_ORDER.indexOf(x.grade)));
  const latest = (h: Hit[]) => h.map((x) => x.trigger).sort().at(-1) ?? '';
  return [...by.entries()].map(([code, hits]) => ({ code, hits: hits.sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade)) }))
    .sort((a, b) => latest(b.hits).localeCompare(latest(a.hits)) || rank(a.hits) - rank(b.hits) || a.code.localeCompare(b.code));
}
