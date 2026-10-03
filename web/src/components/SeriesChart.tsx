/**
 * 通用圖表（D5）：多條折線（或長條）共用 X／Y 軸。
 * - 軸：載入時依「目前期間內所有可選序列（含未勾選）」算好，整數刻度；切換序列只淡入淡出線條、不重新縮放；
 *   只有 axisKey（期間）或 log 改變時才更新軸，並以 400ms 動畫過渡。
 * - 每條線固定顏色；線尾直接標「名稱＋期末值」；圖例為色點膠囊（點一下顯示／隱藏、長按單獨突顯）；直接點線也會突顯並顯示名稱。
 * - 全部隱藏時保留軸與格線。按住拖曳讀值，讀值面板固定在圖上緣；長條圖可點單根。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { axisPos, lerpAxis, linearAxis, logAxis, spreadLabels, type Axis } from '../lib/axis';
import { smoothD } from '../lib/chartMath';
import { reduceMotion } from './kit';

export interface Series {
  id: string;
  name: string;
  color: string;
  values: (number | null)[];
  /** 主序列（白色加粗帶柔光，例：5 檔組合） */
  main?: boolean;
  /** 細線（例：隨機中位數） */
  thin?: boolean;
  /** 不出現在圖例（例：隨機中位數，跟著帶狀區） */
  noLegend?: boolean;
}

export interface Band { lo: (number | null)[]; hi: (number | null)[]; color: string; name: string }

const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const END_W = 92; // 線尾標籤欄寬
const LONG_PRESS = 500;

