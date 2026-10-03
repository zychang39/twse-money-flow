/**
 * 策略與指標的狀態詞彙（2026-10-02 健檢 M1-1：全站同一個定義與計數）。
 *
 * 兩套狀態、兩個名字，不混用：
 * - 「指標判定」（verdict，指標效度表 evidence.json 每個指標一個）：有效／環境依賴／不穩定／樣本不足／樣本範圍受限／無效。
 *   由 config/evidence.yml verdict 規則判定（等權、40 日、t ≥ 2.5…）。
 * - 「策略分級」（grade，策略庫 strategies.json 每套策略一個）：有效／觀察中／停用。
 *   由 config/evidence.yml grading 分級（校正後 t ≥ 3 為有效、≥ 2 為觀察中…）。
 * 「上架」＝分級為有效或觀察中（可設為訊號追蹤、個股頁訊號面板列出）。畫面上的策略數一律用這裡的 gradeCounts，
 * 指標數一律用 verdictCounts；不再各頁自己數。
 */
import type { EvidenceRow, Verdict } from './evidence';
import { VERDICT_ORDER } from './evidence';
import { type Grade, type StrategyItem, gradeOf } from './strategies';

export const GRADE_NAME = '策略分級';
export const VERDICT_NAME = '指標判定';
export const LISTED_GRADES: Grade[] = ['有效', '觀察中'];

export interface GradeCounts { valid: number; watch: number; off: number; listed: number; total: number }

export function gradeCounts(list: Pick<StrategyItem, 'grade' | 'enabled'>[] | null | undefined): GradeCounts {
  const c = { valid: 0, watch: 0, off: 0, listed: 0, total: 0 };
  for (const s of list ?? []) {
    const g = gradeOf(s);
    c.total++;
    if (g === '有效') c.valid++;
    else if (g === '觀察中') c.watch++;
    else c.off++;
  }
  c.listed = c.valid + c.watch;
  return c;
}

export const isListed = (s: Pick<StrategyItem, 'grade' | 'enabled'>): boolean => LISTED_GRADES.includes(gradeOf(s));

/** 「1 個有效・3 個觀察中」（策略庫頁首、探索卡、個股頁面板共用同一句）。 */
export function gradeSummary(c: GradeCounts): string {
  return `${c.valid} 個有效・${c.watch} 個觀察中`;
}

/** 「上架 4 套（1 有效・3 觀察中）」 */
export function listedText(c: GradeCounts): string {
  return `上架 ${c.listed} 套（${c.valid} 有效・${c.watch} 觀察中）`;
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

/** 分級門檻的一句話（由 evidence.json meta.config.grading 讀，沒有時用 config 預設值）。 */
export interface GradingThresholds { t_valid: number; t_watch: number; per_month: number; years: number; year_ratio: number; horizons: number[] }
export const DEFAULT_GRADING: GradingThresholds = { t_valid: 3, t_watch: 2, per_month: 10, years: 5, year_ratio: 0.7, horizons: [40, 20] };

export function gradingThresholds(cfg: unknown): GradingThresholds {
  const g = (cfg as { grading?: { valid?: Record<string, unknown>; watch?: Record<string, unknown>; min_years_for_valid?: number } } | undefined)?.grading;
  if (!g) return DEFAULT_GRADING;
  const v = g.valid ?? {}, w = g.watch ?? {};
  return {
    t_valid: Number(v.t_corr_min ?? DEFAULT_GRADING.t_valid),
    t_watch: Number(w.t_corr_min ?? DEFAULT_GRADING.t_watch),
    per_month: Number(v.per_month_min ?? DEFAULT_GRADING.per_month),
    years: Number(g.min_years_for_valid ?? DEFAULT_GRADING.years),
    year_ratio: Number(v.year_pass_ratio ?? DEFAULT_GRADING.year_ratio),
    horizons: Array.isArray(v.net_excess_positive_horizons) ? (v.net_excess_positive_horizons as number[]) : DEFAULT_GRADING.horizons,
  };
}

/** 兩層門檻各自寫清楚：指標判定 t ≥ 2.5（等權、40 日）；策略分級校正後 t ≥ 3 有效、≥ 2 觀察中。 */
export function thresholdNote(tVerdict: number, g: GradingThresholds): string {
  return `${VERDICT_NAME}「有效」：等權 ${g.horizons[0]} 日 t ≥ ${tVerdict}（多重檢定門檻）。${GRADE_NAME}另算：校正後 t ≥ ${g.t_valid} 且 ${g.horizons.join('／')} 日扣成本超額皆 > 0、每月觸發 ≥ ${g.per_month}、樣本 ≥ ${g.years} 年為「有效」；校正後 t ≥ ${g.t_watch} 為「觀察中」。`;
}

export const verdictDefinition = (g: GradingThresholds): string =>
  `有效：${g.horizons.join(' 與 ')} 日扣成本超額皆 > 0、校正後 t ≥ ${g.t_valid}、2022 前後皆為正、逐年 ≥ ${Math.round(g.year_ratio * 100)}% 為正、每月觸發 ≥ ${g.per_month}、樣本 ≥ ${g.years} 年；觀察中：${g.horizons[0]} 日扣成本超額 > 0 且校正後 t ≥ ${g.t_watch}。`;

/** 指標 id → 最好的策略分級（同一指標對應多套策略時取最好）；沒有策略資料時 null。 */
export function gradeByTestMap(list: StrategyItem[] | null | undefined): Map<string, { grade: Grade; label: string }> | null {
  if (!list) return null;
  const out = new Map<string, { grade: Grade; label: string }>();
  const order: Record<Grade, number> = { 有效: 0, 觀察中: 1, 停用: 2 };
  for (const s of list) {
    const g = gradeOf(s);
    const prev = out.get(s.test);
    if (!prev || order[g] < order[prev.grade]) out.set(s.test, { grade: g, label: s.grade_label ?? g });
  }
  return out;
}
