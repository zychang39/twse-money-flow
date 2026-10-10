/** 小型視覺元件：sparkline（含基準虛線）、分數環、淨買賣超柱狀圖；圖表共用的日期軸格式與讀值狀態。 */
import { extent, pathD, points, yOf } from '../lib/chartMath';
import { fillForward } from '../lib/periods';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dirClass, dirColor, fmtLotsUnit } from '../lib/format';

/**
 * 圖表日期軸的標籤：日資料顯示 M/D（withYear 時 YYYY/M/D）、月資料顯示 YYYY/M；其他字串（季別、期間名）原樣回傳。
 * 第一個標籤帶年份、最後一個只在跨年時帶年份（LineChart）。
 */
export function axisDate(s: string, withYear = false): string {
  const m = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(s);
  if (!m) return s;
  const y = m[1], mo = Number(m[2]);
  if (m[3] === undefined) return `${y}/${mo}`;
  const d = Number(m[3]);
  return withYear ? `${y}/${mo}/${d}` : `${mo}/${d}`;
}

/**
 * 圖表讀值（手指或滑鼠指到的那一格）：滑鼠移開即清除；觸控放開後保留 holdMs（預設 3 秒），下一次點擊會重設，
 * 手指一離開數字就消失的話，在手機上根本看不到讀值。
 */
export function useReadout(holdMs = 3000): {
  idx: number | null;
  set: (i: number | null) => void;
  /** pointerup／pointerleave／pointercancel 共用：滑鼠→清除，觸控／筆→保留一段時間 */
  release: (e: { pointerType: string }) => void;
  clear: () => void;
} {
  const [idx, setIdx] = useState<number | null>(null);
  const timer = useRef(0);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = 0; } };
  useEffect(() => stop, []);
  const set = (i: number | null) => { stop(); setIdx(i); };
  const clear = () => { stop(); setIdx(null); };
  const release = (e: { pointerType: string }) => {
    if (e.pointerType === 'mouse') { clear(); return; }
    stop();
    timer.current = window.setTimeout(() => { timer.current = 0; setIdx(null); }, holdMs);
  };
  return { idx, set, release, clear };
}

/**
 * 清單列的 sparkline：近 20 個交易日（還原價），虛線＝昨收；顏色＝今日漲跌（與右側漲跌膠囊一致）。
 */
export function Sparkline({ values, dir, w = 64, h = 32 }: { values: (number | null)[] | null | undefined; dir: 'up' | 'down' | 'flat'; w?: number; h?: number }) {
  const v = values ? fillForward(values) : null;
  if (!v || !v.length) return <svg width={w} height={h} aria-hidden="true" />;
  // 只有 1 點：畫單點標記（右端），不畫線
  if (v.length === 1) return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><circle cx={w - 3} cy={h / 2} r={2.5} fill="var(--text-2)" /></svg>;
  const base = v[v.length - 2];
  const f = { w, h, padX: 2, padY: 3 };
  const range = extent(v, base);
  const color = dir === 'up' ? 'var(--up)' : dir === 'down' ? 'var(--down)' : 'var(--text-2)';
  const by = yOf(base, f, range);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ overflow: 'visible' }}>
      <line x1={2} x2={w - 2} y1={by} y2={by} class="chart-base" />
      <path d={pathD(points(v, f, range))} fill="none" stroke={color} stroke-width={1.4} stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}

/**
 * 分數環（0–100）：灰階弧線＋灰色軌道，不另加顏色；null 顯示「—」。
 * tone＝1～4 指定弧線用哪一級灰階墨色（--ink-N）；四環並排（.rings4）沒指定時依順序取 1～4，灰階下也分得出來。
 */
export function ScoreRing({ value, size = 64, stroke = 4, label, className = '', tone }: {
  value: number | null | undefined; size?: number; stroke?: number; label?: string; className?: string; tone?: 1 | 2 | 3 | 4;
}) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  return (
    <span class={`ring ${size >= 48 ? 'lg' : 'sm'} ${tone ? `ink-${tone}` : ''} ${className}`} style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ width: '100%', height: '100%' }}>
        <circle class="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} />
        {v !== null && v > 0 ? (
          <circle class="ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} stroke-linecap="round"
            stroke-dasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ) : null}
      </svg>
      <span class="ring-v" aria-hidden="true">{v === null ? '—' : Math.round(v)}</span>
      {label ? <span class="sr-only">{`${label} ${v === null ? '資料不足' : Math.round(v)}`}</span> : null}
    </span>
  );
}

/** 法人淨買賣超柱狀圖：淨買超紅、淨賣超綠（台股慣例）；最近 5 日不透明，其餘略淡。
 * 座標軸與數值標籤都帶單位（預設張，完整的千分位整數）；下方是日期軸（首末日期 M/D）。
 * 手指拖曳、滑鼠移動或方向鍵可逐日查看日期與數值（顯示在圖下方的說明列，不用浮框）；手指放開後讀值保留 3 秒。
 * 全部數值 ≥ 0（例：營收年增率、EPS 都是正的）時 y 軸從 0 開始；有負值才上下對稱。 */
