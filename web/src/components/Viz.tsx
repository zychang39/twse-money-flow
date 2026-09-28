/** 小型視覺元件：sparkline（含基準虛線）、分數環、紀律三環。 */
import { extent, pathD, points, yOf } from '../lib/chartMath';
import { fillForward } from '../lib/periods';
import { useRef, useState } from 'preact/hooks';
import { fmtLotsUnit } from '../lib/format';
import { IconCheck } from './Icons';

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

/** 分數環（0–100）。白色弧線＋灰色軌道，不另加顏色；null 顯示「—」。 */
export function ScoreRing({ value, size = 64, stroke = 4, label, className = '' }: { value: number | null | undefined; size?: number; stroke?: number; label?: string; className?: string }) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  return (
    <span class={`ring ${size >= 48 ? 'lg' : 'sm'} ${className}`} style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}>
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

/** 紀律三環：外→內＝看完簡報、檢查表、檢討。完成時播放一次低調的完成動畫。 */
export function Rings3({ progress, complete, animate }: { progress: number[]; complete: boolean; animate?: boolean }) {
  const sizes = [132, 104, 76];
  const opacity = [1, 0.72, 0.46];
  return (
    <div class={`rings3 ${complete && animate ? 'complete' : ''}`} aria-hidden="true">
      {sizes.map((s, i) => {
        const off = (132 - s) / 2;
        const r = (s - 10) / 2;
        const c = 2 * Math.PI * r;
        const p = Math.max(0, Math.min(1, progress[i] ?? 0));
        return (
          <svg key={s} width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ left: `${off / 16}rem`, top: `${off / 16}rem`, width: `${s / 16}rem`, height: `${s / 16}rem` }}>
            <circle class="track" cx={s / 2} cy={s / 2} r={r} fill="none" stroke-width={10} />
            {p > 0 ? (
              <circle class="arc" cx={s / 2} cy={s / 2} r={r} fill="none" stroke-width={10} stroke-linecap="round" stroke-opacity={opacity[i]}
                stroke-dasharray={`${c * p} ${c}`} transform={`rotate(-90 ${s / 2} ${s / 2})`} />
            ) : null}
          </svg>
        );
      })}
      {complete ? <span class="done-mark"><IconCheck /></span> : null}
    </div>
  );
}

/** 法人淨買賣超柱狀圖：淨買超紅、淨賣超綠（台股慣例）；最近 5 日不透明，其餘略淡。
 * 座標軸與數值標籤都帶單位（預設張，1 萬張以上縮寫為萬張）；手指拖曳、滑鼠移動或方向鍵可逐日查看日期與數值。 */
export function NetBars({ values, dates, label, height = 120, unit = '張', format = fmtLotsUnit, caption, words = ['淨買超', '淨賣超'], emphasizeRecent = true }: {
  values: (number | null)[];
  dates?: string[];
  label: string;
  height?: number;
  /** 單位名稱（無障礙說明用） */
  unit?: string;
  /** 數值＋單位的格式（例：fmtLotsUnit → −4.0 萬張） */
  format?: (v: number | null | undefined, sign?: boolean) => string;
  caption?: string;
  /** 正、負的說法（提示框與圖例）；預設「淨買超／淨賣超」，營收年增率等用「成長／衰退」 */
  words?: [string, string];
  /** 最近 5 根不透明、其餘略淡（逐日資料用；營收、EPS 關閉） */
  emphasizeRecent?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const n = values.length;
  if (!n) return null;
  const max = Math.max(1e-9, ...values.map((v) => Math.abs(v ?? 0)));
  // 資料很少時（例：6 季 EPS）不把柱子拉到很寬：至少 16 格，柱子置中
  const slots = Math.max(n, 16);
  const off = (slots - n) / 2;
  const W = slots * 6;
  const mid = height / 2;
  const idxAt = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * slots - off)));
  };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.buttons || e.type === 'pointerdown') setHover(idxAt(e.clientX));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover ?? n;
    setHover(Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
  };
  const hv = hover !== null ? values[hover] : null;
  return (
    <figure class="netbars">
      <div class="netbars-plot" style={{ height: `${height / 16}rem` }}>
      <div class="nb-axes" aria-hidden="true">
        <span>{format(max)}</span><span>0</span><span>{format(-max)}</span>
      </div>
      <div ref={ref} class="nb-bars" tabIndex={0}
        role="img" aria-label={`${label}。單位：${unit}；可用左右方向鍵逐日查看。`}
        onPointerDown={onPointer} onPointerMove={onPointer} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}
        onKeyDown={onKey} onBlur={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
          <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--line)" stroke-width={1} vector-effect="non-scaling-stroke" />
          {hover !== null ? <rect x={(hover + off) * 6} y={0} width={6} height={height} fill="var(--surface-2)" /> : null}
          {values.map((v, i) => {
            if (v === null || v === undefined) return null;
            const bh = Math.max(1.5, (Math.abs(v) / max) * (mid - 4));
            return <rect key={i} x={(i + off) * 6 + 1} y={v >= 0 ? mid - bh : mid} width={4} height={bh} rx={1.5} fill={v >= 0 ? 'var(--up)' : 'var(--down)'} opacity={hover === null ? (!emphasizeRecent || i >= n - 5 ? 1 : 0.7) : i === hover ? 1 : 0.45} />;
          })}
        </svg>
        {hover !== null ? (
          <div class={`nb-tip ${hover > n / 2 ? 'left' : ''}`} style={{ left: `${((hover + off + 0.5) / slots) * 100}%` }} role="status">
            <span class="caption muted">{dates?.[hover] ?? `第 ${hover + 1} 日`}</span>
            <span class={`num ${hv === null || hv === undefined || hv === 0 ? '' : hv > 0 ? 'up' : 'down'}`}>
              {hv === null || hv === undefined ? '無資料' : `${hv > 0 ? `▲ ${words[0]} ` : hv < 0 ? `▼ ${words[1]} ` : ''}${format(hv, false)}`}
            </span>
          </div>
        ) : null}
      </div>
      </div>
      <figcaption class="row between wrap caption muted" style={{ marginTop: 'var(--s-1)', gap: '0 var(--s-3)' }}>
        <span>{caption ?? `${n} 個交易日`}</span>
        <span style={{ whiteSpace: 'nowrap' }}><span class="up" aria-hidden="true">■</span> 紅色＝{words[0]}{' '}<span class="down" aria-hidden="true">■</span> 綠色＝{words[1]}</span>
      </figcaption>
    </figure>
  );
}
