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
