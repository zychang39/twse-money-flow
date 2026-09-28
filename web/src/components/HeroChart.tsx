/**
 * 主角數字＋走勢圖（無座標軸、無格線）。
 * - 手指拖曳／滑鼠 hover：數字與日期即時跟著變動，放開後恢復最新值；鍵盤可用左右鍵逐日移動、Esc 恢復。
 * - 期間選擇器 1D～ALL：選中者為實心膠囊；切換時走勢線以 spring 平滑變形。
 * - 首次出現時走勢線由左到右描繪；主角數字從「上次查看的值」滾動到最新值，變化量以淡色標籤短暫浮現。
 * 線的顏色＝所選期間的漲跌（紅漲綠跌），與頁首環境光一致（由頁面以同一個 window 計算）。
 * heroChange='daily'（今晚頁）：主角數字下方固定顯示「今日」漲跌（拖曳時為該日漲跌），
 *   期間選擇器只改變走勢圖，區間漲跌標示在圖表上方（chart-range）。
 * heroChange='both'（個股頁）：主角數字下方兩行：「今日漲跌」與「所選期間漲跌」（拖曳時為該日漲跌、期間起點到該日）。
 * 只有 1 個資料點：畫單點標記，說明「資料累積中：目前只有 1 個交易日…」。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PERIODS, PERIOD_LABEL, change, type Dir, type Period, type Window } from '../lib/periods';
import { areaD, extent, lerpPts, nearestIndex, pathD, points, resample, springEase, yOf, type Frame } from '../lib/chartMath';
import { arrow, fmtNum } from '../lib/format';
import { coverage, coverageNote } from '../lib/series';

const N = 160;
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function usePeriod(id: string, fallback: Period = '3M', allowed: Period[] = PERIODS): [Period, (p: Period) => void] {
  const key = `period:${id}`;
  const read = (): Period => {
    try {
      const v = localStorage.getItem(key) as Period | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch { return fallback; }
  };
  const [state, setState] = useState<{ key: string; p: Period }>(() => ({ key, p: read() }));
  // 鍵改變（例：投資風格切換）時重新讀取該鍵的期間
  const p = state.key === key ? state.p : read();
  useEffect(() => { if (state.key !== key) setState({ key, p }); }, [key]);
  return [p, (v: Period) => { setState({ key, p: v }); try { localStorage.setItem(key, v); } catch { /* 無痕模式 */ } }];
}

