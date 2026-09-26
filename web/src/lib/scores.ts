/** 分數計算（與 pipeline/derive/scores.py 相同規則，供設定頁調整權重後即時重算綜合分）。 */
import { CATEGORY_IDS, scoresConfig, type CategoryId, type Mapping } from './config';

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 因子原始值 → 0–100 子分數。margin_matrix 需要股價 5 日變化。 */
export function mapScore(x: number | null | undefined, mapping: Mapping, priceChange?: number | null): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  switch (mapping.type) {
    case 'linear':
      return 100 * clamp((x - mapping.x0) / (mapping.x1 - mapping.x0), 0, 1);
    case 'identity':
      return clamp(x, 0, 100);
    case 'inverse':
      return 100 - clamp(x, 0, 100);
    case 'margin_matrix': {
      if (priceChange === null || priceChange === undefined || !Number.isFinite(priceChange)) return null;
      const t = mapping.threshold_pct;
      const s = mapping.scores;
      if (x > t) return priceChange < 0 ? s.up_price_down : s.up_price_up;
      if (x < -t) return priceChange < 0 ? s.down_price_down : s.down_price_up;
      return s.flat;
    }
  }
}

/** 加權平均：缺值不計、權重重新正規化；全部缺值 → null。 */
export function weightedMean(parts: { value: number | null | undefined; weight: number }[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of parts) {
    if (p.value === null || p.value === undefined || !Number.isFinite(p.value) || p.weight <= 0) continue;
    num += p.value * p.weight;
    den += p.weight;
  }
  return den > 0 ? num / den : null;
}

export type Weights = Record<CategoryId, number>;
export const DEFAULT_WEIGHTS: Weights = { ...scoresConfig.composite.weights };

/** 綜合分：類別分依權重平均；至少 2 個類別有分數才計算。 */
export function composite(categories: Partial<Record<CategoryId, number | null | undefined>>, weights: Weights = DEFAULT_WEIGHTS): number | null {
  const parts = CATEGORY_IDS.map((c) => ({ value: categories[c], weight: weights[c] ?? 0 }));
  const available = parts.filter((p) => p.value !== null && p.value !== undefined && Number.isFinite(p.value)).length;
  if (available < 2) return null;
  return weightedMean(parts);
}

/** 由因子原始值計算類別分（方法說明頁的範例與測試用）。 */
export function categoryScore(cat: CategoryId, raw: Record<string, number | null | undefined>, priceChange5d?: number | null): number | null {
  const factors = scoresConfig.categories[cat].factors;
  return weightedMean(factors.map((f) => ({ value: mapScore(raw[f.id], f.mapping, priceChange5d), weight: f.weight })));
}

export function sameWeights(a: Weights, b: Weights): boolean {
  return CATEGORY_IDS.every((c) => a[c] === b[c]);
}
