/**
 * 策略／指標名稱表（2026-10-02 健檢 M1-1：全站同一個名字）。
 *
 * 唯一來源＝config/strategies.yml 與 config/swing.yml 的 label／subtitle（命名規則見 CLAUDE.md 產品原則 9）。
 * 指標效度表（evidence.json）每個指標有 pipeline/evidence/catalog.py 的「指標名」（例：營收創 12 個月新高）；
 * 當這個指標有對應的策略時，全站一律顯示策略名（營收一年高），指標名改為副標說明，不再一頁一個名字。
 * 舊名稱（aliases）自動對應到新名稱（儲存的追蹤策略、網址參數）。
 */
import { strategiesConfig, swingConfig } from './config';

export interface NameEntry {
  id: string;
  /** 對應的指標 id（strategies.yml 的 test；波段策略＝自己的 id） */
  test: string;
  label: string;
  subtitle: string;
  aliases: string[];
  kind: 'strategy' | 'swing';
}

export const STRATEGY_NAMES: NameEntry[] = [
  ...strategiesConfig.strategies.map((s) => ({ id: s.id, test: s.test, label: s.label, subtitle: s.subtitle, aliases: s.aliases ?? [], kind: 'strategy' as const })),
  ...swingConfig.strategies.map((s) => ({ id: s.id, test: s.id, label: s.label, subtitle: s.subtitle, aliases: s.aliases ?? [], kind: 'swing' as const })),
];

const BY_TEST = new Map(STRATEGY_NAMES.map((n) => [n.test, n]));
const BY_ID = new Map(STRATEGY_NAMES.map((n) => [n.id, n]));

export const strategyByTest = (test: string): NameEntry | undefined => BY_TEST.get(test);
export const strategyById = (id: string): NameEntry | undefined => BY_ID.get(id);

/**
 * 指標的顯示名：有對應策略 → 策略名（主）＋指標名（副）；沒有 → 指標名。
 * 例：rev_high12 → { label: '營收一年高', sub: '指標：營收創 12 個月新高' }。
 */
export function displayName(testId: string, indicatorLabel: string): { label: string; sub: string | null } {
  const s = BY_TEST.get(testId);
  if (!s) return { label: indicatorLabel, sub: null };
  return { label: s.label, sub: s.label === indicatorLabel ? null : `指標：${indicatorLabel}` };
}

/** 舊名稱（aliases）→ 現行主標；不是舊名稱時原樣回傳。 */
export function canonicalStrategyName(name: string): string {
  const t = name.trim();
  const hit = STRATEGY_NAMES.find((n) => n.aliases.includes(t));
  return hit ? hit.label : name;
}