export function SeriesChart({
  dates, series, band, log = false, axisKey, height = 220, format, tickFormat, dateFormat = (d) => d, defaultHidden = [],
  stripes, readoutExtra, label, testid, zero = false,
}: {
  dates: string[];
  series: Series[];
  band?: Band;
  log?: boolean;
  /** 期間鍵：改變時才重新計算軸（以動畫過渡） */
  axisKey: string;
  height?: number;
  format: (v: number) => string;
  tickFormat?: (v: number) => string;
  dateFormat?: (d: string) => string;
  defaultHidden?: string[];
  /** 年份淡色直條：每個區段的起訖索引與標籤 */
  stripes?: { from: number; to: number; label: string }[];
  /** 讀值面板的額外內容（例：當週持股五檔） */
  readoutExtra?: (i: number) => ComponentChildren;
  label: string;
  testid?: string;
  /** Y 軸包含 0（例：超額報酬） */
  zero?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(defaultHidden));
  const [focus, setFocus] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const press = useRef<{ timer: number; id: string } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(240, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  // 軸：所有序列（含隱藏）＋帶狀區；只在 axisKey／log 改變時更新
  const target = useMemo<Axis>(() => {
    const all: number[] = [];
    for (const s of series) for (const v of s.values) if (v !== null && Number.isFinite(v)) all.push(v);
    if (band) for (const arr of [band.lo, band.hi]) for (const v of arr) if (v !== null && Number.isFinite(v)) all.push(v);
    if (zero) all.push(0);
    return log ? logAxis(all) : linearAxis(all);
  }, [axisKey, log]);
  const [ax, setAx] = useState<Axis>(target);
  const prevAx = useRef<Axis>(target);
  useEffect(() => {
    const from = prevAx.current;
    prevAx.current = target;
    if (reduceMotion() || (from.lo === target.lo && from.hi === target.hi && from.log === target.log)) { setAx(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 400);
      const e = 1 - Math.pow(1 - k, 3);
      setAx(lerpAxis(from, target, e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const plotW = Math.max(120, w - END_W);
  const n = dates.length;
  const x = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_TOP + (1 - axisPos(v, ax)) * (height - PAD_TOP - PAD_BOTTOM);
  const pathOf = (vals: (number | null)[]) => {
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v) || (ax.log && v <= 0)) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([x(i), y(v)]);
    });
    if (cur.length) segs.push(cur);
    return segs.map((s) => smoothD(s)).join('');
  };
  const lastIdx = (vals: (number | null)[]) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null && Number.isFinite(vals[i] as number)) return i; return -1; };

  const visible = series.filter((s) => !hidden.has(s.id));
  // 線尾標籤：名稱＋期末值；避免重疊
  const ends = visible.map((s) => { const i = lastIdx(s.values); return i < 0 ? null : { s, i, y: y(s.values[i] as number) }; }).filter((e): e is NonNullable<typeof e> => !!e);
  const endYs = spreadLabels(ends.map((e) => e.y), 16, PAD_TOP + 6, height - PAD_BOTTOM);

  const idxAt = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || n < 1) return null;
    const t = (clientX - r.left) / plotW;
    return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  };
  const nearestSeries = (clientX: number, clientY: number): string | null => {
    const r = wrapRef.current?.getBoundingClientRect();
    const i = idxAt(clientX);
    if (!r || i === null) return null;
    let best: string | null = null, dist = 14;
    for (const s of visible) {
      const v = s.values[i];
      if (v === null || !Number.isFinite(v)) continue;
      const d = Math.abs(y(v) - (clientY - r.top));
      if (d < dist) { dist = d; best = s.id; }
    }
    return best;
  };
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: PointerEvent) => { down.current = { x: e.clientX, y: e.clientY, moved: false }; setScrub(idxAt(e.clientX)); };
  const onMove = (e: PointerEvent) => {
    if (!down.current && e.pointerType !== 'mouse') return;
    if (down.current && Math.abs(e.clientX - down.current.x) > 6) down.current.moved = true;
    if (down.current || e.pointerType === 'mouse') setScrub(idxAt(e.clientX));
  };
  const onUp = (e: PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (d && !d.moved) {
      const id = nearestSeries(e.clientX, e.clientY);
      setFocus(id && id !== focus ? id : null);
    }
    if (e.pointerType !== 'mouse') setScrub(null);
  };

  const toggle = (id: string) => setHidden((h) => { const nx = new Set(h); if (nx.has(id)) nx.delete(id); else nx.add(id); return nx; });
  const legendDown = (id: string) => { press.current = { id, timer: window.setTimeout(() => { setFocus((f) => (f === id ? null : id)); press.current = null; }, LONG_PRESS) }; };
  const legendUp = (id: string) => { if (press.current && press.current.id === id) { clearTimeout(press.current.timer); press.current = null; toggle(id); } };

  const tf = tickFormat ?? format;
  const sx = scrub === null ? null : x(scrub);
  return (
    <div class="sc2" data-testid={testid} aria-label={label} role="group">
      <div ref={wrapRef} class="sc2-plot" style={{ height: `${height / 16}rem` }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { down.current = null; setScrub(null); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setScrub(null); }}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true">
          {stripes?.map((st, k) => (
            <g key={k} class="sc2-stripe">
              {k % 2 === 0 ? <rect x={x(st.from)} y={PAD_TOP} width={Math.max(0, x(st.to) - x(st.from))} height={height - PAD_TOP - PAD_BOTTOM} /> : null}
              <text x={(x(st.from) + x(st.to)) / 2} y={height - 6} text-anchor="middle">{st.label}</text>
            </g>
          ))}
          <g class="sc2-grid" data-testid="sc2-ticks">
            {ax.ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} />
                <text x={0} y={y(t) - 4}>{tf(t)}</text>
              </g>
            ))}
          </g>
          {band ? (
            <path class="sc2-band" fill={band.color} d={bandPath(band, x, y, ax.log)} />
          ) : null}
          {series.map((s) => {
            const off = hidden.has(s.id);
            const dim = focus !== null && focus !== s.id;
            const d = pathOf(s.values);
            return (
              <g key={s.id} class={`sc2-line ${off ? 'off' : ''} ${dim ? 'dim' : ''} ${s.main ? 'main' : ''} ${s.thin ? 'thin' : ''}`} data-series={s.id}>
                {s.main ? <path d={d} class="sc2-glow" stroke={s.color} /> : null}
                <path d={d} stroke={s.color} />
              </g>
            );
          })}
          {ends.map((e, k) => (
            <g key={e.s.id} class={`sc2-end ${focus !== null && focus !== e.s.id ? 'dim' : ''}`}>
              <circle cx={x(e.i)} cy={e.y} r={2.5} fill={e.s.color} />
              <text x={plotW + 8} y={endYs[k] + 4} fill={e.s.color}>{e.s.name} {format(e.s.values[e.i] as number)}</text>
            </g>
          ))}
          {sx !== null ? <line class="sc2-cross" x1={sx} x2={sx} y1={PAD_TOP} y2={height - PAD_BOTTOM} /> : null}
          {!stripes && n >= 2 ? (
            <g class="sc2-dates">
              <text x={0} y={height - 6}>{dateFormat(dates[0])}</text>
              <text x={plotW} y={height - 6} text-anchor="end">{dateFormat(dates[n - 1])}</text>
            </g>
          ) : null}
        </svg>
        {scrub !== null ? (
          <div class="sc2-readout" role="status" data-testid="sc2-readout">
            <span class="sc2-r-date">{dateFormat(dates[scrub])}</span>
            {visible.map((s) => {
              const v = s.values[scrub];
              return <span key={s.id} class="sc2-r-item"><i style={{ background: s.color }} />{s.name} {v === null || !Number.isFinite(v) ? '—' : format(v)}</span>;
            })}
            {readoutExtra ? <span class="sc2-r-extra">{readoutExtra(scrub)}</span> : null}
          </div>
        ) : focus ? (
          <div class="sc2-readout focus" role="status">{series.find((s) => s.id === focus)?.name}</div>
        ) : null}
      </div>
      <div class="sc2-legend" role="group" aria-label={`${label}：圖例（點一下顯示或隱藏，長按單獨突顯）`}>
        {series.filter((s) => !s.noLegend).map((s) => (
          <button type="button" key={s.id} class={`sc2-chip ${hidden.has(s.id) ? 'off' : ''} ${focus === s.id ? 'focus' : ''}`} aria-pressed={!hidden.has(s.id)}
            onPointerDown={() => legendDown(s.id)} onPointerUp={() => legendUp(s.id)} onPointerLeave={() => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.id); } }} data-testid={`chip-${s.id}`}>
            <i style={{ background: s.color }} />{s.name}
          </button>
        ))}
        {band ? <span class="sc2-chip static"><i class="band" style={{ background: band.color }} />{band.name}</span> : null}
      </div>
    </div>
  );
}

