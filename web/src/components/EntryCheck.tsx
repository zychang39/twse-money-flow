/**
 * 新增持倉前檢查表的畫面（2026-10-06）：
 * - NavStack：面板內的推入／返回（說明頁不用 half sheet，而是在同一個面板裡由右推入；左緣右滑或「‹」返回）。
 * - FactsView：「繼續之前，先看一下目前的事實」——資金環境總結一列＋每項指標一列（inset grouped list）。
 * - FactDetail：事實列的說明頁（這是什麼／為什麼進場前要看／目前數值與判定門檻／近期走勢與資料來源）。
 * - ItemRows：檢查表 1–5 的唯讀資料列（自動判定；資料不足時退回手動選單；手動調整的列標「手動」並可一鍵還原）。
 * - ItemDetail：1–5 的說明頁（是什麼／為什麼看／判定規則與現值／資料來源）＋最下方「手動調整」。
 * 樣式全部沿用 components/ui 的列、卡片、標籤；只呈現事實，不出現買賣建議用語。
 */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Card, CardLabel, EmptyRow, List, Row, Section, Table, Tag } from './ui';
import { MiniLine } from './kit';
import { IconCheck } from './Icons';
import '../styles/entry.css';
import type { FactDoc, FactRow, EnvSummary } from '../lib/entryFacts';
import { stanceTone } from '../lib/entryFacts';
import { AUTO_KEYS, AUTO_LABEL, optionsFor, shortOf, type AutoItem, type AutoKey, type ItemDoc, type Overrides } from '../lib/checklistAuto';

// ---------------------------------------------------------------- 面板內推入／返回

const PUSH_MS = 320;

/**
 * 兩層的導覽堆疊：detail 有內容時由右推入，root 往左退 30% 並淡出（iOS push）；返回時相反。
 * - 推入時記住面板的捲動位置並捲到頂；返回時還原，焦點回到點開它的列。
 * - 左緣 24px 內往右滑超過 1/3 寬或快速右滑 → 返回。減少動態效果時沒有動畫（global.css 的全域規則）。
 */
