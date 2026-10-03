/**
 * v3 M2-3 權益曲線：策略組合與三種基準（加權報酬、0050、00631L），每週、以期初為 1。
 * 2026-10-02 健檢 M1-6：
 * - 圖例預設全開；缺值的線寫原因（不是只顯示「—」）。
 * - 第一次繪製就畫（線的開關依 series 重新同步，不會卡在上一套策略的狀態）。
 * - Y 軸上緣標「最高」、圖例標「期末」，兩個數字各自標示，不會被讀成同一個。
 * 線條用灰階＋虛線區分（不使用漲跌色、琥珀只給風險）。
 */
import { useEffect, useState } from 'preact/hooks';
import { MINUS, md } from '../lib/format';

export interface EquitySeries { key: string; label: string; values: (number | null)[]; /** 沒有值時的原因 */ missing?: string | null }

const STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  strategy: { stroke: 'var(--text-1)', width: 2 },
  '0050': { stroke: 'var(--text-2)', dash: '6 3', width: 1.6 },
  tr: { stroke: 'var(--text-3)', width: 1.4 },
  '00631L': { stroke: 'var(--text-3)', dash: '2 3', width: 1.6 },
};

/** 期初＝1 的倍數 → 累積報酬文字：1.1026 → +1,026%（四捨五入到整數）。 */
export function equityPct(v: number): string {
  const p = (v - 1) * 100;
  const s = Math.abs(p) >= 1000 ? Math.round(Math.abs(p)).toLocaleString('zh-TW') : Math.abs(p).toFixed(Math.abs(p) >= 100 ? 0 : 1);
  return `${p >= 0 ? '+' : MINUS}${s}%`;
}

const hasData = (s: EquitySeries) => s.values.some((v) => v !== null && Number.isFinite(v));

export function EquityChart({ dates, series, initial }: { dates: string[]; series: EquitySeries[]; initial?: string[] }) {
  const defaults = () => (initial ?? series.map((s) => s.key)).filter((k) => series.some((s) => s.key === k && hasData(s)));
  const [on, setOn] = useState<string[]>(defaults);
  // 換到另一套策略（series 改變）時重新同步開關，不留上一套的狀態
  const sig = series.map((s) => `${s.key}:${hasData(s) ? 1 : 0}`).join('|');
  useEffect(() => { setOn(defaults()); }, [sig]);
  const shown = series.filter((s) => on.includes(s.key) && hasData(s));
  const W = 340, H = 180, padL = 44, padR = 8, padT = 14, padB = 22;
  const vals = shown.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const lo = vals.length ? Math.min(...vals) : 0.9;
  const hi = vals.length ? Math.max(...vals) : 1.1;
  const sx = (i: number) => padL + (dates.length <= 1 ? 0.5 : i / (dates.length - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const last = (s: EquitySeries) => [...s.values].reverse().find((v): v is number => v !== null && Number.isFinite(v)) ?? null;
  const peakOf = (s: EquitySeries) => Math.max(...s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  return (
    <figure class="eq-chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`權益曲線（期初＝1）：${shown.map((s) => `${s.label} 期末 ${last(s) === null ? '無資料' : equityPct(last(s)!)}`).join('、')}`}>
        {vals.length ? (
          <>
            <text x={0} y={sy(hi) + 4} font-size="11" fill="var(--text-2)">最高 {equityPct(hi)}</text>
            <text x={0} y={sy(lo)} font-size="11" fill="var(--text-2)">{lo < 1 ? `最低 ${equityPct(lo)}` : equityPct(lo)}</text>
            {lo < 1 && hi > 1 ? <line x1={padL} x2={W - padR} y1={sy(1)} y2={sy(1)} stroke="var(--line)" stroke-width="1" /> : null}
          </>
        ) : <text x={padL} y={H / 2} font-size="11" fill="var(--text-2)">沒有可畫的序列</text>}
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
        {dates.length > 1 ? <text x={W - padR} y={H - 6} font-size="11" text-anchor="end" fill="var(--text-2)">{dates[dates.length - 1]}</text> : null}
      </svg>
      <figcaption class="eq-legend" role="group" aria-label="顯示的線（數字為期末累積報酬）">
        {series.map((s) => {
          const st = STYLE[s.key] ?? STYLE.tr;
          const ok = hasData(s);
          const pressed = ok && on.includes(s.key);
          const v = last(s);
          return (
            <button key={s.key} class="eq-pill" aria-pressed={pressed} disabled={!ok} title={ok ? `最高 ${equityPct(peakOf(s))}` : s.missing ?? '沒有資料'}
              onClick={() => setOn(pressed ? on.filter((k) => k !== s.key) : [...on, s.key])}>
              <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke={st.stroke} stroke-width="2" stroke-dasharray={st.dash} /></svg>
              {s.label} {v === null ? <span class="muted">—（{s.missing ?? '沒有資料'}）</span> : <>期末 {equityPct(v)}</>}
            </button>
          );
        })}
      </figcaption>
      <p class="caption muted eq-note">每週取樣、期初＝1；圖例為期末累積報酬，Y 軸上緣為期間最高；基準為同期持有不動（還原價、含息，不扣成本）。{dates.length ? `${md(dates[0])}（${dates[0].slice(0, 4)}）起` : ''}</p>
    </figure>
  );
}
