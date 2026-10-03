/**
 * 共用元件（2026-10 恢復環境光改版，M0）：名詞、說明面板、結論行、解讀行、橘點、摘要卡、進度條、區間條、發散橫條、
 * 迷你折線、環、骨架、四種資料狀態、滾動數字。各頁只組合這些元件，不手刻版面；樣式在 styles/kit.css。
 *
 * 規則（docs/design 與 PROGRESS.md 的 A／B／C／F／G 節）：
 * - 朗讀文字用 aria-label，不用隱藏文字節點（複製數值不重複）；負值朗讀為「負 x%」。
 * - 動畫只用 transform／opacity、≤ 600ms、不循環（骨架微光例外：只在載入中）；減少動態效果時全部關閉、版面不變。
 * - 解讀行只在「新手」說明層級顯示；「精簡」只在超過提醒門檻時於數值旁亮橘點，點橘點開說明。
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { IconChevron } from './Icons';
import { fillExample, findTerm, type Term as TermDef } from '../lib/glossary';
import { extent, points, smoothD, yOf } from '../lib/chartMath';

type Kids = ComponentChildren;
type Ctx = Record<string, string | number | null | undefined>;

export const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- 說明面板（全站一個）

interface HelpState { term: TermDef; ctx?: Ctx; extra?: Kids }
let helpSet: ((s: HelpState | null) => void) | null = null;
const readTerms = new Set<string>();
const readSubs = new Set<(id: string) => void>();

/** 打開某個名詞的說明面板（先白話、可展開進階；底部「查看全部名詞」）。 */
export function openHelp(id: string, ctx?: Ctx, extra?: Kids): void {
  const term = findTerm(id);
  if (!term || !helpSet) return;
  helpSet({ term, ctx, extra });
  if (!readTerms.has(term.id)) {
    readTerms.add(term.id);
    readSubs.forEach((f) => f(term.id));
  }
}

/** 名詞被打開時通知（流程頁「名詞圖鑑」與經驗值用）。 */
export function onTermRead(f: (id: string) => void): () => void {
  readSubs.add(f);
  return () => { readSubs.delete(f); };
}

