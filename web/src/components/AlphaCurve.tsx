/**
 * 事件時間累積超額曲線（2026-10-03）：進場後第 1～120 個交易日的平均累積超額與 95% 區間（日期分層 bootstrap）。
 * - Y 軸依資料範圍自動縮放、整數刻度（%），軸標在左側刻度區、不壓線；圖的左右緣對齊卡片內容緣。
 * - 峰值日用 ▲ 標記＋文字；峰值落在觀察窗右邊界時文字改為「峰值在觀察窗邊界」。
 * - 拖曳（或方向鍵）讀值；沒有動畫。
 */
import { useRef, useState } from 'preact/hooks';
import { type CurveLine, EDGE_TEXT, curveRead, intTicks, peakAtEdge } from '../lib/curve';
import { missing, pctSigned } from '../lib/format';

export function AlphaCurve({ line, label, n }: { line: CurveLine; label: string; n?: number }) {
  const W = 338, H = 196, padL = 36, padR = 4, padT = 20, padB = 20;
  const K = line.mean.length;
  const [k, setK] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const vals = [...line.mean, ...line.lo, ...line.hi].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!K || !vals.length) return <p class="ui-foot ui-muted">資料累積中：累積超額曲線需要至少 2 個進場日。</p>;
  const ticks = intTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const sx = (i: number) => padL + (K <= 1 ? 0.5 : i / (K - 1)) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const path = (arr: (number | null)[]) => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const band = (() => {
    const up = line.hi.map((v, i) => (v === null ? null : `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)).filter(Boolean);
    const dn = line.lo.map((v, i) => (v === null ? null : `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)).filter(Boolean).reverse();
    return up.length && dn.length ? `M${up.join('L')}L${dn.join('L')}Z` : '';
  })();
  const at = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((x - padL) / (W - padL - padR)) * (K - 1));
    setK(Math.max(1, Math.min(K, i + 1)));
  };
  const read = k === null ? null : curveRead(line, k);
  const edge = peakAtEdge(line);
  const peak = line.peak && line.mean[line.peak - 1] !== null && line.mean[line.peak - 1] !== undefined ? line.peak : null;
  const peakText = peak ? (edge ? `▲ ${EDGE_TEXT}` : `▲ 峰值 第 ${peak} 日`) : null;
  const xTicks = [1, 20, 40, 60, 80, 100, 120].filter((d) => d <= K);
  return (
    <figure class="chart-wrap st-chart" style={{ margin: 0 }}>
      <svg
        ref={svgRef}
        class="ac-svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        tabindex={0}
        aria-label={`${label}累積超額曲線：第 40 日 ${pctSigned(line.mean[39] ?? null)}、${peak ? `峰值第 ${peak} 日${edge ? `（${EDGE_TEXT}）` : ''}` : `峰值：${missing('曲線資料累積中')}`}。可用方向鍵讀值。`}
        onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); at(e.clientX); }}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) at(e.clientX); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setK(null); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { setK(Math.min(K, (k ?? 0) + 1)); e.preventDefault(); }
          if (e.key === 'ArrowLeft') { setK(Math.max(1, (k ?? 2) - 1)); e.preventDefault(); }
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} stroke="var(--line)" stroke-width={t === 0 ? 1 : 0.5} />
            <text x={padL - 6} y={sy(t) + 4} font-size="12" text-anchor="end" fill="var(--text-2)">{t > 0 ? `+${t}` : t < 0 ? `−${Math.abs(t)}` : '0'}%</text>
          </g>
        ))}
        {band ? <path d={band} fill="var(--surface-2)" stroke="none" opacity="0.9" /> : null}
        <path d={path(line.mean)} fill="none" stroke="var(--text-1)" stroke-width="2" stroke-linejoin="round" />
        {peak && peakText ? (() => {
          const x = sx(peak - 1), y = sy(line.mean[peak - 1]!);
          const anchor = x > W * 0.6 ? 'end' : 'start';
          const tx = anchor === 'end' ? x - 8 : x + 8;
          const ty = Math.max(12, y - 8);
          return (
            <g data-mark="peak">
              <path d={`M${x},${y - 7}L${x - 5},${y + 2}L${x + 5},${y + 2}Z`} fill="var(--text-1)" />
              <text x={tx} y={ty} font-size="12" text-anchor={anchor} fill="var(--text-1)" paint-order="stroke" stroke="var(--surface-1)" stroke-width="4">{peakText}</text>
            </g>
          );
        })() : null}
        {k !== null ? <line x1={sx(k - 1)} x2={sx(k - 1)} y1={padT} y2={H - padB} stroke="var(--text-2)" stroke-width="1" /> : null}
        {xTicks.map((d) => (
          <text key={d} x={sx(d - 1)} y={H - 4} font-size="12" text-anchor={d === 1 ? 'start' : d === K ? 'end' : 'middle'} fill="var(--text-2)">{d}</text>
        ))}
      </svg>
      <figcaption class="ui-foot ui-muted st-read ac-read" aria-live="polite">
        {read
          ? `第 ${read.k} 日 ${pctSigned(read.mean)}（95% 區間 ${pctSigned(read.lo)}～${pctSigned(read.hi)}）`
          : `X 軸＝進場後交易日・灰帶＝95% 區間${n ? `・${n.toLocaleString('zh-TW')} 筆` : ''}`}
      </figcaption>
    </figure>
  );
}
