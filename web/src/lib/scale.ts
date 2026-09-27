/** 圖表座標軸的取整刻度（純函式）。 */

/** 取整的刻度間距：1、2、2.5、5 × 10ⁿ */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

/** y 範圍與刻度（由上到下）：bars 以 0 為中心上下對稱；lines 取整到刻度（zero 時包含 0）。 */
export function niceScale(values: number[], kind: 'bars' | 'lines', opts: { fixed?: [number, number]; zero?: boolean } = {}): { lo: number; hi: number; ticks: number[] } {
  if (opts.fixed) {
    const [lo, hi] = opts.fixed;
    return { lo, hi, ticks: [hi, (lo + hi) / 2, lo] };
  }
  if (!values.length) return { lo: 0, hi: 1, ticks: [1, 0] };
  if (kind === 'bars') {
    const m = niceStep(Math.max(1, ...values.map(Math.abs)));
    return { lo: -m, hi: m, ticks: [m, 0, -m] };
  }
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { const d = Math.abs(hi) * 0.05 || 1; hi += d; lo -= d; }
  const step = niceStep((hi - lo) / 2);
  const nlo = Math.floor(lo / step + 1e-9) * step;
  const nhi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = nhi; v >= nlo - step / 2; v -= step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { lo: nlo, hi: nhi, ticks };
}
