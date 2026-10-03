/** 走勢圖幾何：座標換算、路徑、重新取樣（期間切換時的平滑變形）、拖曳時找最近的點。純函式。 */

export interface Frame { w: number; h: number; padX: number; padY: number }

export function extent(values: number[], extra?: number | null): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (extra !== null && extra !== undefined && Number.isFinite(extra)) { lo = Math.min(lo, extra); hi = Math.max(hi, extra); }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-9) { const pad = Math.abs(hi) * 0.01 || 1; return [lo - pad, hi + pad]; }
  return [lo, hi];
}

export function points(values: number[], f: Frame, range: [number, number]): [number, number][] {
  const [lo, hi] = range;
  const n = values.length;
  return values.map((v, i) => [
    f.padX + (n === 1 ? 0.5 : i / (n - 1)) * (f.w - 2 * f.padX),
    f.padY + (1 - (v - lo) / (hi - lo)) * (f.h - 2 * f.padY),
  ]);
}

export function yOf(v: number, f: Frame, range: [number, number]): number {
  return f.padY + (1 - (v - range[0]) / (range[1] - range[0])) * (f.h - 2 * f.padY);
}

export function pathD(pts: [number, number][]): string {
  let d = '';
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  return d;
}

export function areaD(pts: [number, number][], h: number, smooth = false): string {
  if (!pts.length) return '';
  return `${smooth ? smoothD(pts) : pathD(pts)}L${pts[pts.length - 1][0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`;
}

/**
 * 平滑曲線（單調三次插值，Fritsch–Carlson）：通過每一個資料點，兩點之間不會超出兩端數值（不產生過衝，
 * 不會畫出比實際最高更高、比實際最低更低的假波峰）。x 必須遞增。
 */
export function smoothD(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return pathD(pts);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1][0] - pts[i][0];
    dx.push(h);
    m.push(h === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h);
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const c1x = pts[i][0] + h, c1y = pts[i][1] + t[i] * h;
    const c2x = pts[i + 1][0] - h, c2y = pts[i + 1][1] - t[i + 1] * h;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/** 以線性內插重新取樣成 n 個點（變形過渡用：新舊路徑點數一致）。 */
export function resample(pts: [number, number][], n: number): [number, number][] {
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => pts[0]);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (pts.length - 1);
    const a = Math.floor(t), b = Math.min(pts.length - 1, a + 1), k = t - a;
    out.push([pts[a][0] + (pts[b][0] - pts[a][0]) * k, pts[a][1] + (pts[b][1] - pts[a][1]) * k]);
  }
  return out;
}

export function lerpPts(a: [number, number][], b: [number, number][], t: number): [number, number][] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
}

/** x（相對圖寬）→ 最近的資料點索引。 */
export function nearestIndex(x: number, f: Frame, n: number): number {
  if (n <= 1) return 0;
  const t = (x - f.padX) / (f.w - 2 * f.padX);
  return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}

/** 近似 spring：臨界阻尼附近的 ease（0→1），給 requestAnimationFrame 動畫用。 */
export function springEase(t: number): number {
  if (t >= 1) return 1;
  const w = 9;
  return 1 - Math.exp(-w * t) * (1 + w * t) * (1 - t);
}
