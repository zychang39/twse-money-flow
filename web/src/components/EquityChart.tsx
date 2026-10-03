/**
 * 組合回測的權益曲線（2026-10-03）：每週取樣、期初＝1、Y 軸對數（刻度＝累積報酬整數百分比，2 的次方倍）。
 * - 策略線：主文字色實線加粗；基準線：灰色（以虛線樣式區分），00631L 預設隱藏。
 * - 圖例＝一行可切換的勾選列（checkbox），不是按鈕；缺資料的線停用並在 title 寫原因。
 * - 圖的左右緣對齊卡片內容緣；沒有動畫。
 */
import { useEffect, useState } from 'preact/hooks';
import { MINUS } from '../lib/format';
import { logTicks } from '../lib/curve';

export interface EquitySeries { key: string; label: string; values: (number | null)[]; /** 沒有值時的原因 */ missing?: string | null }

const STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  strategy: { stroke: 'var(--text-1)', width: 2.5 },
  '0050': { stroke: 'var(--text-2)', width: 1.5 },
  tr: { stroke: 'var(--text-2)', dash: '6 3', width: 1.5 },
  '00631L': { stroke: 'var(--text-2)', dash: '2 3', width: 1.5 },
};

/** 期初＝1 的倍數 → 累積報酬文字：1.1026 → +10.3%、4 → +300%。 */
export function equityPct(v: number): string {
  const p = (v - 1) * 100;
  const s = Math.abs(p) >= 1000 ? Math.round(Math.abs(p)).toLocaleString('zh-TW') : Math.abs(p).toFixed(Math.abs(p) >= 100 || Number.isInteger(p) ? 0 : 1);
  return `${p > 0 ? '+' : p < 0 ? MINUS : ''}${s}%`;
}

const hasData = (s: EquitySeries) => s.values.some((v) => v !== null && Number.isFinite(v) && v > 0);

export function EquityChart({ dates, series, hidden = ['00631L'] }: { dates: string[]; series: EquitySeries[]; hidden?: string[] }) {
  const defaults = () => series.filter((s) => hasData(s) && !hidden.includes(s.key)).map((s) => s.key);
  const [on, setOn] = useState<string[]>(defaults);
  const sig = series.map((s) => `${s.key}:${hasData(s) ? 1 : 0}`).join('|');
  useEffect(() => { setOn(defaults()); }, [sig]);
  const shown = series.filter((s) => on.includes(s.key) && hasData(s));
  const W = 338, H = 196, padL = 48, padR = 4, padT = 8, padB = 20;
  const vals = shown.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0));
  const ticks = vals.length ? logTicks(Math.min(...vals), Math.max(...vals)) : [1, 2];
  const lo = Math.log(ticks[0]), hi = Math.log(ticks[ticks.length - 1]);
  const sx = (i: number) => padL + (dates.length <= 1 ? 0.5 : i / (dates.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (Math.log(v) - lo) / (hi - lo || 1)) * (H - padT - padB);
  const last = (s: EquitySeries) => [...s.values].reverse().find((v): v is number => v !== null && Number.isFinite(v)) ?? null;
  const y0 = dates[0]?.slice(0, 4), y1 = dates[dates.length - 1]?.slice(0, 4);
  return (
    <figure class="st-eq" style={{ margin: 0 }}>
      <div class="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label={`權益曲線（對數、期初＝1）：${shown.map((s) => `${s.label} 期末 ${last(s) === null ? '無資料' : equityPct(last(s)!)}`).join('、')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke="var(--line)" stroke-width={t === 1 ? 1 : 0.5} />
              <text x={padL - 6} y={sy(t) + 4} font-size="12" text-anchor="end" fill="var(--text-2)">{equityPct(t)}</text>
            </g>
          ))}
          {[...shown].sort((a, b) => (a.key === 'strategy' ? 1 : 0) - (b.key === 'strategy' ? 1 : 0)).map((s) => {
            const st = STYLE[s.key] ?? STYLE.tr;
            let d = '';
            let pen = false;
            s.values.forEach((v, i) => {
              if (v === null || !Number.isFinite(v) || v <= 0) { pen = false; return; }
              d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
              pen = true;
            });
            return <path key={s.key} d={d} fill="none" stroke={st.stroke} stroke-width={st.width} stroke-dasharray={st.dash} stroke-linejoin="round" />;
          })}
          {y0 ? <text x={padL} y={H - 4} font-size="12" fill="var(--text-2)">{y0}</text> : null}
          {y1 && y1 !== y0 ? <text x={W - padR} y={H - 4} font-size="12" text-anchor="end" fill="var(--text-2)">{y1}</text> : null}
        </svg>
      </div>
      <figcaption class="st-legend" role="group" aria-label="顯示的線">
        {series.map((s) => {
          const st = STYLE[s.key] ?? STYLE.tr;
          const ok = hasData(s);
          const checked = ok && on.includes(s.key);
          return (
            <label key={s.key} class="st-legend-item" title={ok ? undefined : s.missing ?? '沒有資料'}>
              <input type="checkbox" checked={checked} disabled={!ok}
                onChange={() => setOn(checked ? on.filter((k) => k !== s.key) : [...on, s.key])} />
              <svg width="12" height="8" aria-hidden="true"><line x1="0" x2="12" y1="4" y2="4" stroke={st.stroke} stroke-width={Math.min(st.width, 2.5)} stroke-dasharray={st.dash} /></svg>
              <span>{s.label}</span>
            </label>
          );
        })}
      </figcaption>
    </figure>
  );
}
