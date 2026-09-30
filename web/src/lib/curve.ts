/** v3 M3-2 事件時間累積超額曲線（pipeline evidence/curve.py 預先計算；前端只讀值與顯示）。 */

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

/** 一句話摘要：「峰值第 12 日 +1.20%；第 18 日起 alpha 耗盡」。 */
export function curveSummary(line: CurveLine | undefined): string {
  if (!line || line.peak === null) return '曲線資料累積中';
  const pv = line.mean[line.peak - 1];
  const f = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  return `峰值第 ${line.peak} 日 ${f(pv)}；` + (line.exhaust ? `第 ${line.exhaust} 日起 alpha 耗盡` : '60 日內沒有連續 5 日邊際超額 ≤ 0');
}
