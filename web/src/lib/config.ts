/** 由 /config/*.yml 匯入（build 時嵌入），與 pipeline 共用單一事實來源。 */
import scoresYml from '../../../config/scores.yml';
import thresholdsYml from '../../../config/thresholds.yml';
import costsYml from '../../../config/costs.yml';
import screenerYml from '../../../config/screener.yml';
import sourcesYml from '../../../config/sources.yml';

export type Mapping =
  | { type: 'linear'; x0: number; x1: number }
  | { type: 'identity' }
  | { type: 'inverse' }
  | { type: 'margin_matrix'; threshold_pct: number; scores: Record<string, number> };

export interface FactorConfig {
  id: string;
  label: string;
  unit: string;
  weight: number;
  description: string;
  mapping: Mapping;
}
export interface CategoryConfig {
  label: string;
  description: string;
  factors: FactorConfig[];
}
export type CategoryId = 'chip' | 'momentum' | 'fundamental' | 'valuation';
export interface ScoresConfig {
  version: number;
  composite: { label: string; description: string; weights: Record<CategoryId, number> };
  categories: Record<CategoryId, CategoryConfig>;
}
export interface CostsConfig {
  commission: { rate: number; discount: number; minimum: number; minimum_enabled: boolean };
  tax: { stock: number; etf: number };
}
export interface ScreenerField { label: string; unit: string; group: string }
export interface Condition { field: string; op: '>' | '>=' | '<' | '<=' | '==' | 'between'; value: number | [number, number] }
export interface Preset { id: string; label: string; description: string; conditions: Condition[] }
export interface ScreenerConfig { fields: Record<string, ScreenerField>; presets: Preset[] }
export interface SourceConfig { label: string; market: string; tier: string; frequency: string; url?: string; status: string; publish?: string }

export const scoresConfig = scoresYml as ScoresConfig;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const thresholds = thresholdsYml as any;
export const costsConfig = costsYml as CostsConfig;
export const screenerConfig = screenerYml as ScreenerConfig;
export const sourcesConfig = (sourcesYml as { sources: Record<string, SourceConfig> }).sources;
export const CATEGORY_IDS: CategoryId[] = ['chip', 'momentum', 'fundamental', 'valuation'];

// ---------- 介面行為參數（config/ui.yml） ----------
import uiYml from '../../../config/ui.yml';

export interface BadgeConfig { id: string; label: string; description: string; metric: string; target: number }
export interface UiConfig {
  significance: { price_pct: number; composite_points: number; inst_streak_days: number; inst_volume_pct: number; margin_pct: number; near_stop_pct: number };
  env_state: { conservative_min_red: number; aggressive_min_green: number };
  impulse: { env_conservative: boolean; ma20_gap_pct: number; price_change_5d_pct: number };
  backtest_confidence: { low_below: number; high_from: number };
  gamification: {
    review_window_days: number;
    stop_respected_tolerance_pct: number;
    xp: Record<'brief_read' | 'checklist_done' | 'review_done' | 'ritual_done' | 'backup' | 'backtest_own', number>;
    level_step: number;
    badges: BadgeConfig[];
  };
}
export const uiConfig = uiYml as UiConfig;
