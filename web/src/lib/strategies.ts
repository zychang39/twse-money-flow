/** 策略庫（M2）：strategies.json 的型別與顯示用的純函式。清單依規則產生，非推薦。 */
import type { PortfolioStats, TradeStats, LeverageRules } from './leverage';

export interface ExitRow { rule: string; param: string; label: string; chosen: boolean; n: number; ev: number | null; exc_idx: number | null; win: number | null; hold: number | null; mae: number | null; locked: number }

export interface StrategyItem {
  id: string;
  test: string;
  label: string;
  subtitle: string;
  verdict: string;
  enabled: boolean;
  reasons: string[];
  env: { dim: string; side: string; label: string; today: boolean } | null;
  param?: string | null;
  definition?: string;
  coverage?: import('./evidence').Coverage;
  data_start?: string | null;
  signal_start?: string | null;
  signal_end?: string | null;
  h?: Record<string, { n?: number; mean_excess?: number | null; t?: number | null }>;
  years?: Record<string, number | null>;
  env_stats?: Record<string, { on: number | null; off: number | null }>;
  t?: number | null;
  mean_excess?: number | null;
  n?: number;
  note?: string;
  health?: { status: string; recent: number | null; recent_n: number; recent_t: number | null; since: string | null; long: number | null };
  today?: { code: string; name: string }[];
  exit?: { rule: string; param: string; label: string; stats: Partial<ExitRow>; alternatives: ExitRow[] };
  trades?: TradeStats & { n: number; mean_net: number | null; win: number | null; hold: number | null; yearly: Record<string, { n: number; mean_net: number | null; exc_idx: number | null; win: number | null }> };
  portfolio?: Record<string, PortfolioStats & { yearly?: Record<string, number | null>; total?: number | null }>;
  curve?: { dates: string[]; equity: number[]; bench: number[]; etf?: Record<string, (number | null)[]> };
  /** v3 M2：事件對四種基準的超額（判定仍以等權為準） */
  bench?: Record<BenchKey, BenchStat | null>;
  t_0050?: number | null;
  large_cap?: string | null;
  delist?: import('./evidence').EvidenceRow['delist'];
  hindsight?: import('./evidence').Hindsight;
  /** v3 M2-3：5 檔組合 vs (b)(c)(d) 同期 */
  compare?: BenchCompare;
}

export type BenchKey = 'ew' | 'tr' | '0050' | '00631L';
export const BENCH_KEYS: BenchKey[] = ['ew', 'tr', '0050', '00631L'];
export const BENCH_LABEL: Record<BenchKey, string> = { ew: '等權', tr: '加權報酬', '0050': '0050', '00631L': '00631L' };
export interface BenchStat { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null; dates?: number }

export interface Perf {
  days?: number;
  ann_return?: number | null;
  vol_ann?: number | null;
  sharpe?: number | null;
  calmar?: number | null;
  mdd?: number | null;
  dd_days?: number;
  total?: number | null;
  yearly?: Record<string, number | null>;
}

export interface BenchCompare {
  period: [string, string] | null;
  strategy: Perf;
  tr?: Perf;
  '0050'?: Perf;
  '00631L'?: Perf;
  regression?: { months: number; beta?: number; alpha_ann?: number | null; alpha_t?: number | null; r2?: number | null };
}

/** 績效指標表的列（策略與各基準同一組指標）。 */
export const PERF_ROWS: { key: keyof Perf; label: string; kind: 'pct' | 'ratio' | 'days' }[] = [
  { key: 'ann_return', label: '年化報酬', kind: 'pct' },
  { key: 'vol_ann', label: '年化波動', kind: 'pct' },
  { key: 'sharpe', label: 'Sharpe', kind: 'ratio' },
  { key: 'calmar', label: 'Calmar', kind: 'ratio' },
  { key: 'mdd', label: '最大回撤', kind: 'pct' },
  { key: 'dd_days', label: '回撤天數', kind: 'days' },
];

export interface StrategiesFile {
  date: string;
  horizon: number;
  env_today: { regime: boolean; trend: boolean; quarter_end: boolean };
  leverage: LeverageRules & { default_max_dd: number; default_interest: number; default_breaker: number };
  slots: number[];
  strategies: StrategyItem[];
}

/** 健康度的語氣：轉弱與低於長期用琥珀（風險）；其他中性。 */
export const healthTone = (status: string | undefined): 'risk' | 'plain' =>
  status === '近期轉弱' || status === '近期低於長期' ? 'risk' : 'plain';

/** 環境條件的說明與今日狀態。 */
export function envLine(s: StrategyItem): string {
  if (!s.env) return '適用：各種大盤環境';
  return `僅在「${s.env.label}」時啟用・今日${s.env.today ? '符合' : '不符合'}`;
}

/** 自選群組名稱：策略的主標前加「策略：」。 */
export const groupName = (s: Pick<StrategyItem, 'label'>): string => `策略：${s.label}`;

export const enabledFirst = (list: StrategyItem[]): { enabled: StrategyItem[]; disabled: StrategyItem[] } => ({
  enabled: list.filter((s) => s.enabled),
  disabled: list.filter((s) => !s.enabled),
});
