/**
 * 法人每日買賣超柱狀圖（2026-10-06，個股籌碼分頁「法人」區塊）。
 * - 一根一天、交易日等距（假日不留空格）；60 日時柱寬自動縮窄、間距一致。正值紅、負值綠，從 0 基準線往上／往下長。
 * - Y 軸依「目前區間＋目前法人」取整齊刻度，0 一定在範圍內；X 軸只標起訖日期。
 * - 選中資訊（日期、法人、數值、當日收盤與漲跌%）顯示在圖表上方的固定資訊列（不浮在圖上擋住柱子）。
 * - 點按或水平拖曳選某一天；放開後保留選取，點圖表空白處取消。touch-action: pan-y → 垂直捲動交給瀏覽器，
 *   只有水平拖曳會進來；事件只綁在這張圖上，不影響 K 線圖的雙指區間報酬手勢。
 * - 尚未公布的日子保留柱位，畫灰色短橫線佔位。
 * - 切換區間或法人：柱子以 spring（約 280ms）從基準線長到新高度、Y 軸刻度淡入淡出；prefers-reduced-motion 時直接到位。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { axisPos, linearAxis, type Axis } from '../../lib/axis';
import { fmtNum } from '../../lib/format';
import { reduceMotion } from '../kit';

export interface InstiBarDay {
  date: string;
  /** 張；null＝沒有資料 */
  value: number | null;
  /** 沒有資料時的狀態文字（「尚未公布」「尚未更新」）；有資料為 null */
  pending: string | null;
}

const H = 150;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const GUTTER = 44; // 右側刻度欄
const SPRING_MS = 280;

/** 臨界阻尼略低的彈簧：0 → 1，微幅過衝後回穩（t 為 0–1 的時間比例） */
export function springEase(t: number): number {
  if (t >= 1) return 1;
  return 1 - Math.exp(-6.5 * t) * Math.cos(7.5 * t);
}