/** 說明面板的掛載點（app.tsx）。 */
export function HelpHost() {
  const [s, setS] = useState<HelpState | null>(null);
  const [adv, setAdv] = useState(false);
  useEffect(() => { helpSet = (v) => { setAdv(false); setS(v); }; return () => { helpSet = null; }; }, []);
  const t = s?.term;
  const ex = t ? fillExample(t.example, s?.ctx) : null;
  return (
    <Sheet open={!!s} onClose={() => setS(null)} title={t?.name ?? '說明'}>
      {t ? (
        <div class="help" data-testid="help-sheet" data-term={t.id}>
          <p class="help-plain">{t.plain}</p>
          {ex ? <p class="help-example" data-testid="help-example">{ex}</p> : null}
          {s?.extra ? <div class="help-extra">{s.extra}</div> : null}
          {t.advanced ? (
            <>
              <button type="button" class="help-adv-btn" aria-expanded={adv} onClick={() => setAdv(!adv)} data-testid="help-advanced">
                {adv ? '收起進階' : '進階：怎麼算、門檻、常見誤讀'}
              </button>
              {adv ? <p class="help-adv">{t.advanced}</p> : null}
            </>
          ) : null}
          <a class="help-all" href="#/me/glossary" onClick={() => setS(null)} data-testid="help-all">查看全部名詞 <IconChevron /></a>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * 可點的專有名詞（細虛線底線）：點開說明面板。children 省略時顯示名詞名稱。
 * ctx：舉例模板要帶入的當前數字（例 { value: '2.1' }）。
 */
export function Term({ id, children, ctx, extra, testid }: { id: string; children?: Kids; ctx?: Ctx; extra?: Kids; testid?: string }) {
  const t = findTerm(id);
  if (!t) return <>{children}</>;
  return (
    <button type="button" class="term" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openHelp(t.id, ctx, extra); }}
      aria-haspopup="dialog" data-term={t.id} data-testid={testid}>
      {children ?? t.name}
    </button>
  );
}

// ---------------------------------------------------------------- 結論行、解讀行、橘點

/** 結論行（B1）：區塊標題下一行（20/25 semibold），只放數字與事實，不超過一行。 */
export function Conclusion({ children, testid }: { children: Kids; testid?: string }) {
  return <p class="concl" data-testid={testid ?? 'conclusion'}>{children}</p>;
}

/**
 * 解讀行（B2）：指標數值下方一行白話（≤ 28 字），模板帶入當下數值、只陳述事實。
 * 「精簡」說明層級隱藏；alert＝超過提醒門檻（橘色）。
 */
export function Interp({ children, alert = false, testid }: { children: Kids; alert?: boolean; testid?: string }) {
  if (children === null || children === undefined || children === '') return null;
  return <p class={`interp ${alert ? 'alert' : ''}`} data-testid={testid ?? 'interp'}>{children}</p>;
}

/** 橘點（B3）：精簡模式下、指標超過提醒門檻時顯示在數值旁；點開該名詞說明。新手模式改由解讀行轉橘表示。 */
export function RiskDot({ term, show, text, ctx }: { term: string; show: boolean; text?: string; ctx?: Ctx }) {
  if (!show) return null;
  return (
    <button type="button" class="risk-dot" aria-label={`提醒：${text ?? findTerm(term)?.name ?? ''}，點開說明`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openHelp(term, ctx); }} data-testid="risk-dot">
      <i aria-hidden="true" />
    </button>
  );
}

/**
 * 指標格（摘要 6 格、動能卡內的數值）：名詞標籤（可點）｜數值（可帶橘點）｜小圖形｜解讀行。
 */
export function Metric({ term, label, value, graphic, interp, alert = false, alertText, ctx, testid }: {
  term: string;
  label?: Kids;
  value: Kids;
  graphic?: Kids;
  interp?: Kids;
  alert?: boolean;
  alertText?: string;
  ctx?: Ctx;
  testid?: string;
}) {
  return (
    <div class="metric" data-testid={testid}>
      <span class="metric-l"><Term id={term} ctx={ctx}>{label}</Term></span>
      <span class="metric-v" data-a="bl">{value}<RiskDot term={term} show={alert} text={alertText} ctx={ctx} /></span>
      {graphic ? <span class="metric-g">{graphic}</span> : null}
      <Interp alert={alert}>{interp}</Interp>
    </div>
  );
}

// ---------------------------------------------------------------- 摘要卡

/**
 * 摘要卡（E 節）：標題＋結論行＋小圖形＋解讀行，點擊推入詳情頁（共用元素過渡：標題與數值）。
 */
export function SummaryCard({ title, conclusion, graphic, interp, href, onClick, children, testid, vt }: {
  title: Kids;
  conclusion?: Kids;
  graphic?: Kids;
  interp?: Kids;
  href?: string;
  onClick?: () => void;
  children?: Kids;
  testid?: string;
  /** 共用元素過渡名稱（view-transition-name 的前綴） */
  vt?: string;
}) {
  const inner = (
    <>
      <span class="sum-head">
        <span class="sum-title" style={vt ? { viewTransitionName: `${vt}-title` } as JSX.CSSProperties : undefined}>{title}</span>
        {href || onClick ? <span class="sum-chev" aria-hidden="true"><IconChevron /></span> : null}
      </span>
      {conclusion ? <span class="sum-concl" style={vt ? { viewTransitionName: `${vt}-value` } as JSX.CSSProperties : undefined}>{conclusion}</span> : null}
      {graphic ? <span class="sum-graphic">{graphic}</span> : null}
      {children}
      {interp ? <Interp>{interp}</Interp> : null}
    </>
  );
  if (href) return <a class="sum-card ui-tap" href={href} data-testid={testid}>{inner}</a>;
  if (onClick) return <button type="button" class="sum-card ui-tap" onClick={onClick} data-testid={testid}>{inner}</button>;
  return <div class="sum-card" data-testid={testid}>{inner}</div>;
}

// ---------------------------------------------------------------- 圖形：進度條、區間條、發散橫條、迷你折線、環

/** 由 0 長到目標（400ms）：掛載後下一幀才套用目標值。 */
function useGrow(): boolean {
  const [on, setOn] = useState(reduceMotion());
  useEffect(() => {
    if (on) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(r);
  }, []);
  return on;
}

/** 進度條（0–100；例：RS 百分位）。color：資料強調色或風險橘。 */
export function ProgressBar({ value, color = 'var(--c-blue)', label, max = 100, testid }: { value: number | null | undefined; color?: string; label?: string; max?: number; testid?: string }) {
  const on = useGrow();
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(max, value));
  return (
    <span class="pbar" role="img" aria-label={label ?? (v === null ? '無資料' : `${Math.round(v)}／${max}`)} data-testid={testid}>
      {v !== null ? <i style={{ background: color, transform: `scaleX(${on ? v / max : 0})` }} /> : null}
    </span>
  );
}

