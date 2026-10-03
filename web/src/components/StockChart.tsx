/**
 * 個股頁走勢圖（SPEC §5.2、§5.4，stock 2026-10）：主角價格（Title2）＋當日漲跌＋所選區間漲跌一行＋圖＋區間 8 格。
 * - 1M 以上：日 K（或週 K）＋ 20／60 日均線＋下方成交量；可切換折線（頁面 ⋯ 選單）。1D／1W：5 分 K 收盤折線＋成交量＋前收虛線。
 * - Y 軸依資料範圍自動縮放、整數刻度，標籤在圖右側的軸欄（不壓線）；X 軸只標起訖日期。
 * - 手勢：觸控長按（0.3 秒）顯示十字線讀值（開高低收、量），手指移動跟著走；兩指＝區間報酬（兩點的漲跌與報酬率）。
 *   滑鼠：移動＝十字線；按住拖曳＝區間報酬。鍵盤：左右鍵逐根、Esc 恢復。放開後區間結果保留 2 秒再淡出。
 * - prefers-reduced-motion：不做任何動畫（本元件本來就沒有路徑變形動畫）。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Period } from '../lib/periods';
import { PERIOD_LABEL } from '../lib/periods';
import { type ChartSeries, barChange, niceTicks, periodChangeAt, priceExtent } from '../lib/stockChart';
import { RANGE_HOLD_MS, countDatesBetween, rangeReturn, shortDate } from '../lib/rangeReturn';
import { fmtLotsUnit, fmtPrice, numberFormat } from '../lib/format';
import { Seg, Signed } from './ui';

const PRICE_H = 192;
const GAP = 8;
const VOL_H = 40;
const DATE_H = 16;
const AXIS_W = 44;
const LONG_PRESS_MS = 300;
const SLOP = 8;
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 價差的小數位數依價位（升降單位）：50 元以下 2 位、500 元以下 1 位、以上整數。 */
export function priceDigits(p: number): number {
  return p < 50 ? 2 : p < 500 ? 1 : 0;
}

function label(t: string): string {
  if (t.length > 10) return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
  return `${Number(t.slice(0, 4))}/${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}`;
}
function axisLabel(t: string, intraday: boolean): string {
  return intraday && t.length > 10 ? `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}` : shortDate(t.slice(0, 10));
}