const dfmt = (d: string) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function InstiBars({ days, animKey, selected, onSelect, info, label, testid }: {
  days: InstiBarDay[];
  /** 區間＋法人：改變時柱子重新從基準線長出 */
  animKey: string;
  selected: string | null;
  onSelect: (date: string | null) => void;
  /** 固定資訊列（上方）；i＝選中的索引或 null */
  info: (i: number | null) => ComponentChildren;
  label: string;
  testid?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(200, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  // 軸：目前區間＋目前法人；0 一定在範圍內
  const ax = useMemo<Axis>(() => linearAxis([0, ...days.map((d) => d.value).filter((v): v is number => v !== null)]), [days]);

  // spring：animKey 改變時 k 從 0 到 1
  const [k, setK] = useState(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduceMotion()) { setK(1); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / SPRING_MS);
      setK(springEase(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setK(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animKey]);

  // 刻度淡出：前一組刻度保留 220ms（淡出），新的淡入（CSS）
  const [oldTicks, setOldTicks] = useState<{ key: string; ticks: { v: number; y: number }[] } | null>(null);
  const prevAx = useRef<{ key: string; ax: Axis } | null>(null);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const yOf = (v: number, a: Axis) => PAD_TOP + (1 - axisPos(v, a)) * plotH;
  useEffect(() => {
    const p = prevAx.current;
    prevAx.current = { key: animKey, ax };
    if (!p || p.key === animKey || reduceMotion()) return;
    if (p.ax.lo === ax.lo && p.ax.hi === ax.hi) return;
    setOldTicks({ key: p.key, ticks: p.ax.ticks.map((v) => ({ v, y: yOf(v, p.ax) })) });
    const t = window.setTimeout(() => setOldTicks(null), 240);
    return () => clearTimeout(t);
  }, [animKey, ax]);

  const n = days.length;
  const pw = Math.max(120, w - GUTTER);
  const slot = pw / Math.max(1, n);
  // 柱寬：佔一格的 62%，最寬 18px、最窄 2px（60 日時自動縮窄、間距一致）
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const y = (v: number) => yOf(v, ax);
  const y0 = y(0);
  const selIdx = selected ? days.findIndex((d) => d.date === selected) : -1;
  const sel = selIdx >= 0 ? selIdx : null;

  // 手勢：pointerdown 記起點；水平拖曳超過 6px 進入拖曳選取；沒有移動就放開＝點按
  const g = useRef<{ x: number; y: number; id: number; drag: boolean } | null>(null);
  const local = (clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : null;
  };
  const idxAtX = (x: number) => Math.max(0, Math.min(n - 1, Math.floor(x / slot)));
  /** 點按：落在某根柱子（柱身上下 14px；基準線上下 20px，短柱與尚未公布的灰線也點得到）→ 選取；其餘（空白處、刻度欄）→ 取消 */
  const tapAt = (x: number, yy: number) => {
    if (x < 0 || x > pw || !n) { onSelect(null); return; }
    const i = idxAtX(x);
    const d = days[i];
    const v = d.value ?? 0;
    const top = Math.min(y(Math.max(0, v)) - 14, y0 - 20);
    const bottom = Math.max(y(Math.min(0, v)) + 14, y0 + 20);
    if (yy >= top && yy <= bottom) onSelect(d.date);
    else onSelect(null);
  };
  return (
    <div class="ib" data-testid={testid} role="group" aria-label={label}>
      <div class="ib-info" data-testid="ib-info" role="status" aria-live="polite">{info(sel)}</div>
      <div ref={wrapRef} class="ib-plot" style={{ height: `${H / 16}rem` }} tabIndex={0}
        aria-label={`${label}：點按或左右拖曳選一天，左右鍵逐日，Esc 取消`}
        onPointerDown={(e) => {
          const p = local(e.clientX, e.clientY);
          if (!p) return;
          g.current = { x: p.x, y: p.y, id: e.pointerId, drag: false };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s || s.id !== e.pointerId) return;
          const p = local(e.clientX, e.clientY);
          if (!p) return;
          if (!s.drag && Math.abs(p.x - s.x) > 6 && Math.abs(p.x - s.x) > Math.abs(p.y - s.y)) {
            s.drag = true;
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 不支援 */ }
          }
          if (s.drag) onSelect(days[idxAtX(p.x)]?.date ?? null);
        }}
        onPointerUp={(e) => {
          const s = g.current;
          g.current = null;
          if (!s || s.drag) return;
          const p = local(e.clientX, e.clientY);
          if (p) tapAt(p.x, p.y);
        }}
        onPointerCancel={() => { g.current = null; }}
        onKeyDown={(e) => {
          if (!n) return;
          if (e.key === 'ArrowLeft') { e.preventDefault(); onSelect(days[Math.max(0, (sel ?? n) - 1)].date); }
          if (e.key === 'ArrowRight') { e.preventDefault(); onSelect(days[Math.min(n - 1, (sel ?? -1) + 1)].date); }
          if (e.key === 'Escape') onSelect(null);
        }}>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
          {oldTicks ? (
            <g class="ib-grid ib-out" key={`o-${oldTicks.key}`}>
              {oldTicks.ticks.map((t) => <g key={t.v}><line x1={0} x2={pw} y1={t.y} y2={t.y} /><text x={w} y={t.y + 4} text-anchor="end">{fmtNum(t.v, 0)}</text></g>)}
            </g>
          ) : null}
          <g class="ib-grid ib-in" key={`n-${animKey}`}>
            {ax.ticks.map((t, i) => <g key={t}><line x1={0} x2={pw} y1={y(t)} y2={y(t)} /><text x={w} y={y(t) + 4} text-anchor="end">{fmtNum(t, 0)}{i === ax.ticks.length - 1 ? ' 張' : ''}</text></g>)}
          </g>
          {days.map((d, i) => {
            const x = slot * i + (slot - bw) / 2;
            const dim = sel !== null && sel !== i;
            if (d.value === null) {
              return <rect key={d.date} class={`ib-pending${dim ? ' dim' : ''}${sel === i ? ' on' : ''}`} x={x} y={y0 - 1} width={bw} height={2} rx={1} />;
            }
            const v = d.value * k;
            const top = Math.min(y(Math.max(0, v)), y0);
            const h = Math.max(d.value === 0 ? 0 : 1, Math.abs(y(v) - y0));
            return <rect key={d.date} class={`ib-bar ${d.value >= 0 ? 'up' : 'down'}${dim ? ' dim' : ''}${sel === i ? ' on' : ''}`} x={x} y={top} width={bw} height={h} rx={Math.min(1.5, bw / 3)} />;
          })}
          <line class="ib-zero" x1={0} x2={pw} y1={y0} y2={y0} />
          {n >= 1 ? (
            <g class="ib-dates">
              <text x={0} y={H - 6}>{dfmt(days[0].date)}</text>
              {n >= 2 ? <text x={pw} y={H - 6} text-anchor="end">{dfmt(days[n - 1].date)}</text> : null}
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