/**
 * 區間條（52 週、60 日區間；或隨機 5–95% 帶）：軌道＝low～high；markers 標出目前位置（與其他比較點）。
 */
export function RangeBar({ low, high, markers, band, label, testid }: {
  low: number; high: number;
  markers: { v: number; color?: string; label?: string; kind?: 'dot' | 'tick' }[];
  /** 帶狀區（例：隨機 5–95%） */
  band?: [number, number];
  label: string;
  testid?: string;
}) {
  const on = useGrow();
  const span = high - low || 1;
  const pos = (v: number) => `${Math.max(0, Math.min(1, (v - low) / span)) * 100}%`;
  return (
    <span class="rbar" role="img" aria-label={label} data-testid={testid}>
      {band ? <i class="rbar-band" style={{ left: pos(band[0]), width: `calc(${pos(band[1])} - ${pos(band[0])})` }} /> : null}
      {markers.map((m, i) => (
        <i key={i} class={`rbar-m ${m.kind ?? 'dot'}`} style={{ left: pos(m.v), background: m.color ?? 'var(--text-1)', opacity: on ? 1 : 0 }} title={m.label} />
      ))}
    </span>
  );
}

/** 發散橫條：以 0 為中線，正值往右（紅）、負值往左（綠）；max＝同一組資料的最大絕對值（共用尺度）。 */
export function DivergingBar({ value, max, tone = 'updown', label }: { value: number | null | undefined; max: number; tone?: 'updown' | 'plain'; label?: string }) {
  const on = useGrow();
  const v = value === null || value === undefined || !Number.isFinite(value) || !max ? 0 : Math.max(-1, Math.min(1, value / max));
  const color = tone === 'plain' ? 'var(--c-blue)' : v >= 0 ? 'var(--up)' : 'var(--down)';
  return (
    <span class="dbar" role="img" aria-label={label ?? ''}>
      <i class="dbar-mid" />
      <i class={`dbar-fill ${v >= 0 ? 'pos' : 'neg'}`} style={{ background: color, transform: `scaleX(${on ? Math.abs(v) : 0})` }} />
    </span>
  );
}

