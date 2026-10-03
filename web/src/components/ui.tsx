/**
 * 共用 UI 元件（2026-10 改版）：區塊、卡片、列、帶號數值、標籤、ⓘ 說明、分段控制、表格、摘要格、空狀態、入口列。
 * 各頁只組合這些元件，不手刻版面、不加零散 margin；尺寸與顏色全部來自 styles/tokens.css，樣式在 styles/ui.css。
 *
 * 格線：區塊標題對齊頁邊 x=16；卡片內所有內容對齊 x=32。列用 CSS grid 固定欄模板：
 *   [圖示 24] 名稱 1fr ｜ 數值 auto ｜ [標籤 固定寬] ｜ [›]
 * 同一張卡片（List）的列共用同一組欄寬（has-tags／has-chev 由 List 指定），數值右緣一致；列內一律基線對齊。
 * 對齊稽核（web/scripts/align-audit.mjs）依賴這些 class 與 data-a 屬性：
 *   data-a="v"＝列的右側數值（同卡片右緣一致）、data-a="bl"＝同列需同基線的元素。
 */
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { IconChevron, IconInfo } from './Icons';
import { numberFormat } from '../lib/format';

type Kids = ComponentChildren;

// ---------------------------------------------------------------- 頁首、區塊、卡片

/** 頁面主標題（LargeTitle，每頁一個）與一行 Footnote 副資訊。 */
export function PageTitle({ title, sub, aside }: { title: Kids; sub?: Kids; aside?: Kids }) {
  return (
    <header class="ui-head">
      <div class="ui-head-row">
        <h1 class="ui-large">{title}</h1>
        {aside ? <span class="ui-head-aside">{aside}</span> : null}
      </div>
      {sub ? <div class="ui-foot ui-muted ui-head-sub">{sub}</div> : null}
    </header>
  );
}

/**
 * 區塊：名詞標題（Headline）＋可選的 ⓘ 與右側附註；內容通常是卡片。
 * info 是 ⓘ bottom sheet 的內容（公式、門檻、資料來源、方法說明一律放這裡）。
 */
