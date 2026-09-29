/** 輕量 SVG 折線圖（分析用、次要層級）：灰階＋虛線區分多條線，不使用額外顏色；只有起訖日期與上下限標示。
 * 前後都缺值的孤立點（含只有 1 點）畫成單點標記。 */
import { segments } from '../lib/series';

export interface Line { label: string; values: (number | null)[]; tone?: 'primary' | 'secondary' | 'tertiary'; dash?: string }

const TONE = { primary: 'var(--text-1)', secondary: 'var(--text-2)', tertiary: 'var(--text-3)' };

export function LineChart({ dates, lines, height = 180, ariaLabel, format = (v: number) => v.toFixed(0) }: {
  dates: string[]; lines: Line[]; height?: number; ariaLabel: string; format?: (v: number) => string;
}) {
  const W = 340, H = height, padL = 36, padR = 8, padT = 8, padB = 22;
  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (!all.length || !dates.length) return <p class="caption muted">資料不足。</p>;
  const lo = Math.min(...all), hi = Math.max(...all);
  const sx = (i: number) => padL + (dates.length === 1 ? 0.5 : i / (dates.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        <text x={0} y={sy(hi) + 4} font-size="11" fill="var(--text-2)">{format(hi)}</text>
        <text x={0} y={sy(lo)} font-size="11" fill="var(--text-2)">{format(lo)}</text>
        {lines.map((l) => {
          const seg = segments(l.values);
          const d = seg.runs.map((run) => run.map((i, k) => `${k ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(l.values[i]!).toFixed(1)}`).join('')).join('');
          return (
            <g key={l.label}>
              {d ? <path d={d} fill="none" stroke={TONE[l.tone ?? 'primary']} stroke-width="1.6" stroke-dasharray={l.dash} stroke-linejoin="round" /> : null}
              {seg.singles.map((i) => <circle key={i} cx={sx(i)} cy={sy(l.values[i]!)} r={3} fill={TONE[l.tone ?? 'primary']} />)}
            </g>
          );
        })}
        <text x={padL} y={H - 6} font-size="11" fill="var(--text-2)">{dates[0]}</text>
        {dates.length > 1 ? <text x={W - padR - 56} y={H - 6} font-size="11" fill="var(--text-2)">{dates[dates.length - 1]}</text> : null}
      </svg>
      <figcaption class="row wrap caption" style={{ gap: 'var(--s-3)' }}>
        {lines.map((l) => (
          <span key={l.label} class="row" style={{ gap: 'var(--s-1)' }}>
            <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke={TONE[l.tone ?? 'primary']} stroke-width="2" stroke-dasharray={l.dash} /></svg>
            {l.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