/** 迷你折線（平滑、帶柔光）：base＝虛線基準（例：前收或起始值）；color 依方向。 */
export function MiniLine({ values, w = 72, h = 28, base, color, lines, testid }: {
  values: (number | null)[] | null | undefined;
  w?: number; h?: number;
  base?: number | null;
  color?: string;
  /** 額外的線（例：均線）：同一個 Y 軸 */
  lines?: { values: (number | null)[]; color: string }[];
  testid?: string;
}) {
  const v = (values ?? []).filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return <svg class="mini" width={w} height={h} aria-hidden="true" data-testid={testid} />;
  const extra = (lines ?? []).flatMap((l) => l.values.filter((x): x is number => x !== null && Number.isFinite(x)));
  const f = { w, h, padX: 2, padY: 3 };
  const all = [...v, ...extra];
  const range = extent(all, base ?? null);
  const dir = v[v.length - 1] - (base ?? v[0]);
  const c = color ?? (dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--text-2)');
  const d = smoothD(points(v, f, range));
  return (
    <svg class="mini" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-testid={testid}>
      {base !== undefined && base !== null ? <line class="chart-base" x1={2} x2={w - 2} y1={yOf(base, f, range)} y2={yOf(base, f, range)} /> : null}
      {(lines ?? []).map((l, i) => {
        const lv = l.values.map((x) => (x === null || !Number.isFinite(x) ? null : x));
        const pts = points(lv.map((x) => x ?? NaN), f, range).filter((_, k) => lv[k] !== null);
        return <path key={i} d={smoothD(pts)} fill="none" stroke={l.color} stroke-width={1} opacity={0.9} />;
      })}
      <path d={d} fill="none" stroke={c} stroke-width={3} opacity={0.25} stroke-linejoin="round" stroke-linecap="round" />
      <path d={d} fill="none" stroke={c} stroke-width={1.5} stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}

/**
 * 環（0–100）：四種強調色之一；進頁時由 0 填到分數（400ms）。中間顯示分數，下方小字（例「資料 80%」）。
 */
export function Ring({ value, color = 'var(--c-blue)', size = 72, stroke = 6, sub, label, onClick, testid }: {
  value: number | null | undefined; color?: string; size?: number; stroke?: number; sub?: Kids; label: string; onClick?: () => void; testid?: string;
}) {
  const on = useGrow();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const body = (
    <>
      <span class="ring2-svg" style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" stroke-width={stroke} />
          {v !== null ? (
            <circle class="ring2-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} stroke-width={stroke} stroke-linecap="round"
              stroke-dasharray={`${c} ${c}`} style={{ strokeDashoffset: on ? c * (1 - v / 100) : c }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          ) : null}
        </svg>
        <span class="ring2-num">{v === null ? '—' : Math.round(v)}</span>
      </span>
      <span class="ring2-label">{label}</span>
      {sub ? <span class="ring2-sub">{sub}</span> : null}
    </>
  );
  const aria = `${label} ${v === null ? '無資料' : `${Math.round(v)} 分`}`;
  if (onClick) return <button type="button" class="ring2 ui-tap" onClick={onClick} aria-label={aria} data-testid={testid}>{body}</button>;
  return <span class="ring2" role="img" aria-label={aria} data-testid={testid}>{body}</span>;
}

// ---------------------------------------------------------------- 骨架與四種資料狀態

/** 骨架（載入中）：與實際內容同高的灰塊＋微光；減少動態效果時沒有微光。 */
export function Skeleton({ lines = 3, height, testid }: { lines?: number; height?: string; testid?: string }) {
  return (
    <div class="skel" aria-busy="true" aria-label="載入中" data-testid={testid ?? 'skeleton'}>
      {height ? <i style={{ height }} /> : Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: i === lines - 1 ? '60%' : '100%' }} />)}
    </div>
  );
}

export type DataPhase = 'loading' | 'empty' | 'stale' | 'error' | 'ok';

/**
 * 資料區塊的四種狀態（F 節）：載入中（骨架＋微光）、無資料（一行原因）、資料落後（橘色提示，可點進資料健康頁）、
 * 載入失敗（一行說明＋重試）。ok 或 stale 時照常顯示內容（stale 另加提示列）。不得出現空白區塊或無限轉圈。
 */
export function DataState({ phase, reason, stale, onRetry, skeleton, children, testid }: {
  phase: DataPhase;
  /** 無資料或載入失敗的原因（一行） */
  reason?: Kids;
  /** 資料落後：落後的資料集與日期（例「三大法人 10/1」） */
  stale?: Kids;
  onRetry?: () => void;
  skeleton?: Kids;
  children?: Kids;
  testid?: string;
}) {
  if (phase === 'loading') return <div data-testid={testid} data-phase="loading">{skeleton ?? <Skeleton />}</div>;
  if (phase === 'empty') return <p class="ds-line" data-testid={testid} data-phase="empty">{reason ?? '目前沒有資料'}</p>;
  if (phase === 'error') {
    return (
      <p class="ds-line ds-error" data-testid={testid} data-phase="error" role="status">
        <span>{reason ?? '這部分資料暫時無法取得'}</span>
        {onRetry ? <button type="button" class="ds-retry" onClick={onRetry}>重試</button> : null}
      </p>
    );
  }
  return (
    <div data-testid={testid} data-phase={phase}>
      {phase === 'stale' ? <StaleNote>{stale}</StaleNote> : null}
      {children}
    </div>
  );
}

/** 資料落後提示（沿用改版前「資料可能過期」的橘色提示樣式）：點進資料健康頁看原因。 */
export function StaleNote({ children, lead = '資料落後' }: { children?: Kids; lead?: string }) {
  return (
    <a class="stale-note" href="#/me/health" data-testid="stale-note">
      <span class="stale-text"><span class="stale-lead">{lead}</span>{' '}{children ?? '部分資料集未更新'}</span>
      <IconChevron />
    </a>
  );
}