export function NavStack({ root, detail, onPop }: { root: ComponentChildren; detail: ComponentChildren | null; onPop: () => void }) {
  const [kept, setKept] = useState<ComponentChildren | null>(detail);
  const [on, setOn] = useState(!!detail);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const saved = useRef<{ top: number; focus: HTMLElement | null }>({ top: 0, focus: null });
  const start = useRef<{ x: number; y: number; t: number; w: number; locked: boolean } | null>(null);
  const scroller = () => ref.current?.closest<HTMLElement>('.sheet-body') ?? null;

  useLayoutEffect(() => {
    if (detail) {
      if (!on) {
        saved.current = { top: scroller()?.scrollTop ?? 0, focus: document.activeElement as HTMLElement | null };
        const sc = scroller();
        if (sc) sc.scrollTop = 0;
      }
      setKept(detail);
      // 先以「在右側」的位置畫一次，再切到定位 → 有滑入動畫
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
        setOn(true);
        detailRef.current?.focus({ preventScroll: true });
      }));
      return () => cancelAnimationFrame(raf);
    }
    if (on) {
      setOn(false);
      const sc = scroller();
      const { top, focus } = saved.current;
      requestAnimationFrame(() => {
        if (sc) sc.scrollTop = top;
        focus?.focus?.({ preventScroll: true });
      });
      const t = setTimeout(() => setKept(null), PUSH_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [detail]);

  function down(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const left = el.getBoundingClientRect().left;
    if (e.clientX - left > 24 || (e.target as HTMLElement).closest('input, select, textarea')) return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), w: el.offsetWidth, locked: false };
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) { start.current = null; return; } // 垂直捲動優先
      if (dx < 8) return;
      s.locked = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setDrag(Math.max(0, dx));
  }
  function up(e: PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s || !s.locked) { setDrag(null); return; }
    const dx = e.clientX - s.x;
    const v = dx / Math.max(1, performance.now() - s.t);
    setDrag(null);
    if (dx > s.w / 3 || v > 0.5) onPop();
  }

  const showDetail = kept !== null;
  return (
    <div ref={ref} class={`nav-stack ${on ? 'pushed' : ''}`}>
      <div class={`nav-pane nav-root ${on ? 'under' : ''} ${showDetail && on ? 'off' : ''}`} inert={on} aria-hidden={on || undefined}>{root}</div>
      {showDetail ? (
        <div ref={detailRef} tabIndex={-1} class={`nav-pane nav-detail ${on ? '' : 'away'} ${!on ? 'off' : ''} ${drag !== null ? 'dragging' : ''}`}
          style={drag !== null ? { transform: `translateX(${drag}px)` } : undefined} inert={!on}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="ck-detail">
          {kept}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- 列

/** 列的副資訊：［手動］日期［資料落後］・依據（小標放在日期旁邊，長的依據換行時不會落單） */
function SubLine({ text, date, stale, manual }: { text?: string | null; date: string; stale: boolean; manual?: boolean }) {
  return (
    <>
      {manual ? <span class="ck-flag lead" data-testid="ck-manual">手動</span> : null}
      {date}
      {stale ? <span class="ck-flag risk" data-testid="ck-stale">資料落後</span> : null}
      {text ? `${date ? '・' : ''}${text}` : null}
    </>
  );
}

function FactListRow({ r, onOpen }: { r: FactRow; onOpen: () => void }) {
  // 資料不足的列：數值欄直接寫「資料不足」（不放狀態標籤），副資訊寫原因
  const none = r.stance === 'none';
  return (
    <Row label={r.short ? <><span class="ck-lbl-full">{r.label}</span><span class="ck-lbl-short" aria-hidden="true">{r.short}</span></> : r.label}
      ariaLabel={`${r.label}：${none ? '資料不足' : `${r.value}${r.tag ? `，${r.tag}` : ''}`}`}
      value={none ? <span class="ui-muted">資料不足</span> : r.value} onClick={onOpen} testid={`fact-${r.id}`}
      tag={!none && r.tag ? <Tag tone={stanceTone(r.stance)}>{r.tag}</Tag> : null}
      subWide sub={<SubLine date={r.dateText} text={r.note} stale={r.stale} />} />
  );
}

/** 事實頁：資金環境總結＋每項指標一列；「繼續填寫檢查表」直接可按 */
export function FactsView({ summary, envRows, stockRows, stockName, onOpen, onContinue, onCancel }: {
  summary: EnvSummary;
  envRows: FactRow[];
  stockRows: FactRow[];
  stockName: string;
  onOpen: (id: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="ck" role="group" aria-label="繼續之前的事實整理" data-testid="calm-card">
      <p class="ck-lead ui-foot ui-muted">繼續之前，先看一下目前的事實</p>
      <List tags testid="env-summary" class="ck-tags-sm">
        <Row label="資金環境" strong value={summary.state === 'unknown' ? <span class="ui-muted" data-testid="env-summary-state">資料不足</span> : undefined}
          tag={summary.state === 'unknown' ? null : <span data-testid="env-summary-state"><Tag tone={summary.state === 'conservative' ? 'risk' : 'neutral'}>{summary.label}</Tag></span>}
          sub={summary.basis} subWide />
      </List>
      <Section title="資金指標">
        <List tags chev testid="fact-env" class="ck-tags-sm">
          {envRows.map((r) => <FactListRow key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}
        </List>
      </Section>
      {stockRows.length ? (
        <Section title={stockName}>
          <List chev testid="fact-stock">
            {stockRows.map((r) => <FactListRow key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}
          </List>
        </Section>
      ) : null}
      <div class="ck-actions">
        <button class="btn primary block" onClick={onContinue}>繼續填寫檢查表</button>
        <button class="btn block" onClick={onCancel}>先不要</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 說明頁

function Para({ title, children, testid }: { title: string; children: ComponentChildren; testid?: string }) {
  return (
    <Section title={title} testid={testid}>
      <Card><p class="ui-prose">{children}</p></Card>
    </Section>
  );
}

function Rules({ rules }: { rules: string[] }) {
  return (
    <Card testid="ck-rules">
      <CardLabel>判定門檻（程式實際使用的設定）</CardLabel>
      <ul class="ck-rules ui-prose">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
    </Card>
  );
}

/** 事實列的說明頁：固定四段 */
export function FactDetail({ doc }: { doc: FactDoc }) {
  const values = doc.chart.filter((v): v is number => v !== null && Number.isFinite(v));
  return (
    <div class="ck ck-doc" data-testid="fact-doc">
      <Para title="這是什麼" testid="doc-what">{doc.what}</Para>
      <Para title="為什麼進場前要看" testid="doc-why">{doc.why}</Para>
      <Section title="目前數值與判定門檻" testid="doc-rules">
        <List>{doc.current.map((c) => <Row key={c.label} label={c.label} value={c.value} />)}</List>
        <Rules rules={doc.rules} />
      </Section>
      <Section title="近期走勢" testid="doc-trend">
        <Card>
          {values.length >= 2 ? (
            <>
              <div class="breadth-line"><MiniLine values={doc.chart} w={320} h={56} base={doc.base ?? null} color="var(--d-1)" testid="doc-mini" /></div>
              {doc.table ? (
                <Table testid="doc-table" caption={`${doc.title}的原始數值`} rowKey={(r) => r.d}
                  cols={doc.table.cols.map((c, i) => ({ key: String(i), label: c, render: (r: { d: string; cells: string[] }) => (i === 0 ? r.d : r.cells[i - 1]) }))}
                  rows={doc.table.rows} />
              ) : null}
            </>
          ) : <EmptyRow testid="doc-nohistory">{doc.noHistory}</EmptyRow>}
          <p class="ck-source ui-foot ui-muted" data-testid="doc-source">資料來源：{doc.source}・{doc.dateText}</p>
        </Card>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- 檢查表 1–5

/** 1–5 的唯讀資料列：名稱｜依據數字｜自動判定｜資料日期｜›。資料不足時列下方退回手動選單；手動調整後可一鍵還原 */
export function ItemRows({ items, overrides, onOpen, onSet }: {
  items: Record<AutoKey, AutoItem>;
  overrides: Overrides;
  onOpen: (k: AutoKey) => void;
  onSet: (k: AutoKey, v: string | undefined) => void;
}) {
  return (
    <List tags chev testid="ck-items" label="檢查表 1 到 5">
      {AUTO_KEYS.map((k) => {
        const it = items[k];
        const manual = overrides[k] !== undefined && overrides[k] !== it.value;
        const value = overrides[k] ?? it.value;
        // 資料不足（沒有自動判定、也沒有手動選擇）：數值欄寫「資料不足」或已有的數字，不放判定標籤
        const tag = value ? <Tag tone={manual ? 'neutral' : it.tone}>{shortOf(k, value)}</Tag> : null;
        const main = value || (it.main && it.main !== '—') ? it.main : <span class="ui-muted">資料不足</span>;
        return (
          <div key={k} class="ck-item" data-testid={`ck-item-${k}`}>
            <Row label={AUTO_LABEL[k]} value={main || undefined} tag={tag} onClick={() => onOpen(k)} testid={`ck-row-${k}`}
              ariaLabel={`${AUTO_LABEL[k]}：${value ? shortOf(k, value) : '資料不足'}${manual ? '（手動）' : ''}`}
              subWide sub={<SubLine text={it.missing ? `資料不足：${it.missing}` : it.basis} date={it.dateText} stale={it.stale} manual={manual} />} />
            {it.value === null && !manual ? (
              <div class="ck-inline field">
                <label for={`ck-${k}`}>{AUTO_LABEL[k]}（資料不足，可手動選擇，不影響送出）</label>
                <select id={`ck-${k}`} class="select" value={overrides[k] ?? ''} onChange={(e) => onSet(k, (e.target as HTMLSelectElement).value || undefined)}>
                  <option value="">不選</option>
                  {optionsFor(k).map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                </select>
              </div>
            ) : null}
            {manual && it.value !== null ? (
              <div class="ck-inline ck-restore">
                <span class="ui-foot ui-muted">自動判定為「{it.short}」</span>
                <button type="button" class="btn small" onClick={() => onSet(k, undefined)} data-testid={`ck-restore-${k}`}>還原自動判定</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </List>
  );
}

/** 1–5 的說明頁：是什麼／為什麼看／判定規則與現值／資料來源＋最下方「手動調整」 */
export function ItemDetail({ k, item, doc, override, onSet }: {
  k: AutoKey;
  item: AutoItem;
  doc: ItemDoc;
  override: string | undefined;
  onSet: (v: string | undefined) => void;
}) {
  const manual = override !== undefined && override !== item.value;
  const current = override ?? item.value;
  const pick = (v: string | undefined) => onSet(v === item.value ? undefined : v);
  return (
    <div class="ck ck-doc" data-testid="item-doc">
      <Para title="這是什麼" testid="doc-what">{doc.what}</Para>
      <Para title="為什麼看" testid="doc-why">{doc.why}</Para>
      <Section title="判定規則與現值" testid="doc-rules">
        <List>
          <Row label="判定" value={current ? shortOf(k, current) : '資料不足'} sub={manual ? '手動調整' : item.value ? '系統自動判定' : item.missing ?? undefined} />
          {item.facts.map((f) => <Row key={f.label} label={f.label} value={f.value} />)}
        </List>
        <Rules rules={doc.rules} />
      </Section>
      <Section title="資料來源" testid="doc-source">
        <Card>
          <p class="ui-prose">{doc.source}</p>
          <p class="ck-source ui-foot ui-muted">{item.dateText ? `資料日 ${item.dateText}` : '沒有資料日'}{item.stale ? '（資料落後於最新交易日）' : ''}</p>
        </Card>
      </Section>
      <Section title="手動調整" testid="doc-manual">
        <div class="ui-list" role="radiogroup" aria-label={`${AUTO_LABEL[k]}手動調整`}>
          {item.value !== null ? (
            <button type="button" class="ui-row ui-tap ck-opt" role="radio" aria-checked={!manual} onClick={() => onSet(undefined)} data-testid="opt-auto">
              <span class="ui-row-main"><span class="ui-row-label" data-a="bl">使用自動判定（{item.short}）</span></span>
              <span class="ui-row-value" data-a="v">{!manual ? <IconCheck /> : null}</span>
            </button>
          ) : null}
          {optionsFor(k).map((o) => {
            const on = manual ? override === o.value : item.value === null && override === o.value;
            return (
              <button key={o.value} type="button" class="ui-row ui-tap ck-opt" role="radio" aria-checked={on} onClick={() => pick(o.value)}>
                <span class="ui-row-main"><span class="ui-row-label" data-a="bl">{o.value}</span></span>
                <span class="ui-row-value" data-a="v">{on ? <IconCheck /> : null}</span>
              </button>
            );
          })}
        </div>
        <p class="ck-source ui-foot ui-muted">手動調整後，該列顯示「手動」；儲存時兩者都會記錄（自動判定與手動結果），供日後復盤。</p>
      </Section>
    </div>
  );
}