export function NetBars({ values, dates, label, height = 120, unit = '張', format = fmtLotsUnit, caption, words = ['淨買超', '淨賣超'], emphasizeRecent = true, minZero, neutral = false }: {
  values: (number | null)[];
  dates?: string[];
  label: string;
  height?: number;
  /** 單位名稱（無障礙說明用） */
  unit?: string;
  /** 數值＋單位的格式（例：fmtLotsUnit → −40,123 張） */
  format?: (v: number | null | undefined, sign?: boolean) => string;
  caption?: string;
  /** 正、負的說法（提示框與圖例）；預設「淨買超／淨賣超」，營收年增率等用「成長／衰退」 */
  words?: [string, string];
  /** 最近 5 根不透明、其餘略淡（逐日資料用；營收、EPS 關閉） */
  emphasizeRecent?: boolean;
  /** y 軸從 0 開始（0～最大值）；不指定時：全部數值 ≥ 0 就從 0 開始，否則上下對稱 */
  minZero?: boolean;
  /** 數量型（成交金額等）：柱子用中性灰、提示框不加 ▲▼；紅綠只留給漲跌與買賣超 */
  neutral?: boolean;
}) {
  const read = useReadout();
  const hover = read.idx;
  const ref = useRef<HTMLDivElement>(null);
  const n = values.length;
  if (!n) return null;
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v ?? 0)));
  const fromZero = minZero ?? values.every((v) => (v ?? 0) >= 0);
  // 資料很少時（例：6 季 EPS）不把柱子拉到很寬：至少 16 格，柱子置中
  const slots = Math.max(n, 16);
  const off = (slots - n) / 2;
  const W = slots * 6;
  const top = 2, bottom = height - 2;
  const lo = fromZero ? 0 : -max;
  const y = (v: number) => bottom - ((v - lo) / (max - lo)) * (bottom - top);
  const zeroY = y(0);
  const idxAt = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * slots - off)));
  };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.buttons || e.type === 'pointerdown') read.set(idxAt(e.clientX));
  };
  const onUp = (e: PointerEvent) => { if (e.pointerType !== 'mouse') read.release(e); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover ?? n;
    read.set(Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
  };
  const hv = hover !== null ? values[hover] : null;
  const axis = fromZero ? [format(max), format(max / 2), '0'] : [format(max), '0', format(-max)];
  return (
    <figure class="netbars">
      <div class="netbars-plot" style={{ gridTemplateRows: `${height / 16}rem auto` }}>
      <div class="nb-axes" aria-hidden="true">
        {axis.map((t, i) => <span key={i}>{t}</span>)}
      </div>
      <div ref={ref} class="nb-bars" tabIndex={0}
        role="img" aria-label={`${label}。單位：${unit}；可用左右方向鍵逐日查看。`}
        onPointerDown={onPointer} onPointerMove={onPointer} onPointerUp={onUp} onPointerLeave={read.release} onPointerCancel={read.release}
        onKeyDown={onKey} onBlur={read.clear}>
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
          <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--line)" stroke-width={1} vector-effect="non-scaling-stroke" />
          {hover !== null ? <rect x={(hover + off) * 6} y={0} width={6} height={height} fill="var(--surface-2)" /> : null}
          {values.map((v, i) => {
            if (v === null || v === undefined) return null;
            const bh = Math.max(1.5, Math.abs(y(v) - zeroY));
            return <rect key={i} x={(i + off) * 6 + 1} y={v >= 0 ? zeroY - bh : zeroY} width={4} height={bh} rx={1.5} fill={neutral ? 'var(--text-2)' : dirColor(v)} opacity={hover === null ? (!emphasizeRecent || i >= n - 5 ? 1 : 0.7) : i === hover ? 1 : 0.45} />;
          })}
        </svg>
      </div>
      {dates?.length ? (
        <div class="nb-dates" aria-hidden="true">
          <span style={{ left: `${(off / slots) * 100}%` }}>{axisDate(dates[0])}</span>
          {n > 1 ? <span style={{ right: `${((slots - off - n) / slots) * 100}%` }}>{axisDate(dates[n - 1])}</span> : null}
        </div>
      ) : null}
      </div>
      <figcaption class="row between wrap caption muted" style={{ marginTop: 'var(--s-1)', gap: '0 var(--s-3)' }} aria-live="polite">
        {/* 讀值（2026-10-10）：不用浮框，查看時說明列換成該日的日期與數值 */}
        {hover !== null ? (
          <span data-testid="nb-read">
            {dates?.[hover] ?? `第 ${hover + 1} 日`}{' '}
            <span class={`num ${neutral ? '' : dirClass(hv)}`}>
              {hv === null || hv === undefined ? '無資料' : neutral ? format(hv, false) : `${hv > 0 ? `▲ ${words[0]} ` : hv < 0 ? `▼ ${words[1]} ` : ''}${format(hv, false)}`}
            </span>
          </span>
        ) : <span>{caption ?? `${n} 個交易日`}</span>}
        {neutral ? null : <span style={{ whiteSpace: 'nowrap' }}><span class="up" aria-hidden="true">■</span> 紅色＝{words[0]}{' '}<span class="down" aria-hidden="true">■</span> 綠色＝{words[1]}</span>}
      </figcaption>
    </figure>
  );
}
