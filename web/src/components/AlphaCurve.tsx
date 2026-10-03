/**
 * v3 M3-2／M5-4 事件時間累積超額曲線：進場後第 1～60 個交易日的平均累積超額與 95% 區間（日期分層 bootstrap）。
 * - 峰值日（▲）與 alpha 耗盡日（◆）用標記＋文字標示，不只靠顏色。
 * - 手指拖曳（或滑鼠移動、方向鍵）讀值：第 k 日、超額、95% 區間；垂直滑動仍可捲動頁面（touch-action: pan-y）。
 * - 沒有動畫（減少動態效果時也一樣）；寬度 100%，402px 不左右滑動。
 */
import { useRef, useState } from 'preact/hooks';
import { pctSigned } from '../lib/evidence';
import { type CurveLine, curveRead } from '../lib/curve';
import { missing } from '../lib/format';

/** 無障礙說明的峰值與耗盡句：沒有值時寫原因，不輸出「第 — 日」這種半句。 */
function peakText(peak: number | null | undefined): string {
  return peak ? `峰值第 ${peak} 日` : `峰值：${missing('曲線資料累積中')}`;
}
function exhaustText(exhaust: number | null | undefined): string {
  return exhaust ? `alpha 耗盡第 ${exhaust} 日` : '60 日內沒有 alpha 耗盡';
}

export function AlphaCurve({ line, label, n }: { line: CurveLine; label: string; n?: number }) {
  const W = 340, H = 200, padL = 40, padR = 10, padT = 22, padB = 24;
  const K = line.mean.length;
  const [k, setK] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const vals = [...line.mean, ...line.lo, ...line.hi].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!K || !vals.length) return <p class="caption muted">資料累積中：累積超額曲線需要至少 2 個進場日。</p>;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
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
  // 95% 帶：上緣由左到右、下緣由右到左
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
  // 標記文字（11px）的寬度估算：中文與符號約 11、數字約 6.2、其餘英文約 6、空白 3；用來畫文字底下的實心底色
  const textW = (s: string) => [...s].reduce((w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef\u25b2\u25c6]/.test(ch) ? 11 : /\d/.test(ch) ? 6.2 : ch === ' ' ? 3 : 6), 0);
  const mark = (day: number | null | undefined, shape: 'peak' | 'exhaust') => {
    if (!day || line.mean[day - 1] === null || line.mean[day - 1] === undefined) return null;
    const x = sx(day - 1), y = sy(line.mean[day - 1]!);
    const text = shape === 'peak' ? `▲ 峰值 第 ${day} 日` : `◆ alpha 耗盡 第 ${day} 日`;
    // 峰值標在點的上方、耗盡標在點的下方；都不超出圖的上下緣
    const ty = shape === 'peak' ? Math.max(12, y - 10) : Math.min(H - padB - 4, y + 18);
    const w = textW(text);
    // 文字起點：靠右的點改為向左寫（text-anchor end），並夾在圖的左右緣之內
    const anchor = x > W * 0.6 ? 'end' : 'start';
    const tx = anchor === 'end' ? Math.max(w + 2, x - 6) : Math.min(W - w - 2, x + 6);
    const bx = anchor === 'end' ? tx - w - 3 : tx - 3;
    return (
      <g key={shape} data-mark={shape}>
        {shape === 'peak'
          ? <path d={`M${x},${y - 7}L${x - 5},${y + 2}L${x + 5},${y + 2}Z`} fill="var(--text-1)" />
          : <path d={`M${x},${y - 5}L${x + 5},${y}L${x},${y + 5}L${x - 5},${y}Z`} fill="var(--surface-1)" stroke="var(--text-1)" stroke-width="1.5" />}
        {/* 文字底下墊一塊實心底色：標記落在 95% 灰帶上時，文字仍與帶子分得開 */}
        <rect x={bx} y={ty - 10.5} width={w + 6} height={14} rx={3} fill="var(--surface-1)" />
        <text x={tx} y={ty} font-size="11" text-anchor={anchor} fill="var(--text-1)">{text}</text>
      </g>
    );
  };
  return (
    <figure class="ac" style={{ margin: 0 }}>
      <svg
        ref={svgRef}
        class="ac-svg"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        tabindex={0}
        aria-label={`${label}累積超額曲線：第 10 日 ${pctSigned(line.mean[9] ?? null)}、${peakText(line.peak)}、${exhaustText(line.exhaust)}。可用方向鍵讀值。`}
        onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); at(e.clientX); }}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) at(e.clientX); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setK(null); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { setK(Math.min(K, (k ?? 0) + 1)); e.preventDefault(); }
          if (e.key === 'ArrowLeft') { setK(Math.max(1, (k ?? 2) - 1)); e.preventDefault(); }
        }}
      >
        {band ? <path d={band} fill="var(--surface-2)" stroke="none" /> : null}
        <line x1={padL} x2={W - padR} y1={sy(0)} y2={sy(0)} stroke="var(--line)" stroke-width="1" />
        {sy(0) - sy(hi) > 14 ? <text x={0} y={sy(hi) + 4} font-size="11" fill="var(--text-2)">{pctSigned(hi, 1)}</text> : null}
        <text x={0} y={sy(0) + 4} font-size="11" fill="var(--text-2)">0%</text>
        {lo < 0 && sy(lo) - sy(0) > 14 ? <text x={0} y={sy(lo)} font-size="11" fill="var(--text-2)">{pctSigned(lo, 1)}</text> : null}
        <path d={path(line.mean)} fill="none" stroke="var(--text-1)" stroke-width="2" stroke-linejoin="round" />
        {mark(line.peak, 'peak')}
        {mark(line.exhaust, 'exhaust')}
        {k !== null ? <line x1={sx(k - 1)} x2={sx(k - 1)} y1={padT} y2={H - padB} stroke="var(--brand)" stroke-width="1" /> : null}
        <text x={padL} y={H - 6} font-size="11" fill="var(--text-2)">第 1 日</text>
        <text x={W - padR} y={H - 6} font-size="11" text-anchor="end" fill="var(--text-2)">第 {K} 日</text>
      </svg>
      <figcaption class="caption ac-read" aria-live="polite">
        {read
          ? `第 ${read.k} 日：累積超額 ${pctSigned(read.mean)}（95% 區間 ${pctSigned(read.lo)}～${pctSigned(read.hi)}）`
          : `拖曳曲線讀值・灰帶為 95% 區間${n ? `・${n.toLocaleString('zh-TW')} 筆` : ''}`}
      </figcaption>
    </figure>
  );
}
