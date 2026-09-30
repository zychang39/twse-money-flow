/**
 * v3 M2-3 權益曲線：策略（5 檔組合）與三種基準（加權報酬、0050、00631L），每週、以期初為 1。
 * 預設顯示策略與 0050，其他以下方的切換鈕加入；線條用灰階＋虛線區分（不使用漲跌色、琥珀只給風險）。
 */
import { useState } from 'preact/hooks';

export interface EquitySeries { key: string; label: string; values: (number | null)[] }

const STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  strategy: { stroke: 'var(--text-1)', width: 2 },
  '0050': { stroke: 'var(--text-2)', dash: '6 3', width: 1.6 },
  tr: { stroke: 'var(--text-3)', width: 1.4 },
  '00631L': { stroke: 'var(--text-3)', dash: '2 3', width: 1.6 },
};

export function EquityChart({ dates, series, initial = ['strategy', '0050'] }: { dates: string[]; series: EquitySeries[]; initial?: string[] }) {
  const [on, setOn] = useState<string[]>(initial.filter((k) => series.some((s) => s.key === k)));
  const shown = series.filter((s) => on.includes(s.key));
  const W = 340, H = 180, padL = 36, padR = 8, padT = 8, padB = 22;
  const vals = shown.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const lo = vals.length ? Math.min(...vals) : 0.9;
  const hi = vals.length ? Math.max(...vals) : 1.1;
  const sx = (i: number) => padL + (dates.length <= 1 ? 0.5 : i / (dates.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const fmt = (v: number) => `${v >= 1 ? '+' : '−'}${Math.abs((v - 1) * 100).toFixed(0)}%`;
  const last = (s: EquitySeries) => [...s.values].reverse().find((v): v is number => v !== null && Number.isFinite(v)) ?? null;
  return (
    <figure class="eq-chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`權益曲線：${shown.map((s) => `${s.label} ${last(s) === null ? '—' : fmt(last(s)!)}`).join('、')}`}>
        {vals.length ? (
          <>
            <text x={0} y={sy(hi) + 4} font-size="11" fill="var(--text-2)">{fmt(hi)}</text>
            <text x={0} y={sy(lo)} font-size="11" fill="var(--text-2)">{fmt(lo)}</text>
            {lo < 1 && hi > 1 ? <line x1={padL} x2={W - padR} y1={sy(1)} y2={sy(1)} stroke="var(--line)" stroke-width="1" /> : null}
          </>
        ) : null}
        {shown.map((s) => {
          const st = STYLE[s.key] ?? STYLE.tr;
          let d = '';
          let pen = false;
          s.values.forEach((v, i) => {
            if (v === null || !Number.isFinite(v)) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
            pen = true;
          });
          return <path key={s.key} d={d} fill="none" stroke={st.stroke} stroke-width={st.width} stroke-dasharray={st.dash} stroke-linejoin="round" />;
        })}
        {dates.length ? <text x={padL} y={H - 6} font-size="11" fill="var(--text-2)">{dates[0]}</text> : null}
        {dates.length > 1 ? <text x={W - padR - 56} y={H - 6} font-size="11" fill="var(--text-2)">{dates[dates.length - 1]}</text> : null}
      </svg>
      <figcaption class="eq-legend" role="group" aria-label="顯示的線">
        {series.map((s) => {
          const st = STYLE[s.key] ?? STYLE.tr;
          const pressed = on.includes(s.key);
          const v = last(s);
          return (
            <button key={s.key} class="eq-pill" aria-pressed={pressed} onClick={() => setOn(pressed ? on.filter((k) => k !== s.key) : [...on, s.key])}>
              <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke={st.stroke} stroke-width="2" stroke-dasharray={st.dash} /></svg>
              {s.label} {v === null ? '—' : fmt(v)}
            </button>
          );
        })}
      </figcaption>
    </figure>
  );
}
