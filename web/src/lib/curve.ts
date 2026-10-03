/**
 * 事件時間累積超額曲線（pipeline evidence/curve.py 預先計算；前端只讀值與顯示）。
 * 2026-10-03：觀察窗 120 日、移除 alpha 耗盡；峰值落在觀察窗右邊界（第 K 日）時 peak_at_edge＝true，
 * 畫面標「峰值在觀察窗邊界」（真正的峰值可能在窗外）。
 */
import { missing, orMissing, pctSigned } from './format';

export interface CurveLine {
  mean: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  dates?: number[];
  peak: number | null;
  peak_at_edge?: boolean;
}

export interface CurveData {
  n: number;
  k?: number[];
  days?: number;
  ew?: CurveLine;
  '0050'?: CurveLine;
}

export const EDGE_TEXT = '峰值在觀察窗邊界';

/** 第 k 日（1 起算）的讀值；超出範圍夾到兩端。 */
export function curveRead(line: CurveLine, k: number): { k: number; mean: number | null; lo: number | null; hi: number | null } {
  const K = line.mean.length;
  const kk = Math.max(1, Math.min(K, Math.round(k)));
  return { k: kk, mean: line.mean[kk - 1] ?? null, lo: line.lo[kk - 1] ?? null, hi: line.hi[kk - 1] ?? null };
}

/** 峰值落在右邊界：讀 pipeline 的旗標；舊資料沒有旗標時用「峰值＝最後一天」判斷。 */
export const peakAtEdge = (line: CurveLine): boolean => line.peak_at_edge ?? (line.peak !== null && line.peak >= line.mean.length);

/** 一句話摘要：「峰值第 120 日 +5.82%・峰值在觀察窗邊界」；沒有曲線時說明原因。 */
export function curveSummary(line: CurveLine | undefined): string {
  if (!line || line.peak === null) return missing('曲線資料累積中：需要至少 2 個進場日');
  const pv = line.mean[line.peak - 1];
  return `峰值第 ${line.peak} 日 ${orMissing(pv, pctSigned, '沒有讀值')}${peakAtEdge(line) ? `・${EDGE_TEXT}` : ''}`;
}

/** 整數刻度：涵蓋 [lo, hi] 的 1／2／5 × 10^n 步長，最多約 5 格；回傳刻度值（含 lo、hi 外側的整數格線）。 */
export function intTicks(lo: number, hi: number, target = 4): number[] {
  const span = Math.max(hi - lo, 1e-9);
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v));
  return out;
}

/** 對數軸刻度（權益倍數，期初 1）：…0.5、1、2、4、8…（2 的次方）涵蓋 [lo, hi]；跨度太大時改用 10 的次方。 */
export function logTicks(lo: number, hi: number): number[] {
  const l2 = Math.floor(Math.log2(Math.max(lo, 1e-6)));
  const h2 = Math.ceil(Math.log2(Math.max(hi, 1e-6)));
  const n = h2 - l2;
  const base = n > 8 ? 10 : 2;
  const a = Math.floor(Math.log(Math.max(lo, 1e-6)) / Math.log(base));
  const b = Math.ceil(Math.log(Math.max(hi, 1e-6)) / Math.log(base));
  const out: number[] = [];
  for (let e = a; e <= b; e++) out.push(base ** e);
  return out;
}
