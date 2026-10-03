/**
 * 個股籌碼：區間統計卡（1／3／5／10／20／60 日）與「每日籌碼」（預設展開；法人｜信用｜借券當沖）。
 * 數字一律等寬、千分位；正負同時以紅綠色與 ▲▼ 表示（買超、增加為紅）。定義見 METHODOLOGY §4.7.1。
 */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ALL_COLS,
  type ChipBlock,
  type ChipRow,
  DAY_FIELDS,
  INSTI_FOOTNOTE,
  PARTY_HEAD,
  type ColFormat,
  type Unit,
  UNIT_LABEL,
  VIEWS,
  VIEW_COLS,
  VIEW_LABEL,
  type View,
  type ViewCol,
  cellPhrase,
  cellText,
  chipRows,
  viewFormats,
  tableUnitLabel,
  colStreak,
  colTotal,
  colUnit,
  colValue,
  concentration,
  dayText,
  missingNotes,
  officialLinks,
  rangeSentence,
  rangeStats,
  recent,
  rowSentence,
  spokenDate,
  streakText,
  toCsv,
} from '../lib/chips';
import { uiConfig } from '../lib/config';
import { getSetting, setSetting } from '../db/db';
import { arrow, dirClass, direction, fmtNum, fmtPrice, missing } from '../lib/format';
import { IconChevronDown, IconMore } from './Icons';
import { MetricGrid } from './Metrics';
import { Sheet } from './Sheet';

/** 帶正負的數字：顏色＋▲▼＋絕對值（0 與四捨五入後為 0 者不加符號）。 */
export function Sig({ v, digits, suffix = '' }: { v: number | null | undefined; digits: number; suffix?: string }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span class="muted">—</span>;
  const r = Number(v.toFixed(digits));
  const d = direction(r);
  const abs = fmtNum(Math.abs(r), digits);
  return (
    <span class={`num ${d}`}>
      <span aria-hidden="true">{d === 'flat' ? abs : `${arrow(r)}${abs}`}{suffix}</span>
      <span class="sr-only">{d === 'up' ? '正 ' : d === 'down' ? '負 ' : ''}{abs}{suffix}</span>
    </span>
  );
}

function Segmented<T extends string | number>({ label, value, options, onPick, format }: {
  label: string; value: T; options: readonly T[]; onPick: (v: T) => void; format: (v: T) => string;
}) {
  return (
    <div class="segmented chip-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={String(o)} aria-pressed={o === value} onClick={() => onPick(o)}>{format(o)}</button>)}
    </div>
  );
}

// ------------------------------------------------------------------ 區間統計卡
/*
 * M2（2026-10-03）：欄位改為 5 欄——外資、投信、自營商（自行買賣）、自營商（避險）、三大法人合計。
 * 5 欄數字在 375pt 放不下左側的列標題欄，所以每個項目分成兩列：第一列是跨欄的列標題（含單位小字），第二列是 5 個數字；
 * 不加左右捲動、不縮小字級、不縮寫張數（M3）。
 */
