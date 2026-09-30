/** v3 M5-1 探索頁四張功能卡（選股 → 策略庫 → 指標效度表 → 回測，順序固定、不依 alpha 排序）的即時數字。 */
import { strategiesConfig } from './config';
import { type EvidenceFile, type EvidenceToday, isUsable } from './evidence';

/** 首頁四張功能卡的即時數字：今日新觸發（通過驗證的指標，不重複的股票）、通過驗證的策略數、判定數、資料更新時間。 */
export function labStatus(ev: EvidenceFile | null, today: EvidenceToday | null): { today: number; strategies: number; valid: number; env: number; updated: string | null } | null {
  if (!ev || !ev.rows?.length) return null;
  const usable = new Set(ev.rows.filter((r) => isUsable(r.verdict)).map((r) => r.id));
  const codes = new Set<string>();
  for (const [id, t] of Object.entries(today?.tests ?? {})) {
    if (!usable.has(id)) continue;
    for (const [code, d] of Object.entries(t.t)) if (d === today?.date) codes.add(code);
  }
  const g = ev.meta.generated_at;
  const updated = g ? `${Number(g.slice(5, 7))}/${Number(g.slice(8, 10))} ${g.slice(11, 16)}` : null;
  return {
    today: codes.size,
    strategies: strategiesConfig.strategies.filter((s) => usable.has(s.test)).length,
    valid: ev.rows.filter((r) => r.verdict === '有效').length,
    env: ev.rows.filter((r) => r.verdict === '環境依賴').length,
    updated,
  };
}

