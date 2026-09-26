/** 全市場摘要 + 使用者權重（設定頁可調）→ 重新計算綜合分。 */
import { useMemo } from 'preact/hooks';
import { useAsync, useDb } from '../hooks';
import { loadSummary } from './api';
import { getSetting } from '../db/db';
import { DEFAULT_WEIGHTS, composite, sameWeights, type Weights } from '../lib/scores';
import type { StockRow } from './types';

export function useWeights(): Weights {
  return useDb(() => getSetting<Weights>('weights', DEFAULT_WEIGHTS)) ?? DEFAULT_WEIGHTS;
}

export function useScoredSummary() {
  const summary = useAsync(loadSummary, []);
  const weights = useWeights();
  const data = useMemo(() => {
    if (!summary.data) return null;
    if (sameWeights(weights, DEFAULT_WEIGHTS)) return summary.data;
    const rows: StockRow[] = summary.data.rows.map((r) => ({
      ...r,
      composite: composite({ chip: r.chip, momentum: r.momentum, fundamental: r.fundamental, valuation: r.valuation }, weights),
    }));
    return { ...summary.data, rows, byCode: new Map(rows.map((r) => [r.code, r])) };
  }, [summary.data, weights]);
  return { ...summary, data };
}
