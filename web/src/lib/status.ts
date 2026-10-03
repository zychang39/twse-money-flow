/**
 * 策略與指標的狀態詞彙（2026-10-02 健檢 M1-1：全站同一個定義與計數）。
 *
 * 兩套狀態、兩個名字，不混用：
 * - 「指標判定」（verdict，指標效度表 evidence.json 每個指標一個）：有效／環境依賴／不穩定／樣本不足／樣本範圍受限／無效。
 * - 「策略分級」（grade，策略庫 strategies.json 每套策略一個，2026-10-03 起）：有效／訊號顯著・未勝 0050／觀察中／無效。
 * 「上架」＝分級不是無效（可設為訊號追蹤、個股頁策略訊號列出）。畫面上的策略數一律用這裡的 gradeCounts，
 * 指標數一律用 verdictCounts；不再各頁自己數。
 */
import type { EvidenceRow, Verdict } from './evidence';
import { VERDICT_ORDER } from './evidence';
import { type Grade, type StrategyItem, GRADE_LABEL, GRADE_ORDER, gradeOf } from './strategies';

export const GRADE_NAME = '策略分級';
export const VERDICT_NAME = '指標判定';
export const LISTED_GRADES: Grade[] = ['valid', 'sig_only', 'watch'];

export interface GradeCounts { valid: number; sig_only: number; watch: number; invalid: number; listed: number; total: number }

export function gradeCounts(list: Pick<StrategyItem, 'grade' | 'enabled'>[] | null | undefined): GradeCounts {
  const c = { valid: 0, sig_only: 0, watch: 0, invalid: 0, listed: 0, total: 0 };
  for (const s of list ?? []) {
    c[gradeOf(s)]++;
    c.total++;
  }
  c.listed = c.valid + c.sig_only + c.watch;
  return c;
}

/** 上架：分級不是無效，且沒有被人工停用或超過名額（enabled）。 */
export const isListed = (s: Pick<StrategyItem, 'grade' | 'enabled'>): boolean => LISTED_GRADES.includes(gradeOf(s)) && s.enabled !== false;

/** 「有效 1、訊號顯著・未勝 0050 1、觀察中 2」（策略庫頁首、探索卡共用同一句）。 */
export function gradeSummary(c: GradeCounts): string {
  return `${GRADE_LABEL.valid} ${c.valid}、${GRADE_LABEL.sig_only} ${c.sig_only}、${GRADE_LABEL.watch} ${c.watch}`;
}

/** 「上架 4 套」 */
export function listedText(c: GradeCounts): string {
  return `上架 ${c.listed} 套`;
}

export type VerdictCounts = Record<Verdict, number> & { total: number; usable: number };

export function verdictCounts(rows: Pick<EvidenceRow, 'verdict'>[] | null | undefined): VerdictCounts {
  const out = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<Verdict, number>;
  let total = 0;
  for (const r of rows ?? []) {
    out[r.verdict] = (out[r.verdict] ?? 0) + 1;
    total++;
  }
  return { ...out, total, usable: out['有效'] + out['環境依賴'] };
}

/** 「4 項有效・1 項環境依賴」（指標效度表頁首與探索卡共用）。 */
export function verdictSummary(c: VerdictCounts): string {
  return `${c['有效']} 項有效・${c['環境依賴']} 項環境依賴`;
}

/** 指標 id → 最好的策略分級（同一指標對應多套策略時取最好）；沒有策略資料時 null。 */
export function gradeByTestMap(list: StrategyItem[] | null | undefined): Map<string, { grade: Grade; label: string }> | null {
  if (!list) return null;
  const out = new Map<string, { grade: Grade; label: string }>();
  for (const s of list) {
    const g = gradeOf(s);
    const prev = out.get(s.test);
    if (!prev || GRADE_ORDER[g] < GRADE_ORDER[prev.grade]) out.set(s.test, { grade: g, label: GRADE_LABEL[g] });
  }
  return out;
}
