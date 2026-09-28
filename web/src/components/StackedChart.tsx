/**
 * 共用日期軸的小倍數圖（small multiples）：每個面板只有一個 y 軸（不做雙軸），面板上下對齊同一組日期。
 * - 面板種類：bars（有正負的柱狀：紅＝正／買超、綠＝負／賣超）、lines（一條或多條線；多條時以實線／虛線區分，
 *   面板標題列右側有圖例，不靠顏色辨識）。
 * - 座標軸刻度取整（1、2、2.5、5 × 10ⁿ）；柱狀圖上下對稱、以 0 為中線。
 * - 互動：手指拖曳、滑鼠移動或左右方向鍵移動十字線，上方提示框列出該日所有面板的數值；Esc／移開恢復。
 * - 無障礙：整張圖是一個可聚焦的 role=img，說明文字含期間與各面板名稱；逐日數值請看下方的表格。
 * - 資料不足：前後都缺值的孤立點（含整張只有 1 點）畫成單點標記，只有 1 點時在下方標出日期；說明文字由頁面提供。
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { niceScale } from '../lib/scale';
import { segments } from '../lib/series';
import { dirClass } from '../lib/format';

export interface ChartSeries {
  key: string;
  label: string;
  values: (number | null)[];
  /** 線條樣式（lines 面板）：solid＝主要、dashed＝次要、faint＝背景參考 */
  style?: 'solid' | 'dashed' | 'faint';
}

export interface ChartPanel {
  id: string;
  /** 面板標題（含單位），例「每日買賣超（張）」 */
  title: string;
  kind: 'bars' | 'lines';
  series: ChartSeries[];
  height: number;
  /** 座標軸與提示框的數值格式（不含單位） */
  format: (v: number) => string;
  /** 提示框的數值格式（可含正負號與單位）；預設同 format */
  tipFormat?: (v: number) => string;
  /** 固定 y 範圍（例：0–100%）；預設依資料 */
  domain?: [number, number];
  /** lines 面板的 y 範圍一定包含 0（例：買張、累計買賣超） */
  zero?: boolean;
}

const AXIS_W = 44; // 左側座標軸寬度
const PAD_R = 8;
const GAP = 34; // 面板之間：標題列＋間距

function monthTicks(dates: string[]): { i: number; label: string }[] {
  const out: { i: number; label: string }[] = [];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(5, 7) !== dates[i - 1].slice(5, 7)) out.push({ i, label: `${Number(dates[i].slice(5, 7))}月` });
  }
  return out;
}

