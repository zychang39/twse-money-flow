/** v3 M3-2 事件時間累積超額曲線（pipeline evidence/curve.py 預先計算；前端只讀值與顯示）。 */
import { missing, orMissing, pctSigned } from './format';

export interface CurveLine {
  mean: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  dates?: number[];
  peak: number | null;
  exhaust: number | null;
}

export interface CurveData {
  n: number;
  k?: number[];
  ew?: CurveLine;
  '0050'?: CurveLine;
}

/** 第 k 日（1 起算）的讀值；超出範圍夾到兩端。 */
export function curveRead(line: CurveLine, k: number): { k: number; mean: number | null; lo: number | null; hi: number | null } {
  const K = line.mean.length;
  const kk = Math.max(1, Math.min(K, Math.round(k)));
  return { k: kk, mean: line.mean[kk - 1] ?? null, lo: line.lo[kk - 1] ?? null, hi: line.hi[kk - 1] ?? null };
}

/** 一句話摘要：「峰值第 12 日 +1.20%；第 18 日起 alpha 耗盡」；沒有曲線時「—（曲線資料累積中：需要至少 2 個進場日）」。 */
export function curveSummary(line: CurveLine | undefined): string {
  if (!line || line.peak === null) return missing('曲線資料累積中：需要至少 2 個進場日');
  const pv = line.mean[line.peak - 1];
  return `峰值第 ${line.peak} 日 ${orMissing(pv, pctSigned, '沒有讀值')}；` + (line.exhaust ? `第 ${line.exhaust} 日起 alpha 耗盡` : '60 日內沒有連續 5 日邊際超額 ≤ 0');
}