export function Section({ title, info, infoTitle, aside, id, children, testid }: {
  title: Kids;
  info?: Kids;
  infoTitle?: string;
  aside?: Kids;
  id?: string;
  children?: Kids;
  testid?: string;
}) {
  return (
    <section class="ui-sec" id={id} data-testid={testid} aria-label={typeof title === 'string' ? title : undefined}>
      <div class="ui-sec-head">
        <h2 class="ui-sec-title">{title}</h2>
        {info ? <Info title={infoTitle ?? (typeof title === 'string' ? title : '說明')}>{info}</Info> : null}
        {aside ? <span class="ui-sec-aside ui-foot ui-muted">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** 不透明卡片（內距 16）。 */
export function Card({ children, class: cls, testid, label }: { children?: Kids; class?: string; testid?: string; label?: string }) {
  return <div class={`ui-card ${cls ?? ''}`} data-testid={testid} aria-label={label} role={label ? 'group' : undefined}>{children}</div>;
}

/** 卡片內的小標（Footnote、次文字色），例如「趨勢」「寬度」。 */
export function CardLabel({ children, aside }: { children: Kids; aside?: Kids }) {
  return <div class="ui-card-label ui-foot ui-muted"><span>{children}</span>{aside ? <span>{aside}</span> : null}</div>;
}

// ---------------------------------------------------------------- 列

/**
 * 列的容器（一張卡片）。tags：這張卡片有標籤欄（所有列保留同寬的標籤欄，數值右緣一致）；chev：列可點（保留 › 欄）。
 */
export function List({ children, tags = false, chev = false, extra = false, testid, label, class: cls }: {
  children?: Kids; tags?: boolean; chev?: boolean; /** 第三個右欄（例：RS 百分位） */ extra?: boolean; testid?: string; label?: string; class?: string;
}) {
  return (
    <div class={`ui-list ${tags ? 'has-tags' : ''} ${chev ? 'has-chev' : ''} ${extra ? 'has-extra' : ''} ${cls ?? ''}`} data-testid={testid} aria-label={label} role={label ? 'group' : undefined}>
      {children}
    </div>
  );
}

export interface RowProps {
  label: Kids;
  /** 副資訊（Footnote，最多一行） */
  sub?: Kids;
  /** 副資訊佔整列寬度（第二行橫跨所有欄；數值只有一行時用） */
  subWide?: boolean;
  /** 第三個右欄（List extra） */
  extra?: Kids;
  /** 可點但不顯示 ›（例：展開／收合列） */
  noChev?: boolean;
  value?: Kids;
  /** 數值下方的第二行（例：漲跌幅） */
  value2?: Kids;
  tag?: Kids;
  icon?: Kids;
  href?: string;
  onClick?: (e: MouseEvent) => void;
  testid?: string;
  /** 名稱用主文字色＋半粗體（預設一般字重） */
  strong?: boolean;
  ariaLabel?: string;
}

/** 一列：名稱｜數值｜標籤｜›（欄寬由 List 決定）。有 href／onClick 時整列可點（44 以上）。 */
export function Row({ label, sub, subWide, value, value2, tag, extra, icon, href, onClick, testid, strong, ariaLabel, noChev }: RowProps) {
  const inner = (
    <>
      {icon ? <span class="ui-row-icon" aria-hidden="true">{icon}</span> : null}
      <span class="ui-row-main">
        <span class={`ui-row-label ${strong ? 'ui-strong' : ''}`} data-a="bl">{label}</span>
        {sub && !subWide ? <span class="ui-row-sub ui-foot ui-muted">{sub}</span> : null}
      </span>
      <span class="ui-row-value" data-a="v">
        {value !== undefined ? <span class="ui-v" data-a="bl">{value}</span> : null}
        {value2 !== undefined ? <span class="ui-v2 ui-foot">{value2}</span> : null}
      </span>
      <span class="ui-row-tag">{tag ?? null}</span>
      <span class="ui-row-extra">{extra ?? null}</span>
      <span class="ui-row-chev" aria-hidden="true">{(href || onClick) && !noChev ? <IconChevron /> : null}</span>
      {sub && subWide ? <span class="ui-row-sub ui-row-subwide ui-foot ui-muted">{sub}</span> : null}
    </>
  );
  const cls = `ui-row ${icon ? 'has-icon' : ''} ${href || onClick ? 'ui-tap' : ''}`;
  if (href) return <a class={cls} href={href} onClick={onClick} data-testid={testid} aria-label={ariaLabel}>{inner}</a>;
  if (onClick) return <button type="button" class={cls} onClick={onClick} data-testid={testid} aria-label={ariaLabel}>{inner}</button>;
  return <div class={cls} data-testid={testid} aria-label={ariaLabel}>{inner}</div>;
}

/** 入口列：圖示｜標題｜副資訊｜›（流程頁、個股頁的子頁入口）。 */
export function NavRow({ icon, title, sub, href, onClick, testid, value }: { icon?: Kids; title: Kids; sub?: Kids; href?: string; onClick?: () => void; testid?: string; value?: Kids }) {
  return <Row icon={icon} label={title} sub={sub} href={href} onClick={onClick ? () => onClick() : undefined} testid={testid} value={value} />;
}

/** 卡片內單行的空狀態／說明（不留大片空白、不重複）。 */
export function EmptyRow({ children, testid }: { children: Kids; testid?: string }) {
  return <div class="ui-empty ui-foot ui-muted" data-testid={testid}>{children}</div>;
}

/** 單行橘色警示（例：某資料集落後）。 */
export function Warn({ children, testid }: { children: Kids; testid?: string }) {
  return <p class="ui-warn ui-foot" role="status" data-testid={testid}>{children}</p>;
}

// ---------------------------------------------------------------- 數值

const MINUS = '−';

/** 數值＋單位（不拆行）。digits 未指定時直接顯示字串。 */
export function Num({ v, digits = 0, unit, fallback = '—' }: { v: number | string | null | undefined; digits?: number; unit?: string; fallback?: string }) {
  const text = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? fallback : typeof v === 'number' ? numberFormat(digits).format(v) : v;
  return <span class="ui-num">{text}{unit && text !== fallback ? <Unit u={unit} /> : null}</span>;
}

/**
 * 帶號數值（全站唯一）：漲跌與買賣超。
 * - kind='arrow'：▲▼＋絕對值（價格漲跌、漲跌幅）；kind='sign'：+／−（買賣超、變化量、超額報酬）。
 * - tone='updown'（預設）：紅漲綠跌；'plain'：中性色（例：超額報酬、百分位變化，不是價格或買賣超）。
 * - 三角形大小、與數字的間距、垂直位置全站一致（.sv-a）。
 */
export function Signed({ v, digits = 2, unit, kind = 'sign', tone = 'updown', fallback = '—', label }: {
  v: number | null | undefined;
  digits?: number;
  unit?: string;
  kind?: 'arrow' | 'sign';
  tone?: 'updown' | 'plain';
  fallback?: string;
  /** VoiceOver 前綴，例如「外資」 */
  label?: string;
}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span class="sv flat">{fallback}</span>;
  const r = Number(numberFormat(digits).format(Math.abs(v)).replace(/,/g, ''));
  const d = r === 0 ? 'flat' : v > 0 ? 'up' : 'down';
  const abs = numberFormat(digits).format(Math.abs(v));
  const word = d === 'up' ? (kind === 'arrow' ? '上漲' : '增加') : d === 'down' ? (kind === 'arrow' ? '下跌' : '減少') : '持平';
  const cls = `sv ${tone === 'updown' ? d : 'plain'}`;
  return (
    <span class={cls}>
      <span class="sr-only">{`${label ?? ''}${word} ${abs}${unit ?? ''}`}</span>
      <span aria-hidden="true" class="sv-in">
        {kind === 'arrow'
          ? <><span class="sv-a">{d === 'up' ? '▲' : d === 'down' ? '▼' : ''}</span>{abs}</>
          : <>{d === 'up' ? '+' : d === 'down' ? MINUS : ''}{abs}</>}
        {unit ? <Unit u={unit} /> : null}
      </span>
    </span>
  );
}

/** 單位：%、×、bp 緊接數字；中文單位（張、億、元…）前留 4px。 */
function Unit({ u }: { u: string }) {
  return <span class={/^[%×]|^bp$/.test(u) ? 'ui-unit tight' : 'ui-unit'}>{u}</span>;
}

// ---------------------------------------------------------------- 標籤、ⓘ

export type TagTone = 'risk' | 'neutral' | 'strong';

/** 標籤（風險／中性／有利、觸發、分級）：固定最小寬、單行；不是按鈕，不用藍色或外框。 */
export function Tag({ tone = 'neutral', children, testid, title }: { tone?: TagTone; children: Kids; testid?: string; title?: string }) {
  return <span class={`ui-tag ${tone}`} data-testid={testid} title={title}>{children}</span>;
}

/** ⓘ：點開 bottom sheet（公式、門檻、資料來源、方法說明）。點擊區域 44×44。 */
export function Info({ title, children, label, testid }: { title: string; children: Kids; label?: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="ui-info" aria-label={label ?? `${title}的說明`} aria-haspopup="dialog" onClick={() => setOpen(true)} data-testid={testid}>
        <IconInfo />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div class="ui-prose">{children}</div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- 分段控制

export type SegOption<T extends string> = readonly [T, string];

/** 分段控制：每格等寬、單行；sticky 時黏在導覽列下方。 */
export function Seg<T extends string>({ options, value, onChange, label, sticky = false, testid, small = false }: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  sticky?: boolean;
  testid?: string;
  small?: boolean;
}) {
  const el = (
    <div class={`ui-seg ${small ? 'small' : ''}`} role="group" aria-label={label} data-testid={testid} style={{ '--n': options.length } as JSX.CSSProperties}>
      {options.map(([v, l]) => (
        <button type="button" key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
  return sticky ? <div class="ui-seg-sticky">{el}</div> : el;
}

// ---------------------------------------------------------------- 表格

export interface Col<R> {
  key: string;
  label: Kids;
  /** 'l' 文字靠左（預設第一欄）、'r' 數字靠右 */
  align?: 'l' | 'r';
  /** 欄寬（CSS 長度，例 '4.5rem' 或 '28%'）；未指定的欄平分剩餘寬度 */
  width?: string;
  render: (r: R, i: number) => Kids;
}

/** 表格：表頭與儲存格同一對齊；欄寬固定（table-layout: fixed）；數字欄用 tabular-nums 靠右。 */
export function Table<R>({ cols, rows, rowKey, onRow, caption, testid, sticky = false }: {
  cols: Col<R>[];
  rows: R[];
  rowKey: (r: R, i: number) => string;
  onRow?: (r: R) => void;
  caption?: string;
  testid?: string;
  /** 表頭黏在導覽列下方（長表） */
  sticky?: boolean;
}) {
  return (
    <table class={`ui-table ${sticky ? 'sticky' : ''}`} data-testid={testid}>
      {caption ? <caption class="sr-only">{caption}</caption> : null}
      <colgroup>{cols.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
      <thead>
        <tr>{cols.map((c, i) => <th key={c.key} scope="col" class={(c.align ?? (i === 0 ? 'l' : 'r')) === 'r' ? 'r' : 'l'}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={rowKey(r, ri)} class={onRow ? 'ui-tap' : undefined} onClick={onRow ? () => onRow(r) : undefined}
            tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(r); } } : undefined}>
            {cols.map((c, i) => <td key={c.key} class={(c.align ?? (i === 0 ? 'l' : 'r')) === 'r' ? 'r' : 'l'}>{c.render(r, ri)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- 摘要格

export interface Stat { label: Kids; value: Kids; testid?: string }

/** 摘要格（2 欄等寬）：每格只有標籤與數值；同列標籤同高、數值同基線（subgrid），某格換行不擠歪同列。 */
export function StatGrid({ items, cols = 2, testid }: { items: Stat[]; cols?: 2 | 3 | 4; testid?: string }) {
  return (
    <div class={`ui-stats c${cols}`} data-testid={testid}>
      {items.map((s, i) => (
        <div key={i} class="ui-stat" data-testid={s.testid}>
          <span class="ui-stat-l ui-foot ui-muted">{s.label}</span>
          <span class="ui-stat-v" data-a="bl">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 其他

/** 按鈕（可點的才用藍色）：variant 'fill' 主要動作、'plain' 次要。 */
export function Button({ children, onClick, href, variant = 'plain', block = false, testid, disabled }: {
  children: Kids; onClick?: () => void; href?: string; variant?: 'fill' | 'plain'; block?: boolean; testid?: string; disabled?: boolean;
}) {
  const cls = `ui-btn ${variant} ${block ? 'block' : ''}`;
  if (href) return <a class={cls} href={href} data-testid={testid}>{children}</a>;
  return <button type="button" class={cls} onClick={onClick} data-testid={testid} disabled={disabled}>{children}</button>;
}

/** 說明文字段落（只用在 ⓘ 與 sheet 內）。 */
export function Prose({ children }: { children: Kids }) {
  return <div class="ui-prose">{children}</div>;
}