export function StockChart({ series, candle, period, onPeriod, periods, adjLabel, footnote, emptyText = '資料累積中', loading = false, today }: {
  series: ChartSeries | null;
  /** K 線（true）或折線 */
  candle: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  periods: Period[];
  /** 顯示「還原」字樣（只在還原價與原始價不同時） */
  adjLabel?: boolean;
  footnote?: ComponentChildren;
  emptyText?: string;
  loading?: boolean;
  /** 未查價時的「當日漲跌」（個股檔日資料；週 K、長歷史的相鄰兩點不是一天） */
  today?: { abs: number; pct: number | null; date: string } | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(370);
  const [scrub, setScrub] = useState<number | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number; live: boolean; fading: boolean } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const touches = useRef(new Map<number, number>());
  const press = useRef<{ id: number; x: number; y: number; timer: number; active: boolean } | null>(null);
  const mouse = useRef<{ a: number; moved: boolean } | null>(null);
  const timers = useRef<number[]>([]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(200, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setScrub(null); setSel(null); }, [series]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const n = series?.bars.length ?? 0;
  const plotW = w - AXIS_W;
  const showVol = !!series?.hasVolume;
  const svgH = PRICE_H + (showVol ? GAP + VOL_H : 0) + DATE_H;
  const useCandle = candle && !!series?.ohlc && series.kind !== 'intraday';
  const geo = useMemo(() => {
    if (!series || !n) return null;
    const [lo0, hi0] = priceExtent(series, useCandle);
    const pad = (hi0 - lo0) * 0.06;
    const lo = lo0 - pad, hi = hi0 + pad;
    const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (PRICE_H - 8);
    const slot = plotW / n;
    const x = (i: number) => (i + 0.5) * slot;
    let vmax = 0;
    for (const b of series.bars) if (b.v !== null && b.v > vmax) vmax = b.v;
    const ticks = niceTicks(lo0, hi0, 3).filter((t) => t >= lo && t <= hi);
    return { lo, hi, y, x, slot, vmax, ticks };
  }, [series, w, useCandle]);

  const last = n - 1;
  const at = scrub ?? last;
  const bar = series && n ? series.bars[at] : null;
  const dayChg = scrub === null && today && series?.kind !== 'intraday' ? today : series && n ? barChange(series, at) : null;
  const perChg = series && n ? periodChangeAt(series, at) : null;
  const intraday = series?.kind === 'intraday';
  const lineDir = series && n ? (series.bars[last].c > series.base ? 'up' : series.bars[last].c < series.base ? 'down' : 'flat') : 'flat';
  const lineColor = lineDir === 'up' ? 'var(--up)' : lineDir === 'down' ? 'var(--down)' : 'var(--text-2)';

  // ---------- 手勢
  const idxAt = (clientX: number): number | null => {
    const el = wrapRef.current;
    if (!el || !n) return null;
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * w;
    return Math.max(0, Math.min(n - 1, Math.floor(px / (plotW / n))));
  };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const live = (a: number | null, b: number | null) => { if (a === null || b === null) return; clearTimers(); setScrub(null); setSel({ a, b, live: true, fading: false }); };
  const release = () => {
    if (!selRef.current) return;
    setSel((s) => (s ? { ...s, live: false } : s));
    clearTimers();
    timers.current.push(window.setTimeout(() => {
      if (reduceMotion()) { setSel(null); return; }
      setSel((s) => (s && !s.live ? { ...s, fading: true } : s));
      timers.current.push(window.setTimeout(() => setSel((s) => (s && !s.live ? null : s)), 320));
    }, RANGE_HOLD_MS));
  };
  const cancelPress = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if ((press.current?.active || e.touches.length >= 2 || selRef.current?.live) && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const onDown = (e: PointerEvent) => {
    if (!n) return;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) mouse.current = { a: idxAt(e.clientX) ?? 0, moved: false };
      return;
    }
    touches.current.set(e.pointerId, e.clientX);
    const target = e.currentTarget as HTMLElement;
    if (touches.current.size >= 2) {
      cancelPress();
      for (const id of touches.current.keys()) { try { target.setPointerCapture(id); } catch { /* 手指已離開 */ } }
      const xs = [...touches.current.values()];
      live(idxAt(xs[0]), idxAt(xs[1]));
      return;
    }
    cancelPress();
    const id = e.pointerId;
    const x = e.clientX;
    press.current = {
      id, x, y: e.clientY, active: false,
      timer: window.setTimeout(() => {
        if (!press.current || press.current.id !== id) return;
        press.current.active = true;
        try { target.setPointerCapture(id); } catch { /* 手指已離開 */ }
        if (navigator.vibrate) navigator.vibrate(8);
        setScrub(idxAt(x));
      }, LONG_PRESS_MS),
    };
  };
  const onMove = (e: PointerEvent) => {
    if (!n) return;
    if (e.pointerType === 'mouse') {
      const m = mouse.current;
      if (m && e.buttons & 1) {
        const b = idxAt(e.clientX);
        if (b !== null && (m.moved || b !== m.a)) { m.moved = true; live(m.a, b); }
        return;
      }
      if (!selRef.current?.live) setScrub(idxAt(e.clientX));
      return;
    }
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, e.clientX);
    if (touches.current.size >= 2) {
      const xs = [...touches.current.values()];
      live(idxAt(xs[0]), idxAt(xs[1]));
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.active) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancelPress();
      return;
    }
    setScrub(idxAt(e.clientX));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      const m = mouse.current;
      mouse.current = null;
      if (m?.moved) release();
      return;
    }
    touches.current.delete(e.pointerId);
    if (selRef.current?.live && touches.current.size < 2) release();
    if (press.current?.id === e.pointerId) { cancelPress(); setScrub(null); }
  };
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (mouse.current?.moved) { mouse.current = null; release(); }
    setScrub(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setScrub(Math.max(0, Math.min(last, (scrub ?? last) + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape' || e.key === 'Enter') setScrub(null);
  };

  const rr = sel && series ? rangeReturn(series.bars.map((b) => b.t), series.bars.map((b) => b.c), sel.a, sel.b,
    (a, b) => countDatesBetween([...new Set(series.bars.map((x) => x.t.slice(0, 10)))], a.slice(0, 10), b.slice(0, 10)) || 0) : null;

  // ---------- 繪圖
  const priceText = bar ? fmtPrice(bar.c) : '—';
  const volTop = PRICE_H + GAP;
  const dateY = svgH - 4;
  const summary = series && n ? `${PERIOD_LABEL[period]}走勢：${label(series.bars[0].t)}到${label(series.bars[last].t)}，最新 ${fmtPrice(series.bars[last].c)}` : emptyText;
  return (
    <div class="sc">
      <div class="sc-price-row">
        <span class="sc-price" aria-live="off" data-testid="stock-price">{priceText}</span>
        {adjLabel ? <span class="ui-foot ui-muted" data-testid="basis-tag">還原</span> : null}
      </div>
      <p class="sc-line ui-foot" data-testid="hero-change">
        {dayChg ? <Signed v={dayChg.abs} digits={priceDigits(bar?.c ?? 0)} kind="arrow" /> : <span>—</span>}
        {dayChg && dayChg.pct !== null ? <Signed v={dayChg.pct} digits={2} unit="%" kind="sign" /> : null}
        <span class="ui-muted" data-testid="hero-change-date">{scrub === null && today && series?.kind !== 'intraday' ? label(today.date) : bar ? label(bar.t) : ''}</span>
      </p>
      <p class="sc-line ui-foot" data-testid="hero-period-change">
        <span class="ui-muted">{period}{scrub !== null && bar ? ` 至 ${axisLabel(bar.t, intraday)}` : ''}</span>
        {perChg && perChg.pct !== null ? <Signed v={perChg.pct} digits={2} unit="%" kind="sign" /> : <span>—</span>}
      </p>
      <div ref={wrapRef} class="sc-wrap chart-wrap" style={{ height: `${svgH / 16}rem` }} tabIndex={n ? 0 : -1} role="img"
        aria-label={`${summary}。長按或用左右鍵查看每根的開高低收。`} data-points={n} data-from={series?.bars[0]?.t}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} onKeyDown={onKey} onBlur={() => setScrub(null)}>
        {series && geo && n ? (
          <svg viewBox={`0 0 ${w} ${svgH}`} width={w} height={svgH} aria-hidden="true" class="sc-svg">
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={geo.y(t)} y2={geo.y(t)} class="sc-grid" />
                <text x={w} y={geo.y(t) + 4} text-anchor="end" class="sc-axis">{numberFormat(0).format(t)}</text>
              </g>
            ))}
            {series.dayStarts.slice(1).map((i) => <line key={i} x1={i * geo.slot} x2={i * geo.slot} y1={0} y2={PRICE_H} class="sc-grid" />)}
            {series.baseLine ? <line x1={0} x2={plotW} y1={geo.y(series.base)} y2={geo.y(series.base)} class="sc-base" data-testid="prev-close-line" /> : null}
            {useCandle ? series.bars.map((b, i) => {
              const o = b.o ?? b.prev ?? b.c, hi = b.h ?? Math.max(o, b.c), lo = b.l ?? Math.min(o, b.c);
              const up = b.c >= o;
              const bw = Math.max(1, Math.min(8, geo.slot * 0.64));
              const top = geo.y(Math.max(o, b.c)), bot = geo.y(Math.min(o, b.c));
              const col = up ? 'var(--up)' : 'var(--down)';
              return (
                <g key={i}>
                  <line x1={geo.x(i)} x2={geo.x(i)} y1={geo.y(hi)} y2={geo.y(lo)} stroke={col} stroke-width={1} />
                  <rect x={geo.x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} />
                </g>
              );
            }) : (
              <path d={series.bars.map((b, i) => `${i ? 'L' : 'M'}${geo.x(i).toFixed(1)},${geo.y(b.c).toFixed(1)}`).join('')} class="sc-line-path" stroke={lineColor} />
            )}
            {[{ m: series.ma20, cls: 'sc-ma20' }, { m: series.ma60, cls: 'sc-ma60' }].map(({ m, cls }) => {
              let d = '';
              let pen = false;
              m.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${geo.x(i).toFixed(1)},${geo.y(v).toFixed(1)}`; pen = true; });
              return d ? <path key={cls} d={d} class={cls} /> : null;
            })}
            {showVol ? series.bars.map((b, i) => {
              if (b.v === null || !geo.vmax) return null;
              const hgt = Math.max(1, (b.v / geo.vmax) * VOL_H);
              return <rect key={`v${i}`} x={geo.x(i) - Math.max(0.5, geo.slot * 0.32)} y={volTop + VOL_H - hgt} width={Math.max(1, geo.slot * 0.64)} height={hgt} class={i === (scrub ?? last) ? 'sc-vol cur' : 'sc-vol'} />;
            }) : null}
            <text x={0} y={dateY} text-anchor="start" class="sc-axis">{axisLabel(series.bars[0].t, intraday)}</text>
            <text x={plotW} y={dateY} text-anchor="end" class="sc-axis">{axisLabel(series.bars[last].t, intraday)}</text>
            {rr ? (
              <g class={sel?.fading ? 'sc-fade' : ''} data-testid="range-marks">
                <rect x={geo.x(rr.from)} y={0} width={Math.max(0, geo.x(rr.to) - geo.x(rr.from))} height={PRICE_H} class="range-band" />
                <line x1={geo.x(rr.from)} x2={geo.x(rr.from)} y1={0} y2={PRICE_H} class="chart-scrub" />
                <line x1={geo.x(rr.to)} x2={geo.x(rr.to)} y1={0} y2={PRICE_H} class="chart-scrub" />
              </g>
            ) : null}
            {scrub !== null && !rr && bar ? (
              <g data-testid="crosshair">
                <line x1={geo.x(scrub)} x2={geo.x(scrub)} y1={0} y2={PRICE_H + (showVol ? GAP + VOL_H : 0)} class="chart-scrub" />
                <line x1={0} x2={plotW} y1={geo.y(bar.c)} y2={geo.y(bar.c)} class="chart-scrub" />
                <circle cx={geo.x(scrub)} cy={geo.y(bar.c)} r={4} fill="var(--text-1)" />
              </g>
            ) : null}
          </svg>
        ) : <div class="sc-empty ui-foot ui-muted">{loading ? '載入中…' : emptyText}</div>}
        {scrub !== null && !rr && bar ? (
          <div class="sc-tip ui-foot" role="status" data-testid="crosshair-tip">
            <span>{label(bar.t)}{bar.v !== null ? `・量 ${fmtLotsUnit(bar.v, false)}` : ''}</span>
            {bar.o !== null && bar.h !== null && bar.l !== null ? <span>開 {fmtPrice(bar.o)}  高 {fmtPrice(bar.h)}  低 {fmtPrice(bar.l)}  收 {fmtPrice(bar.c)}</span> : <span>收 {fmtPrice(bar.c)}</span>}
          </div>
        ) : null}
        {rr ? (
          <div class={`sc-tip ui-foot ${sel?.fading ? 'sc-fade' : ''}`} role="status" data-testid="range-tip">
            <span>{axisLabel(rr.fromDate, intraday)} – {axisLabel(rr.toDate, intraday)}{intraday ? '' : `・${rr.days} 個交易日`}</span>
            <span><Signed v={rr.abs} digits={priceDigits(rr.toValue)} kind="arrow" />  <Signed v={rr.pct} digits={2} unit="%" /></span>
          </div>
        ) : null}
      </div>
      {series && (series.ma20.some((v) => v !== null) || series.baseLine) ? (
        <div class="sc-legend ui-foot ui-muted" aria-hidden="true">
          {series.ma20.some((v) => v !== null) ? <><span>20 日線</span><span class="sc-key ma20" /><span>60 日線</span><span class="sc-key ma60" /></> : null}
          {series.baseLine ? <><span>前收</span><span class="sc-key base" /></> : null}
        </div>
      ) : null}
      <div class="sc-periods">
        <Seg options={periods.map((p) => [p, p] as const)} value={period} onChange={onPeriod} label="股價走勢期間" testid="stock-periods" />
      </div>
      {footnote ? <div class="sc-foot ui-foot ui-muted" data-testid="data-time">{footnote}</div> : null}
    </div>
  );
}