export function dirColor(d: Dir): string {
  return d === 'up' ? 'var(--up)' : d === 'down' ? 'var(--down)' : 'var(--text-2)';
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）`;
}

export function PeriodSelector({ value, onChange, label = '期間', periods = PERIODS }: { value: Period; onChange: (p: Period) => void; label?: string; periods?: Period[] }) {
  return (
    <div class="periods" role="group" aria-label={label}>
      {periods.map((p) => (
        <button key={p} aria-pressed={value === p} onClick={() => onChange(p)}>{p}<span class="sr-only">（{PERIOD_LABEL[p]}）</span></button>
      ))}
    </div>
  );
}

/** 滾動數字：從 from 到 to，ease-out；減少動態效果時直接顯示。 */
function useRoll(to: number | null, from: number | null | undefined, format: (v: number) => string): string {
  const [shown, setShown] = useState<number | null>(from !== null && from !== undefined && to !== null ? from : to);
  const done = useRef(false);
  useEffect(() => {
    if (to === null) return;
    if (done.current || from === null || from === undefined || from === to || reduceMotion()) {
      setShown(to);
      done.current = true;
      return;
    }
    done.current = true;
    const t0 = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return shown === null ? '—' : format(shown);
}

const HOLD_MS = 200; // 按住多久開始查價（holdToScrub）
const HOLD_SLOP = 8; // 這段時間內移動超過幾 px 就視為滑動

export function HeroChart({
  label, win, period, onPeriod, format, formatDelta, seen, height = 176, area = false, caption, emptyText = '資料累積中', periodsLabel,
  periods = PERIODS, heroChange = 'period', holdToScrub = false,
}: {
  label: ComponentChildren;
  win: Window | null;
  period: Period;
  onPeriod: (p: Period) => void;
  format: (v: number) => string;
  formatDelta?: (v: number) => string;
  /** 上次查看時的值（數字滾動的起點；沒有則不滾動） */
  seen?: number | null;
  height?: number;
  area?: boolean;
  caption?: ComponentChildren;
  emptyText?: string;
  periodsLabel?: string;
  /** 期間選擇器的選項（今晚頁從 1W 開始：只有盤後日資料，1D 沒有意義） */
  periods?: Period[];
  /** 主角數字下方顯示：period＝所選期間漲跌（預設）；daily＝今日（拖曳時為該日）漲跌 */
  heroChange?: 'period' | 'daily' | 'both';
  /**
   * 觸控時要先按住（約 0.2 秒）才開始查價：放在可左右滑動換股的區域時使用，
   * 讓快速的左右滑動交給換股、按住再拖曳才是查價（滑鼠不受影響）。
   */
  holdToScrub?: boolean;
}) {
  const fd = formatDelta ?? format;
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const prevPts = useRef<[number, number][] | null>(null);
  const [w, setW] = useState(360);
  const [scrub, setScrub] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(200, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const frame: Frame = { w, h: height, padX: 12, padY: 14 };
  const geo = useMemo(() => {
    if (!win || !win.values.length) return null;
    const range = extent(win.values, win.values[0]);
    const pts = points(win.values, frame, range);
    return { range, pts, baseY: yOf(win.values[0], frame, range) };
  }, [win, w, height]);

  // 期間切換或資料更新：把舊路徑平滑變形成新路徑（直接改 DOM，不每幀重繪元件）
  useEffect(() => {
    if (!geo) return;
    const target = resample(geo.pts, N);
    const from = prevPts.current;
    prevPts.current = target;
    const set = (p: [number, number][]) => {
      const d = pathD(p);
      lineRef.current?.setAttribute('d', d);
      glowRef.current?.setAttribute('d', d);
      areaRef.current?.setAttribute('d', areaD(p, height));
    };
    if (!from || reduceMotion()) {
      set(target);
      return;
    }
    const t0 = performance.now();
    const dur = 520;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      set(lerpPts(from, target, springEase(k)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [geo]);

  useEffect(() => {
    if (!geo || drawn) return;
    const t = setTimeout(() => setDrawn(true), 950);
    return () => clearTimeout(t);
  }, [geo]);

  const last = win ? win.values.length - 1 : 0;
  const at = scrub ?? last;
  const latest = win ? win.values[last] : null;
  const daily = heroChange === 'daily';
  const both = heroChange === 'both';
  // daily：與前一個交易日比較（視窗第一點是區間基準，沒有前一日可比）
  const dayChg = win && at >= 1 ? change(win.values.slice(at - 1, at + 1)) : null;
  const chg = !win ? null : daily || both ? dayChg : change(win.values, at);
  const periodChg = win && both && win.values.length >= 2 ? change(win.values, at) : null;
  const range = win ? change(win.values) : null;
  const dir: Dir = win ? change(win.values).dir : 'flat';
  const color = dirColor(dir);
  const rolled = useRoll(latest, seen, format);
  const heroText = scrub !== null && win ? format(win.values[scrub]) : rolled;
  const seenDelta = seen !== null && seen !== undefined && latest !== null && Math.abs(latest - seen) > 1e-9 ? latest - seen : null;

  function idxFromX(clientX: number): number | null {
    const el = wrapRef.current;
    if (!el || !win) return null;
    const r = el.getBoundingClientRect();
    return nearestIndex(((clientX - r.left) / r.width) * w, frame, win.values.length);
  }
  const idxFromEvent = (e: PointerEvent) => idxFromX(e.clientX);
  // 按住查價（holdToScrub）：按下後 HOLD_MS 內移動超過 HOLD_SLOP 就放棄（交給換股或捲動），時間到才開始查價
  const hold = useRef<{ id: number; x: number; y: number; timer: number; active: boolean } | null>(null);
  const clearHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => {
    // 查價中阻止頁面上下捲動（touch-action: pan-y 允許捲動，需要在 touchmove 取消）
    const el = wrapRef.current;
    if (!el || !holdToScrub) return;
    const block = (e: TouchEvent) => { if (hold.current?.active && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => { el.removeEventListener('touchmove', block); clearHold(); };
  }, [holdToScrub]);
  const onMove = (e: PointerEvent) => {
    if (holdToScrub && e.pointerType !== 'mouse') {
      const h = hold.current;
      if (!h || h.id !== e.pointerId) return;
      if (!h.active) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) clearHold();
        return;
      }
      e.stopPropagation(); // 查價中：不讓外層的換股手勢接手
      setScrub(idxFromEvent(e));
      return;
    }
    // 外層正在左右換股（StockPager 拖曳中）：不查價
    if (wrapRef.current?.closest('.dragging')) { if (scrub !== null) setScrub(null); return; }
    if (e.pointerType === 'mouse' || e.buttons || (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setScrub(idxFromEvent(e));
  };
  const onDown = (e: PointerEvent) => {
    if (holdToScrub && e.pointerType !== 'mouse') {
      clearHold();
      const target = e.currentTarget as HTMLElement;
      const id = e.pointerId;
      const x = e.clientX;
      hold.current = {
        id, x, y: e.clientY, active: false,
        timer: window.setTimeout(() => {
          if (!hold.current || hold.current.id !== id) return;
          hold.current.active = true;
          try { target.setPointerCapture(id); } catch { /* 手指已離開 */ }
          setScrub(idxFromX(x));
        }, HOLD_MS),
      };
      return;
    }
    if (e.pointerType !== 'mouse') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrub(idxFromEvent(e));
  };
  const end = (e?: PointerEvent) => {
    if (e && hold.current?.active) e.stopPropagation();
    clearHold();
    setScrub(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!win) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = scrub ?? last;
      setScrub(Math.max(0, Math.min(last, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape' || e.key === 'Enter') setScrub(null);
  };

  const scrubPt = geo && scrub !== null ? geo.pts[scrub] : null;
  const endPt = geo ? geo.pts[geo.pts.length - 1] : null;
  const summary = win && latest !== null && chg
    ? `${typeof label === 'string' ? label : ''}${PERIOD_LABEL[period]}走勢：${dateLabel(win.dates[0])}到${dateLabel(win.dates[last])}，最新 ${format(latest)}，${dir === 'up' ? '上漲' : dir === 'down' ? '下跌' : '持平'} ${fd(Math.abs(change(win.values).abs))}`
    : '走勢圖資料不足';

  return (
    <div class="hero-block">
      <div class="hero-label">{label}</div>
      <div class="hero" aria-live="off">{heroText}</div>
      <div class="hero-change">
        {chg && win ? (
          <>
            <span class={chg.dir}>
              <span aria-hidden="true">{arrow(chg.abs)} {fd(Math.abs(chg.abs))}（{chg.pct === null ? '—' : `${Math.abs(chg.pct).toFixed(2)}%`}）</span>
              <span class="sr-only">{chg.dir === 'up' ? '上漲' : chg.dir === 'down' ? '下跌' : '持平'} {fd(Math.abs(chg.abs))}</span>
            </span>
            <span class="caption">{scrub !== null ? dateLabel(win.dates[scrub]) : daily || both ? '今日' : PERIOD_LABEL[period]}</span>
            {scrub === null && seenDelta !== null ? (
              <span class="delta-tag" aria-label={`較上次查看${seenDelta > 0 ? '增加' : '減少'} ${fd(Math.abs(seenDelta))}`}>較上次查看 {arrow(seenDelta)} {fd(Math.abs(seenDelta))}</span>
            ) : null}
          </>
        ) : win && (daily || both) ? <span class="caption">{dateLabel(win.dates[at])}</span> : <span class="caption">{emptyText}</span>}
      </div>
      {both && win ? (
        <div class="hero-change second" data-testid="hero-period-change">
          {periodChg ? (
            <>
              <span class={periodChg.dir}>
                <span aria-hidden="true">{arrow(periodChg.abs)} {fd(Math.abs(periodChg.abs))}（{periodChg.pct === null ? '—' : `${Math.abs(periodChg.pct).toFixed(2)}%`}）</span>
                <span class="sr-only">{PERIOD_LABEL[period]}{periodChg.dir === 'up' ? '上漲' : periodChg.dir === 'down' ? '下跌' : '持平'} {fd(Math.abs(periodChg.abs))}</span>
              </span>
              <span class="caption">{PERIOD_LABEL[period]}{scrub !== null ? `至 ${Number(win.dates[scrub].slice(5, 7))}/${Number(win.dates[scrub].slice(8, 10))}` : ''}</span>
            </>
          ) : <span class="caption">{PERIOD_LABEL[period]}：資料不足</span>}
        </div>
      ) : null}
      {daily && range && win ? (
        <div class="chart-range">
          <span>{PERIOD_LABEL[period]}</span>
          <span class={range.dir}>
            <span aria-hidden="true">{arrow(range.abs)} {fd(Math.abs(range.abs))}（{range.pct === null ? '—' : `${Math.abs(range.pct).toFixed(2)}%`}）</span>
            <span class="sr-only">{PERIOD_LABEL[period]}區間{range.dir === 'up' ? '上漲' : range.dir === 'down' ? '下跌' : '持平'} {fd(Math.abs(range.abs))}</span>
          </span>
        </div>
      ) : null}
      <div ref={wrapRef} class="chart-wrap bleed" style={{ height: `${height / 16}rem` }}
        tabIndex={win ? 0 : -1} role="img" aria-label={`${summary}。可用左右鍵查看每日數值。`}
        onPointerMove={onMove} onPointerDown={onDown} onPointerUp={(e) => e.pointerType !== 'mouse' && end(e)} onPointerCancel={() => end()}
        onPointerLeave={(e) => (e.pointerType === 'mouse' ? end() : undefined)}
        onKeyDown={onKey} onBlur={() => end()}>
        {geo ? (
          <svg class={`chart ${drawn ? '' : 'draw'}`} viewBox={`0 0 ${w} ${height}`} height={height} preserveAspectRatio="none" aria-hidden="true" style={{ ['--len' as string]: 1 }}>
            <defs>
              <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color={color} stop-opacity="0.18" />
                <stop offset="1" stop-color={color} stop-opacity="0" />
              </linearGradient>
              <filter id="hero-glow" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="4" /></filter>
            </defs>
            <line class="chart-base" x1={frame.padX} x2={w - frame.padX} y1={0} y2={0} style={{ transform: `translateY(${geo.baseY}px)`, transition: 'transform var(--dur-slow) var(--ease-spring)' }} />
            {area ? <path ref={areaRef} class="chart-area" fill="url(#hero-area)" /> : null}
            <path ref={glowRef} class="chart-glow" stroke={color} filter="url(#hero-glow)" pathLength={1} />
            <path ref={lineRef} class="chart-line" stroke={color} pathLength={1} />
            {scrubPt ? (
              <>
                <line class="chart-scrub" x1={scrubPt[0]} x2={scrubPt[0]} y1={0} y2={height} />
                <circle cx={scrubPt[0]} cy={scrubPt[1]} r={5} fill={color} stroke="var(--bg)" stroke-width={2} />
              </>
            ) : endPt ? (
              <>
                <circle class="dot-halo" cx={endPt[0]} cy={endPt[1]} r={9} fill={color} />
                <circle cx={endPt[0]} cy={endPt[1]} r={3.5} fill={color} />
              </>
            ) : null}
          </svg>
        ) : <div class="chart-empty" style={{ height: '100%' }}>{emptyText}</div>}
      </div>
      {caption || win?.truncated ? (
        <div class="chart-caption" data-testid="hero-coverage">{win?.truncated ? `${coverageNote({ ...coverage(win.dates, Infinity) }, '個交易日', false)}。` : ''}{caption}</div>
      ) : null}
      <PeriodSelector value={period} onChange={onPeriod} label={periodsLabel ?? '走勢期間'} periods={periods} />
    </div>
  );
}

export { fmtNum };
