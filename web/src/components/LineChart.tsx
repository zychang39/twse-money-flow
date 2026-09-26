/** 輕量 SVG 折線圖（不需載入圖表函式庫）。 */
export interface Line { label: string; color: string; values: (number | null)[] }

export function LineChart({ dates, lines, height = 180, ariaLabel, format = (v: number) => v.toFixed(0) }: {
  dates: string[]; lines: Line[]; height?: number; ariaLabel: string; format?: (v: number) => string;
}) {
  const W = 340, H = height, padL = 40, padR = 8, padT = 8, padB = 22;
  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (all.length < 2 || dates.length < 2) return <p class="small muted">資料不足。</p>;
  const lo = Math.min(...all), hi = Math.max(...all);
  const sx = (i: number) => padL + (i / (dates.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="var(--separator)" />
            <text x={2} y={sy(v) + 3} font-size="9" fill="var(--label-2)">{format(v)}</text>
          </g>
        ))}
        {lines.map((l) => {
          let d = '';
          let pen = false;
          l.values.forEach((v, i) => {
            if (v === null || !Number.isFinite(v)) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)} `;
            pen = true;
          });
          return <path key={l.label} d={d} fill="none" stroke={l.color} stroke-width="1.8" />;
        })}
        <text x={padL} y={H - 6} font-size="9" fill="var(--label-2)">{dates[0]}</text>
        <text x={W - padR - 52} y={H - 6} font-size="9" fill="var(--label-2)">{dates[dates.length - 1]}</text>
      </svg>
      <figcaption class="row wrap tiny" style={{ gap: '0.75rem' }}>
        {lines.map((l) => <span key={l.label}><span aria-hidden="true" style={{ color: l.color }}>●</span> {l.label}</span>)}
      </figcaption>
    </figure>
  );
}