// ---------------------------------------------------------------- 滾動數字

/**
 * 數值滾動（400ms，ease-out）：值改變時從舊值滾到新值；第一次掛載時從 from（例：區間起始價）滾到目標。
 * format 決定小數位與單位；減少動態效果時直接顯示。
 */
export function RollNum({ value, format, from, testid, label }: { value: number | null | undefined; format: (v: number) => string; from?: number | null; testid?: string; label?: string }) {
  const [shown, setShown] = useState<number | null>(value === null || value === undefined ? null : from ?? value);
  const prev = useRef<number | null>(from ?? null);
  useEffect(() => {
    if (value === null || value === undefined || !Number.isFinite(value)) { setShown(null); return; }
    const start = prev.current ?? shown ?? value;
    prev.current = value;
    if (reduceMotion() || start === value) { setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 400);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const text = shown === null ? '—' : format(shown);
  const final = value === null || value === undefined ? '—' : format(value);
  return <span class="roll" data-testid={testid} aria-label={label ? `${label} ${final}` : final}><span aria-hidden="true">{text}</span></span>;
}

/**
 * 價格軸（簡報市場分段的趨勢卡）：一條水平軸標出各均線與現值的位置；標籤上下交錯、互不重疊，不壓到軸。
 */
export function LevelAxis({ levels, format, label, testid }: {
  levels: { name: string; v: number | null | undefined; color: string; main?: boolean }[];
  format: (v: number) => string;
  label: string;
  testid?: string;
}) {
  const on = useGrow();
  const box = useRef<HTMLDivElement>(null);
  // 標籤位置：先量實際寬度，再依序放進「上 1、下 1、上 2、下 2」中第一個不重疊的位置（數值相近的均線不互相覆蓋）
  const [slots, setSlots] = useState<number[]>([]);
  const pts = levels.filter((l): l is { name: string; v: number; color: string; main?: boolean } => typeof l.v === 'number' && Number.isFinite(l.v));
  const key = pts.map((p) => `${p.name}:${p.v}`).join('|');
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const labels = [...el.querySelectorAll<HTMLElement>('.laxis-l')];
      const placed: { l: number; r: number }[][] = [[], [], [], []];
      const next = labels.map((lab) => {
        const r = lab.getBoundingClientRect();
        // 目前所在位置的水平範圍（垂直位置不影響寬度）
        const span = { l: r.left - 6, r: r.right + 6 };
        const slot = placed.findIndex((row) => row.every((o) => span.r <= o.l || span.l >= o.r));
        const k = slot < 0 ? 0 : slot;
        placed[k].push(span);
        return k;
      });
      setSlots((prev) => (prev.join() === next.join() ? prev : next));
    };
    place();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [key]);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const pad = (hi - lo) * 0.08 || 1;
  const pos = (v: number) => ((v - lo + pad) / (hi - lo + 2 * pad)) * 100;
  const sorted = [...pts].sort((a, b) => a.v - b.v);
  const tiers = Math.max(1, ...slots.map((k) => (k >> 1) + 1));
  return (
    <div ref={box} class="laxis" role="img" aria-label={`${label}：${sorted.map((p) => `${p.name} ${format(p.v)}`).join('、')}`} data-testid={testid}
      style={{ '--tiers': tiers } as JSX.CSSProperties}>
      <i class="laxis-track" />
      {sorted.map((p, i) => {
        const k = slots[i] ?? 0;
        return (
          <span key={p.name} class={`laxis-m ${k % 2 ? 'below' : 'above'} ${p.main ? 'main' : ''} ${pos(p.v) < 22 ? 'edge-l' : pos(p.v) > 78 ? 'edge-r' : ''}`}
            style={{ left: `${pos(p.v)}%`, opacity: on ? 1 : 0, '--c': p.color, '--lv': k >> 1 } as JSX.CSSProperties}>
            <i aria-hidden="true" />
            <span class="laxis-l" aria-hidden="true"><span class="laxis-n">{p.name}</span> {format(p.v)}</span>
          </span>
        );
      })}
    </div>
  );
}
