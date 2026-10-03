/**
 * 探索頁功能卡（選股 → 策略庫 → 指標效度表 → 回測，順序固定）的即時數字。
 * 2026-10-02 健檢 M1-1：策略數改用策略庫的分級（strategies.json 的 grade，與策略庫頁首同一個函式 gradeCounts），
 * 不再用 config/strategies.yml × 指標判定自己數；今日新觸發＝上架策略（有效／觀察中）的今日新觸發不重複檔數，
 * 與各策略頁的「今日新觸發」同一份資料。
 */
import type { EvidenceFile } from './evidence';
import { type GradeCounts, gradeCounts, isListed, verdictCounts } from './status';
import type { StrategyItem } from './strategies';

export interface LabStatus {
  /** 上架策略今日新觸發的不重複股票數 */
  today: number;
  /** 不計入總數的策略（例：資料不足區）今日觸發數 */
  todayExcluded: number;
  grades: GradeCounts;
  valid: number;
  env: number;
  tests: number;
  updated: string | null;
}

export function labStatus(ev: EvidenceFile | null, strategies: StrategyItem[] | null): LabStatus | null {
  if (!ev || !ev.rows?.length) return null;
  const codes = new Set<string>();
  let excluded = 0;
  for (const s of strategies ?? []) {
    if (!isListed(s)) continue;
    if (s.limited) { excluded += s.today?.length ?? 0; continue; }
    for (const x of s.today ?? []) codes.add(x.code);
  }
  const vc = verdictCounts(ev.rows);
  const g = ev.meta.generated_at;
  const updated = g ? `${Number(g.slice(5, 7))}/${Number(g.slice(8, 10))} ${g.slice(11, 16)}` : null;
  return {
    today: codes.size,
    todayExcluded: excluded,
    grades: gradeCounts(strategies),
    valid: vc['有效'],
    env: vc['環境依賴'],
    tests: vc.total,
    updated,
  };
}
