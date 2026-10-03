/**
 * 通用圖表的軸（D5）：範圍依「目前期間內所有可選序列（含未勾選）」一次算好；刻度取整數（或 1／2／5 × 10^k 的整數倍）。
 * 切換序列或基準不重新計算；只有期間或對數／線性改變時才更新。純函式（有單元測試）。
 */

export interface Axis { lo: number; hi: number; ticks: number[]; log: boolean }

const NICE = [1, 2, 2.5, 5, 10];

/** 線性刻度：步長取 1／2／2.5／5 × 10^k，且至少為 1（整數刻度；minStep 可改）。 */
export function linearAxis(values: number[], target = 4, minStep = 1): Axis {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { lo: 0, hi: 1, ticks: [0, 1], log: false };
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < 1e-9) { lo -= minStep; hi += minStep; }
  const raw = (hi - lo) / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = NICE.map((n) => n * p).find((s) => s >= raw) ?? 10 * p;
  step = Math.max(minStep, step);
  if (minStep >= 1) step = Math.ceil(step);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let x = a; x <= b + step / 2; x += step) ticks.push(Math.round(x * 1e6) / 1e6);
  return { lo: a, hi: b, ticks, log: false };
}

/** 對數刻度（淨值類，> 0）：刻度取 1／2／5 × 10^k；範圍略放寬到最近的刻度。 */
export function logAxis(values: number[]): Axis {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return { lo: 1, hi: 10, ticks: [1, 10], log: true };
  const lo = Math.min(...v), hi = Math.max(...v);
  const cands: number[] = [];
  for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)) + 1; k++) for (const m of [1, 2, 5]) cands.push(m * Math.pow(10, k));
  let a = cands.filter((c) => c <= lo).pop() ?? lo;
  let b = cands.find((c) => c >= hi) ?? hi;
  if (a === b) { a /= 2; b *= 2; }
  let ticks = cands.filter((c) => c >= a - 1e-9 && c <= b + 1e-9);
  // 刻度太密（> 6）只留 1 × 10^k 與兩端
  if (ticks.length > 6) ticks = ticks.filter((c, i) => i === 0 || i === ticks.length - 1 || Math.abs(Math.log10(c) % 1) < 1e-9);
  return { lo: a, hi: b, ticks, log: true };
}

/** 值 → 0（下緣）～1（上緣）。 */
export function axisPos(v: number, ax: Axis): number {
  if (ax.log) return (Math.log(v) - Math.log(ax.lo)) / (Math.log(ax.hi) - Math.log(ax.lo));
  return (v - ax.lo) / (ax.hi - ax.lo || 1);
}

/** 兩個軸之間的補間（動畫過渡；刻度沿用目標軸）。 */
export function lerpAxis(a: Axis, b: Axis, t: number): Axis {
  if (a.log !== b.log) return t < 0.5 ? a : b;
  if (b.log) {
    const lo = Math.exp(Math.log(a.lo) + (Math.log(b.lo) - Math.log(a.lo)) * t);
    const hi = Math.exp(Math.log(a.hi) + (Math.log(b.hi) - Math.log(a.hi)) * t);
    return { lo, hi, ticks: b.ticks, log: true };
  }
  return { lo: a.lo + (b.lo - a.lo) * t, hi: a.hi + (b.hi - a.hi) * t, ticks: b.ticks, log: false };
}

/** 線尾標籤避免重疊：依 y 排序後往下推，最小間距 gap；超出 [top, bottom] 時整組往上平移。 */
export function spreadLabels(ys: number[], gap: number, top: number, bottom: number): number[] {
  const idx = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(ys.length);
  let prev = -Infinity;
  for (const [y, i] of idx) { const v = Math.max(y, prev + gap, top); out[i] = v; prev = v; }
  const maxY = Math.max(...out);
  if (maxY > bottom) {
    const shift = maxY - bottom;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(top, out[i] - shift);
  }
  return out;
}