export function StackedChart({ dates, panels, label }: { dates: string[]; panels: ChartPanel[]; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(220, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(220, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  if (!n) return null;
  const plotW = w - AXIS_W - PAD_R;
  const step = plotW / n;
  const xOf = (i: number) => AXIS_W + step * (i + 0.5);
  const tops: number[] = [];
  let y = 0;
  for (const p of panels) { tops.push(y + GAP); y += GAP + p.height; }
  const totalH = y + 20;

  const idxAt = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    const i = Math.floor((clientX - r.left - AXIS_W) / step);
    return Math.max(0, Math.min(n - 1, i));
  };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.buttons || e.type === 'pointerdown') setHover(idxAt(e.clientX));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = hover ?? n;
      setHover(Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setHover(null);
  };

  const months = monthTicks(dates);
  return (
    <figure class="stacked">
      <div ref={wrapRef} class="stacked-plot" tabIndex={0} role="img"
        aria-label={`${label}：${dates[0]} 到 ${dates[n - 1]}，共 ${n} 個資料點；面板：${panels.map((p) => p.title).join('、')}。可用左右方向鍵逐日查看，逐日數值見下方表格。`}
        onPointerDown={onPointer} onPointerMove={onPointer} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}
        onKeyDown={onKey} onBlur={() => setHover(null)}>
        <svg width={w} height={totalH} viewBox={`0 0 ${w} ${totalH}`} aria-hidden="true">
          {panels.map((p, pi) => {
            const top = tops[pi];
            const all = p.series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
            const { lo, hi, ticks } = niceScale(all, p.kind, { fixed: p.domain, zero: p.zero });
            const yOf = (v: number) => top + p.height - ((v - lo) / (hi - lo || 1)) * p.height;
            return (
              <g key={p.id}>
                <text class="sc-title" x={AXIS_W} y={top - 12}>{p.title}</text>
                {p.series.length > 1 ? (
                  // 圖例：標題列右側，以線條樣式區分（由右往左排）
                  <g class="sc-legend">
                    {p.series.slice().reverse().map((s, k) => {
                      const right = w - PAD_R - k * 62;
                      return (
                        <g key={s.key}>
                          <line class={`sc-line ${s.style ?? 'solid'}`} x1={right - 56} x2={right - 36} y1={top - 16} y2={top - 16} />
                          <text class="sc-legend-text" x={right - 32} y={top - 12}>{s.label}</text>
                        </g>
                      );
                    })}
                  </g>
                ) : null}
                {ticks.map((t) => (
                  <g key={t}>
                    <line class={t === 0 ? 'sc-zero' : 'sc-grid'} x1={AXIS_W} x2={w - PAD_R} y1={yOf(t)} y2={yOf(t)} />
                    <text class="sc-tick" x={AXIS_W - 4} y={yOf(t) + 3.5} text-anchor="end">{p.format(t)}</text>
                  </g>
                ))}
                {p.kind === 'bars' ? p.series[0].values.map((v, i) => {
                  if (v === null || !Number.isFinite(v) || v === 0) return null;
                  const bw = Math.max(1.5, Math.min(10, step * 0.66));
                  const y0 = yOf(0);
                  const y1 = yOf(v);
                  return <rect key={i} class={v > 0 ? 'sc-up' : 'sc-down'} x={xOf(i) - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} rx={Math.min(2, bw / 2)}
                    opacity={hover === null || hover === i ? 1 : 0.45} />;
                }) : p.series.map((s) => {
                  const seg = segments(s.values);
                  const d = seg.runs.map((run) => run.map((i, k) => `${k ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(s.values[i]!).toFixed(1)}`).join('')).join('');
                  return (
                    <g key={s.key}>
                      {d ? <path class={`sc-line ${s.style ?? 'solid'}`} d={d} /> : null}
                      {seg.singles.map((i) => <circle key={i} class={`sc-point ${s.style ?? 'solid'}`} cx={xOf(i)} cy={yOf(s.values[i]!)} r={3.5} data-testid="sc-point" />)}
                    </g>
                  );
                })}
                {hover !== null && p.kind === 'lines'
                  ? p.series.map((s) => s.values[hover]).filter((v): v is number => v !== null && Number.isFinite(v))
                    .map((v, k) => <circle key={k} class="sc-dot" cx={xOf(hover)} cy={yOf(v)} r={4} />)
                  : null}
              </g>
            );
          })}
          {hover !== null ? <line class="sc-cross" x1={xOf(hover)} x2={xOf(hover)} y1={tops[0] - 4} y2={y} /> : null}
          {months.map((t) => <text key={t.i} class="sc-tick" x={AXIS_W + step * t.i} y={y + 16} text-anchor="middle">{t.label}</text>)}
          {n === 1 ? <text class="sc-tick" x={xOf(0)} y={y + 16} text-anchor="middle">{`${Number(dates[0].slice(5, 7))}/${Number(dates[0].slice(8, 10))}`}</text> : null}
        </svg>
        {hover !== null ? (
          <div class={`sc-tip ${xOf(hover) > w / 2 ? 'left' : ''}`} style={{ left: `${xOf(hover)}px` }}>
            <span class="caption muted">{dates[hover]}</span>
            {panels.flatMap((p) => p.series.map((s) => {
              const v = s.values[hover];
              const f = p.tipFormat ?? p.format;
              return (
                <span key={`${p.id}-${s.key}`} class="sc-tip-row">
                  <span class="muted">{s.label}</span>
                  <span class={`num ${p.kind === 'bars' ? dirClass(v) : ''}`}>{v === null || !Number.isFinite(v) ? '—' : f(v)}</span>
                </span>
              );
            }))}
          </div>
        ) : null}
      </div>
      {/* 鍵盤逐日移動時，讀出該日各面板的數值（圖本身是 role=img） */}
      <p class="sr-only" aria-live="polite">
        {hover !== null ? `${dates[hover]}：${panels.flatMap((p) => p.series.map((s) => { const v = s.values[hover]; return `${s.label} ${v === null || !Number.isFinite(v) ? '沒有資料' : (p.tipFormat ?? p.format)(v)}`; })).join('，')}` : ''}
      </p>
    </figure>
  );
}