function bandPath(band: Band, x: (i: number) => number, y: (v: number) => number, log: boolean): string {
  const ok = (v: number | null): v is number => v !== null && Number.isFinite(v) && (!log || v > 0);
  const idx = band.lo.map((_, i) => i).filter((i) => ok(band.lo[i]) && ok(band.hi[i]));
  if (idx.length < 2) return '';
  const top = idx.map((i) => `${x(i).toFixed(1)},${y(band.hi[i] as number).toFixed(1)}`);
  const bot = idx.slice().reverse().map((i) => `${x(i).toFixed(1)},${y(band.lo[i] as number).toFixed(1)}`);
  return `M${top.join('L')}L${bot.join('L')}Z`;
}

/**
 * 長條圖（年度並列等）：每組 groups 個長條（例：5 檔組合｜所選基準），可點單根讀值（讀值面板固定在上緣）。
 */
export function BarChart({ labels, series, format, height = 180, label, testid, onPick }: {
  labels: string[];
  series: { id: string; name: string; color: string; values: (number | null)[] }[];
  format: (v: number) => string;
  height?: number;
  label: string;
  testid?: string;
  /** 點單根長條（例：逐年檢視點某一年） */
  onPick?: (i: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [sel, setSel] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(240, Math.round(es[0].contentRect.width))));
    ro.observe(el);
    setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const ax = linearAxis([...all, 0]);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + (1 - axisPos(v, ax)) * plotH;
  const n = labels.length;
  const slot = w / Math.max(1, n);
  const bw = Math.max(3, Math.min(14, (slot - 4) / series.length - 1));
  const y0 = y(0);
  return (
    <div class="sc2" data-testid={testid} role="group" aria-label={label}>
      <div ref={wrapRef} class="sc2-plot" style={{ height: `${height / 16}rem` }}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
          <g class="sc2-grid" aria-hidden="true">
            {ax.ticks.map((t) => <g key={t}><line x1={0} x2={w} y1={y(t)} y2={y(t)} /><text x={0} y={y(t) - 4}>{format(t)}</text></g>)}
          </g>
          {labels.map((lb, i) => {
            const cx = slot * i + slot / 2;
            const x0 = cx - (series.length * (bw + 1)) / 2;
            return (
              <g key={lb} class={`sc2-bar-g ${sel !== null && sel !== i ? 'dim' : ''}`}>
                <rect class="sc2-hit" x={slot * i} y={0} width={slot} height={height} fill="transparent"
                  role="button" tabIndex={0} aria-label={`${lb}：${series.map((s) => `${s.name} ${s.values[i] === null ? '無資料' : format(s.values[i] as number)}`).join('、')}`}
                  onClick={() => { setSel(sel === i ? null : i); onPick?.(i); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(sel === i ? null : i); onPick?.(i); } }} />
                {series.map((s, k) => {
                  const v = s.values[i];
                  if (v === null || !Number.isFinite(v)) return null;
                  const yy = y(v);
                  return <rect key={s.id} class="sc2-bar" x={x0 + k * (bw + 1)} y={Math.min(yy, y0)} width={bw} height={Math.max(1, Math.abs(yy - y0))} fill={s.color} rx={1.5} pointer-events="none" />;
                })}
                {i === 0 || i === n - 1 || n <= 8 ? <text class="sc2-xl" x={cx} y={height - 6} text-anchor="middle" aria-hidden="true">{lb}</text> : null}
              </g>
            );
          })}
          <line class="sc2-zero" x1={0} x2={w} y1={y0} y2={y0} aria-hidden="true" />
        </svg>
        {sel !== null ? (
          <div class="sc2-readout" role="status" data-testid="bar-readout">
            <span class="sc2-r-date">{labels[sel]}</span>
            {series.map((s) => <span key={s.id} class="sc2-r-item"><i style={{ background: s.color }} />{s.name} {s.values[sel] === null ? '—' : format(s.values[sel] as number)}</span>)}
          </div>
        ) : null}
      </div>
      <div class="sc2-legend">
        {series.map((s) => <span key={s.id} class="sc2-chip static"><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
    </div>
  );
}