export function ChipStats({ block, sharesOut }: { block: ChipBlock; sharesOut: number | null | undefined }) {
  const cfg = uiConfig.chip;
  const [days, setDays] = useState(cfg.stats_default);
  const s = useMemo(() => rangeStats(block, days, sharesOut), [block, days, sharesOut]);
  // U-04：單位放在列標題下方的小字（不放括號、不讓單位被擠到下一行）
  const rows: { label: string; unit?: string; name?: string; cell: (p: (typeof s.parties)[number]) => ComponentChildren }[] = [
    { label: '買賣超', name: '買賣超（張）', cell: (p) => <Sig v={p.lots} digits={0} /> },
    { label: '佔成交量', unit: '%・區間', name: '佔區間成交量（%）', cell: (p) => <Sig v={p.pctVolume} digits={2} /> },
    { label: '佔股本', unit: '%', name: '佔股本（%）', cell: (p) => <Sig v={p.pctCapital} digits={3} /> },
    { label: '估計成本', unit: '元・估', name: '估計成本（元・估）', cell: (p) => <span class="num">{fmtPrice(p.cost)}</span> },
    { label: '現價比成本', unit: '%', name: '現價相對成本（%）', cell: (p) => <Sig v={p.costRel} digits={1} /> },
    { label: '目前連續', cell: (p) => <span class="caption">{streakText(p.streak, block.d.length - 1)}</span> },
  ];
  const n = s.parties.length;
  return (
    <div class="card chip-stats-card" aria-label="籌碼區間統計">
      <div class="row between" style={{ gap: 'var(--s-2)' }}>
        <span class="body w6">區間統計</span>
        <span class="caption muted">{s.start && s.end ? `${s.start}～${s.end}` : missing('沒有資料')}</span>
      </div>
      <div style={{ marginTop: 'var(--s-3)' }}>
        <Segmented label="統計天數" value={days} options={cfg.stats_periods} onPick={setDays} format={(n) => `${n} 日`} />
      </div>
      <p class="body t1" style={{ marginTop: 'var(--s-3)' }} data-testid="chip-sentence">{rangeSentence(s)}</p>
      <div class="cs-unit caption" data-testid="chip-stats-unit">單位：張</div>
      <div>
        <table class="chip-stats" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {s.parties.map((p) => {
                const [main, sub] = PARTY_HEAD[p.key];
                return (
                  <th key={p.key} scope="col">
                    <span aria-label={p.label}>{main}<span class="th-unit" aria-hidden="true">{sub || ' '}</span></span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.label}>
                <tr class="cs-label"><th scope="row" colSpan={n} aria-label={r.name} style={{ textAlign: 'left', borderBottom: 0, paddingBottom: 0 }}>{r.label}{r.unit ? <span class="th-unit">{r.unit}</span> : null}</th></tr>
                {/* 欄寬固定均分；數字只在極端情況（區間合計 ≥ 100 萬張）才會被裁切，完整數值仍在螢幕閱讀器文字裡 */}
                <tr>{s.parties.map((p) => <td key={p.key} style={{ padding: 'var(--s-2) 2px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cell(p)}</td>)}</tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        收盤 {fmtPrice(s.close)}・區間漲跌 <Sig v={s.change} digits={2} suffix="%" />・區間成交 {fmtNum(s.volumeLots, 0)} 張。
        自營商拆成自行買賣與避險（兩者相加＝官方自營商）；外資含外資自營商；三大法人合計為官方數字。
        百分比與成本各自標在列名下方；估計成本＝區間內淨買超日的（還原）均價加權，只在區間合計為淨買超時顯示；股本以最新已發行股數計。
      </p>
      <Concentration block={block} />
    </div>
  );
}

/**
 * 法人集中度（非分點；M2 2026-10-03）：5／20／60 日三大法人合計淨買賣超 ÷ 同期成交量（%）。
 * 紅 ▲＝合計買超、綠 ▼＝合計賣超；資料不足 N 日時寫出目前只有幾日（不留白）。
 */
export function Concentration({ block }: { block: ChipBlock }) {
  const items = useMemo(() => concentration(block), [block]);
  return (
    <section aria-label="法人集中度（非分點）" data-testid="chip-concentration" style={{ marginTop: 'var(--s-4)' }}>
      <div class="row between" style={{ gap: 'var(--s-2)' }}>
        <span class="body w6">法人集中度（非分點）</span>
        <span class="caption muted">三大法人合計 ÷ 成交量</span>
      </div>
      <MetricGrid cols={3} label="法人集中度" items={items.map((c) => ({
        k: `${c.days} 日`,
        v: c.pct === null ? <span class="muted">{missing(c.available ? '區間內沒有三大法人資料' : '沒有資料')}</span> : <Sig v={c.pct} digits={2} suffix="%" />,
        sub: c.available < c.days
          ? `資料累積中：目前只有 ${c.available} 日${c.start ? `（自 ${mdLabel(c.start)} 起）` : ''}`
          : c.withData < c.available ? `${c.withData}／${c.available} 日有法人資料` : c.start && c.end ? `${mdLabel(c.start)}–${mdLabel(c.end)}` : undefined,
      }))} />
      <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>
        這裡的集中度＝三大法人合計淨買賣超股數 ÷ 同期成交股數（只計有法人資料的日子），不是券商分點的買賣集中度；分點進出資料的官方查詢頁有驗證碼，依規則不提供（METHODOLOGY §4.7.1）。
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ 每日籌碼（依 Apple HIG 重新設計）
/*
 * - 預設展開；手動收合後記住（IndexedDB 設定 chipDailyOpen）。
 * - 一排控制列：期間分段控制（左）＋「單位」下拉選單（右）；表格上方的檢視分段控制：法人｜信用｜借券當沖。
 * - 每種檢視固定 4 個資料欄＋日期欄（收盤與漲跌以小字放在日期下方），表格寬度固定、不需要左右滑動。
 * - 版面依實際量到的文字寬度決定：放得下 → 表格；字級放大（Dynamic Type）放不下 → 卡片；
 *   橫向或平板寬度放得下 12 欄 → 同時顯示全部欄位（不需要切換檢視）。
 * - 點任一列從底部拉出當天完整資料；「複製為 CSV」在右上角「⋯」選單。
 */
const OPEN_KEY = 'chipDailyOpen';
/** 表格數字字級（px）：15 放不下依序降到 14、13（最低 13，不得再小；同一張表同一字級） */
export const FONT_STEPS = [15, 14, 13];
type Mode = 'table' | 'cards' | 'all';

/** 表格日期：MM/DD（不顯示年份與星期；固定寬度，逐列對齊） */
export function mdLabel(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}
function weekday(iso: string): string {
  return '日一二三四五六'[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}
/** 日期下方的小字：「176.0 ▼2.49%」 */
export function priceLine(r: Pick<ChipRow, 'close' | 'chgPct'>): { price: string; chg: string; dir: string } {
  const d = direction(r.chgPct);
  return { price: fmtPrice(r.close), chg: r.chgPct === null ? '' : `${arrow(r.chgPct)}${Math.abs(r.chgPct).toFixed(2)}%`, dir: d };
}

/**
 * Dynamic Type：iOS 的 `font: -apple-system-body` 會跟著系統字級（預設 17pt）；換算成比例 --dt 套在表格字級上。
 * 其他平台（或不支援）為 1，只跟著瀏覽器的預設字級（rem）。
 */
export function useDynamicTypeScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (typeof CSS === 'undefined' || !CSS.supports('font', '-apple-system-body')) return;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body';
    document.body.appendChild(probe);
    const read = () => setScale(Math.max(0.8, parseFloat(getComputedStyle(probe).fontSize) / 17 || 1));
    read();
    document.addEventListener('visibilitychange', read);
    return () => { document.removeEventListener('visibilitychange', read); probe.remove(); };
  }, []);
  return scale;
}

/** 量測每欄最長的文字，決定表格／卡片／全部欄位；容器或字級改變時重算。 */
function useChipLayout(
  bodyRef: { current: HTMLElement | null },
  measureRef: { current: HTMLElement | null },
  wideRef: { current: HTMLElement | null },
  texts: { date: string[]; sub: string[]; cols: Record<string, string[]>; heads: Record<string, string[]> },
  view: View,
  deps: unknown[],
): { mode: Mode; dateW: number; fs: number } {
  const [state, setState] = useState<{ mode: Mode; dateW: number; fs: number }>({ mode: 'table', dateW: 72, fs: FONT_STEPS[0] });
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const m = measureRef.current;
    if (!body || !m) return;
    const longest = (arr: string[]) => [...arr].sort((a, b) => b.length - a.length).slice(0, 4);
    // 以 canvas 量字（不觸發版面計算）；字型取自與儲存格同 class 的隱藏元素。
    // canvas 不套用 tabular-nums，因此把數字都換成「0」（Inter 的等寬數字與 0 同寬），再留 2px 餘裕。
    const ctx = document.createElement('canvas').getContext('2d');
    const fonts = new Map<string, string>();
    const fontOf = (cls: string) => {
      if (!fonts.has(cls)) {
        m.className = `cd-measure ${cls}`;
        const cs = getComputedStyle(m);
        fonts.set(cls, `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
      }
      return fonts.get(cls)!;
    };
    const measure = (arr: string[], cls: string) => {
      if (!ctx) return 0;
      let max = 0;
      for (const t of longest(arr)) {
        ctx.font = fontOf(cls);
        max = Math.max(max, ctx.measureText(t.replace(/\d/g, '0')).width + 2);
      }
      return max;
    };
    const compute = () => {
      const W = body.clientWidth;
      if (!W) return;
      fonts.clear(); // 字級（Dynamic Type）可能改變
      const pad = 6; // 儲存格左右內距合計（日期欄另有左邊 8px）
      // 日期欄：MM/DD；下方收盤與漲跌分成兩行（M3：讓 402／375px 放得下完整千分位張數）
      const dateW = Math.ceil(Math.max(52, measure(texts.date, 'cd-date') + pad + 5, measure(texts.sub, 'cd-sub') + pad + 5));
      // 欄寬只看數字與標題下方的小字（標題本身可以折成兩行）
      // 數字欄寬＝最長數字（含逗號與正負號）的等寬寬度 ＋ 8px（UI_GUIDE）；字級 15 → 14 → 13px 逐級嘗試（同一張表同一字級）
      const basePx = parseFloat(getComputedStyle((m.className = 'cd-measure cd-v', m)).fontSize) || 15;
      let scale = 1;
      // 欄名與標題下方的連續天數過長時換成兩行，不加寬欄位（UI_GUIDE §7-4），所以欄寬只看數字
      const need = (keys: string[]) => Math.max(...keys.map((k) => (texts.cols[k] ? measure(texts.cols[k], 'cd-v') * scale + 8 : Infinity)));
      const viewKeys = VIEW_COLS[view].map((c) => c.key);
      const allKeys = ALL_COLS.map((c) => c.key);
      const vw = document.documentElement.clientWidth;
      const wideW = wideRef.current?.getBoundingClientRect().width ?? W;
      const wideAllowed = vw > window.innerHeight || vw >= 768;
      let mode: Mode = 'cards';
      let fs = FONT_STEPS[FONT_STEPS.length - 1];
      // 字級跟著 Dynamic Type（--dt）與瀏覽器／系統文字大小（rem）一起放大
      const dt = (parseFloat(getComputedStyle(body).getPropertyValue('--dt')) || 1) * ((parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16);
      // 橫向或平板：先試全部欄位（15 → 13px）；否則（或放不下）試單一檢視（15 → 13px）；都不行 → 卡片
      const fits = (keys: string[], n: number, width: number) => FONT_STEPS.find((step) => {
        scale = (step * dt) / basePx;
        return dateW + n * need(keys) <= width;
      });
      const allFs = wideAllowed ? fits(allKeys, 12, Math.max(W, wideW)) : undefined;
      const viewFs = allFs === undefined ? fits(viewKeys, 4, W) : undefined;
      if (allFs !== undefined) { mode = 'all'; fs = allFs; } else if (viewFs !== undefined) { mode = 'table'; fs = viewFs; }
      setState((s) => (s.mode === mode && s.dateW === dateW && s.fs === fs ? s : { mode, dateW, fs }));
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(body);
    window.addEventListener('resize', compute);
    document.fonts?.ready.then(compute).catch(() => undefined);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, deps);
  return state;
}

/** 右上角「⋯」選單（HIG pull-down menu）。 */
export function MoreMenu({ items, label = '每日籌碼的更多動作' }: { items: { label: string; onSelect: () => void }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div class="cd-more" ref={ref}>
      <button class="icon-btn" aria-label="更多動作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><IconMore /></button>
      {open ? (
        <div class="cd-menu" role="menu" aria-label={label}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" class="cd-menuitem" onClick={() => { setOpen(false); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 儲存格（v3）：數字靠右、整欄同一種格式（小數點對齊、等寬數字）；▲▼ 縮小並與數字底部對齊。
 * 舊版每格下方的比例條與靠右的數字對不齊，已移除，改為表格上方的法人買賣超柱狀圖。
 */
function Cell({ v, col, unit, fmt, signed }: { v: N; col: ViewCol; unit: Unit; fmt: ColFormat; signed?: boolean }) {
  const isSigned = signed ?? col.signed;
  const t = cellText(v, col, unit, isSigned, fmt);
  return (
    <td class={`cd-v ${t.dir}`}>
      <span class="cd-t" aria-hidden="true">{t.arrow ? <span class="cd-arrow">{t.arrow}</span> : null}{t.body}</span>
      <span class="sr-only">{cellPhrase(v, col, unit, isSigned)}</span>
    </td>
  );
}

/**
 * 表格上方的精簡柱狀圖：所選期間三大法人每日買賣超（張），舊到新；紅＝買超、綠＝賣超，以 0 為中線。
 * 只給趨勢感，精確數字看下方表格（整張圖是一個 role=img，說明含合計與最大值）。
 */
export function MiniNetBars({ rows }: { rows: ChipRow[] }) {
  const vals = [...rows].reverse().map((r) => (r.total === null ? null : r.total / 1000));
  const max = Math.max(0, ...vals.map((v) => Math.abs(v ?? 0)));
  if (!vals.length || !max) return null;
  const sum = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  const f = (v: number) => `${fmtNum(Math.round(v), 0)} 張`;
  return (
    <figure class="cd-mini" role="img" aria-label={`三大法人近 ${vals.length} 日每日買賣超柱狀圖：合計${sum >= 0 ? '買超' : '賣超'} ${f(Math.abs(sum))}，單日最大 ${f(max)}`}>
      <div class="cd-mini-bars" aria-hidden="true">
        {vals.map((v, i) => (
          <span key={i} class="cd-mini-slot">
            {v ? <span class={`cd-mini-bar ${dirClass(v)}`} style={{ height: `${(Math.abs(v) / max) * 50}%` }} /> : null}
          </span>
        ))}
      </div>
      <figcaption class="cd-mini-cap" aria-hidden="true">
        <span>三大法人每日買賣超</span>
        <span>最大 {f(max)}</span>
      </figcaption>
    </figure>
  );
}

type N = number | null;

/** 區塊接近畫面（600px 內）或瀏覽器閒置時才渲染明細：個股頁首次載入不被畫面外的表格拖慢。 */
function useNearViewport(ref: { current: HTMLElement | null }): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '600px 0px' });
    io.observe(el);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = w.requestIdleCallback ? w.requestIdleCallback(() => setNear(true), { timeout: 2000 }) : window.setTimeout(() => setNear(true), 1200);
    return () => { io.disconnect(); if (w.cancelIdleCallback) w.cancelIdleCallback(idle); else clearTimeout(idle); };
  }, [near]);
  return near;
}

export function ChipDaily({ block, code, name, market }: { block: ChipBlock; code: string; name: string; market: string | null | undefined }) {
  const cfg = uiConfig.chip;
  const [open, setOpenState] = useState(true);
  const [days, setDays] = useState(cfg.table_default);
  // M3：籌碼數字一律以張為唯一單位（移除 億元／佔量 % 與萬張切換）
  const unit: Unit = 'lots';
  const [view, setView] = useState<View>('insti');
  const [day, setDay] = useState<ChipRow | null>(null);
  const [status, setStatus] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const wideRef = useRef<HTMLDivElement>(null);
  const dt = useDynamicTypeScale();
  const sectionRef = useRef<HTMLElement>(null);
  const near = useNearViewport(sectionRef);

  useEffect(() => { getSetting<boolean>(OPEN_KEY, true).then(setOpenState).catch(() => undefined); }, []);
  const setOpen = (v: boolean) => { setOpenState(v); setSetting(OPEN_KEY, v).catch(() => undefined); };

  const all = useMemo(() => chipRows(block), [block]);
  const rows = recent(all, days);
  const available = all.length - 1;

  // 表格格式（#6）：含區間合計列，整張表同一種單位只用一種格式（張一律千分位整數）
  const fmts = useMemo(() => viewFormats(Object.fromEntries(ALL_COLS.map((c) => [
    c.key, [...rows.map((r) => colValue(r, c, unit)), colTotal(rows, all, c, unit)],
  ])), unit), [rows, all, unit]);
  // 量測用的文字（每欄最長的值、標題、連續天數）
  const texts = useMemo(() => {
    const cols: Record<string, string[]> = {};
    const heads: Record<string, string[]> = {};
    // 只有橫向或平板寬度才可能同時顯示 12 欄；手機直向只量目前檢視的 4 欄
    const wideAllowed = window.innerWidth > window.innerHeight || window.innerWidth >= 768;
    for (const c of wideAllowed ? ALL_COLS : VIEW_COLS[view]) {
      const f = fmts[c.key];
      const vals = rows.map((r) => cellText(colValue(r, c, unit), c, unit, c.signed, f).text);
      vals.push(cellText(colTotal(rows, all, c, unit), c, unit, c.kind === 'level' ? true : c.signed, f).text);
      cols[c.key] = vals;
      heads[c.key] = c.party ? [streakText(colStreak(all, c), available)] : ['張'];
    }
    return {
      date: ['區間合計', ...rows.map((r) => mdLabel(r.date))],
      sub: rows.flatMap((r) => { const p = priceLine(r); return [p.price, p.chg]; }),
      cols,
      heads,
    };
  }, [rows, all, unit, view, fmts]);
  const { mode, dateW, fs } = useChipLayout(bodyRef, measureRef, wideRef, texts, view, [texts, view, open, near, dt]);
  const cols = mode === 'all' ? ALL_COLS : VIEW_COLS[view];

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(ok);
    } catch {
      setStatus('瀏覽器不允許寫入剪貼簿；請改用桌面瀏覽器或允許剪貼簿權限。');
    }
  }
  const copyCsv = () => copy(toCsv(rows, unit, { code, name }), `已複製 CSV（${rows.length} 日，單位：${UNIT_LABEL[unit]}）`);
  // 表格上方的單位說明跟著實際顯示的單位（#6：整張表改成萬張時不能還寫「張」）
  const unitLabel = tableUnitLabel(unit, fmts, mode === 'all' ? VIEWS : [view]);

  // 法人欄的標題下方寫連買／連賣天數（單位只在表格右上角出現一次）
  const subFor = (c: ViewCol) => (c.party ? streakText(colStreak(all, c), available) : '');
  const notes = missingNotes(rows);
  const period = rows.length ? `${mdLabel(rows[rows.length - 1].date)}–${mdLabel(rows[0].date)}` : '';

  return (
    <section class="chip-daily" ref={sectionRef} aria-labelledby="chip-daily-title" style={{ ['--dt' as string]: dt, ['--cd-fs' as string]: `${fs / 16}rem` }}>
      <div class="cd-head">
        <h3 class="cd-title" id="chip-daily-title">
          <button class="cd-toggle" aria-expanded={open} aria-controls="chip-daily-body" onClick={() => setOpen(!open)}>
            <span class="section">每日籌碼</span>
            <IconChevronDown />
          </button>
        </h3>
        <MoreMenu items={[{ label: '複製為 CSV', onSelect: copyCsv }]} />
      </div>
      <p class="sr-only" role="status" aria-live="polite">{status}</p>
      {status ? <p class="caption muted cd-status">{status}</p> : null}

      {open && !near ? <div class="skeleton cd-placeholder" aria-hidden="true" /> : null}
      {open && near ? (
        <div id="chip-daily-body" ref={bodyRef}>
          <div class="cd-controls">
            <div class="segmented chip-seg cd-periods" role="group" aria-label="明細期間">
              {cfg.table_periods.map((n) => <button key={n} aria-pressed={n === days} onClick={() => setDays(n)}>{n} 日</button>)}
            </div>
          </div>
          {mode !== 'all' ? (
            <div class="segmented cd-views" role="group" aria-label="檢視">
              {VIEWS.map((v) => <button key={v} aria-pressed={v === view} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>)}
            </div>
          ) : null}
          {view === 'insti' || mode === 'all' ? <MiniNetBars rows={rows} /> : null}
          <div class="cd-meta">
            <span>{rows.length} 日{period ? `・${period}` : ''}・{mode === 'cards' ? '點卡片' : '點一列'}看當天完整資料</span>
            <span class="cd-unit-label" data-testid="chip-unit-label">單位：{unitLabel}</span>
          </div>
          {view === 'insti' || mode === 'all' ? <p class="caption muted" data-testid="insti-footnote" style={{ margin: '0 0 var(--s-2)' }}>{INSTI_FOOTNOTE}；三大法人合計為官方數字，等於外資＋投信＋自營商。</p> : null}

          <div class="cd-wide-probe" ref={wideRef} aria-hidden="true" />
          <span class="cd-measure" ref={measureRef} aria-hidden="true" />

          {mode === 'cards' ? (
            <ul class="cd-cards" aria-label={`每日籌碼明細・${VIEW_LABEL[view]}`} data-mode="cards">
              <li class="cd-card total">
                <span class="cd-card-head"><span class="cd-date">區間合計</span><span class="cd-sub">{rows.length} 日</span></span>
                <span class="cd-grid">
                  {cols.map((c) => {
                    const v = colTotal(rows, all, c, unit);
                    const signed = c.kind === 'level' ? true : c.signed;
                    const t = cellText(v, c, unit, signed);
                    return (
                      <span key={c.key} class="cd-cell"><span class="cd-k">{c.label}{c.party ? <span class="cd-sub"> {streakText(colStreak(all, c), available)}</span> : null}</span><span class={`cd-v ${t.dir}`} aria-hidden="true">{t.text}</span><span class="sr-only">{cellPhrase(v, c, unit, signed)}</span></span>
                    );
                  })}
                </span>
              </li>
              {rows.map((r) => {
                const p = priceLine(r);
                return (
                  <li key={r.date} class="cd-card day">
                    <span class="cd-card-head" aria-hidden="true">
                      <span class="cd-date">{mdLabel(r.date)}（{weekday(r.date)}）</span>
                      <span class="cd-sub">{p.price} <span class={p.dir}>{p.chg}</span></span>
                    </span>
                    <span class="cd-grid" aria-hidden="true">
                      {cols.map((c) => { const t = cellText(colValue(r, c, unit), c, unit); return <span key={c.key} class="cd-cell"><span class="cd-k">{c.label}</span><span class={`cd-v ${t.dir}`}>{t.text}</span></span>; })}
                    </span>
                    <button class="cd-rowbtn" aria-label={rowSentence(r, cols, unit)} aria-haspopup="dialog" onClick={() => setDay(r)} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div class={`cd-wrap ${mode === 'all' ? 'cd-wide' : ''}`} role="region" aria-label={`每日籌碼明細・${mode === 'all' ? '全部欄位' : VIEW_LABEL[view]}`} data-mode={mode}>
              {/* M3（UI_GUIDE §9）：≥ 10 列的長表加 .cd-long，表頭捲動時固定；短表（1／3／5 日）不固定 */}
              <table class={`cd-table${rows.length >= 10 ? ' cd-long' : ''}`}>
                <colgroup>
                  <col style={{ width: `${dateW}px` }} />
                  {cols.map((c) => <col key={c.key} />)}
                </colgroup>
                <thead>
                  {mode === 'all' ? (
                    <tr class="cd-groups">
                      <td />
                      {VIEWS.map((v) => <th key={v} scope="colgroup" colSpan={4}>{VIEW_LABEL[v]}</th>)}
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="col" class="cd-dh">日期</th>
                    {cols.map((c) => (
                      <th key={c.key} scope="col">
                        <span class="cd-h">{c.label}{c.full !== c.label ? <span class="sr-only">（{c.full}）</span> : null}</span>
                        <span class="cd-sub">{subFor(c) || '\u00a0'}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr class="total">
                    <th scope="row"><span class="cd-date">區間合計</span><span class="cd-sub">{rows.length} 日</span></th>
                    {cols.map((c) => <Cell key={c.key} v={colTotal(rows, all, c, unit)} col={c} unit={unit} fmt={fmts[c.key]} signed={c.kind === 'level' ? true : c.signed} />)}
                  </tr>
                  {rows.map((r) => {
                    const p = priceLine(r);
                    return (
                      <tr key={r.date} class="day" onClick={() => setDay(r)}>
                        <th scope="row" class="cd-rowhead">
                          <span class="cd-date" aria-hidden="true">{mdLabel(r.date)}</span>
                          <span class="cd-sub" aria-hidden="true">{p.price}<span class={`cd-chg ${p.dir}`}>{p.chg}</span></span>
                          {/* 透明按鈕蓋住整格（沒有可見文字，名稱就是完整句子；整列也可以點） */}
                          <button class="cd-rowbtn" aria-label={rowSentence(r, cols, unit)} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setDay(r); }} />
                        </th>
                        {cols.map((c) => <Cell key={c.key} v={colValue(r, c, unit)} col={c} unit={unit} fmt={fmts[c.key]} />)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <details class="tech cd-notes">
            <summary>欄位說明</summary>
            <p class="caption muted">
              單位一律為張（1,000 股，股數四捨五入到整數張），完整顯示千分位，不縮寫。
              外資＝外陸資（不含外資自營商）＋外資自營商；自營商＝自行買賣＋避險（拆分在當天完整資料）；三大法人合計為官方數字（＝外資＋投信＋自營商）。
              區間合計：數量欄先以股數相加再換算；餘額欄為區間增減；比率欄（券資比、當沖比率，%）為區間平均（當沖比率以成交量加權）。
              0 顯示「0」且不帶箭頭、沒有資料顯示「—」。紅色 ▲＝買超／增加、綠色 ▼＝賣超／減少。
            </p>
            {notes.length ? <p class="caption muted">「—」表示沒有資料：{notes.map((n) => `${n.label}（${n.reason}）`).join('；')}。</p> : null}
          </details>
        </div>
      ) : null}
      <p class="caption muted cd-foot">分點券商前 15 名、主力動向與籌碼集中度需要分點進出資料，官方查詢頁有驗證碼，因此不提供。</p>

      <DaySheet day={day} onClose={() => setDay(null)} unit={unit} market={market} onCopy={(r) => copy(dayText(r, unit, { code, name }), `已複製 ${spokenDate(r.date)}的資料`)} />
    </section>
  );
}

/** 點一列：底部面板顯示當天完整資料（含自營商避險、收盤、漲跌、成交量、官方資料來源）；extra 放在最前面（例：各法人買張／賣張）。 */
export function DaySheet({ day, onClose, unit, market, onCopy, extra }: {
  day: ChipRow | null; onClose: () => void; unit: Unit; market: string | null | undefined; onCopy: (r: ChipRow) => void; extra?: (r: ChipRow) => ComponentChildren;
}) {
  const [last, setLast] = useState<ChipRow | null>(day);
  useEffect(() => { if (day) setLast(day); }, [day]);
  const r = day ?? last;
  return (
    <Sheet open={!!day} onClose={onClose} detent="full" title={r ? `${spokenDate(r.date)}（${weekday(r.date)}）籌碼` : '當天籌碼'}>
      {r ? (
        <div class="cd-day">
          <dl class="cd-dl">
            <div><dt>收盤</dt><dd class="num">{fmtPrice(r.close)}</dd></div>
            <div><dt>漲跌</dt><dd><Sig v={r.chgPct} digits={2} suffix="%" /></dd></div>
            <div><dt>成交量</dt><dd class="num">{r.volume === null ? '—' : `${fmtNum(r.volume / 1000, 0)} 張`}</dd></div>
          </dl>
          {extra ? extra(r) : null}
          <p class="caption muted">以下單位：{UNIT_LABEL[unit]}（比率為 %）・{INSTI_FOOTNOTE}</p>
          {DAY_FIELDS.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 class="eyebrow cd-group">{g.group}</h3>
              <dl class="cd-dl">
                {g.cols.map((c) => {
                  const v = colValue(r, c, unit);
                  const t = cellText(v, c, unit);
                  const u = colUnit(c, unit);
                  return (
                    <div key={c.key}>
                      <dt>{c.full}{u === 'lots' && unit !== 'lots' ? <span class="caption muted">（張）</span> : null}</dt>
                      <dd class={`num ${t.dir}`}><span aria-hidden="true">{t.text}</span><span class="sr-only">{cellPhrase(v, c, unit)}</span></dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
          <h3 class="eyebrow cd-group">官方資料來源（{market === 'tpex' ? '櫃買中心' : '證交所'}，另開新頁）</h3>
          <div class="cd-links">
            {officialLinks(market, r.date).map((l) => <a key={l.url} class="caption" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
          </div>
          <button class="btn block" style={{ marginTop: 'var(--s-5)' }} onClick={() => onCopy(r)}>複製這天資料</button>
        </div>
      ) : null}
    </Sheet>
  );
}
