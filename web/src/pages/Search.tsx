/**
 * 搜尋（#/search，底部導覽的第 4 格）：輸入框在底部導覽正上方、鍵盤出現時貼在鍵盤正上方（導覽列淡出）；
 * 結果清單在它上方由下往上排列，最相關的結果最靠近拇指。沒有輸入時顯示：最近搜尋（最靠近拇指）、自選股、熱門動能前 5 名。
 *
 * 工程重點：
 * - 以 visualViewport 追蹤可見區域（鍵盤高度＝innerHeight − vv.height − vv.offsetTop），整個搜尋畫面
 *   固定在「可見區域」內（top＝offsetTop、height＝vv.height），iOS Safari 開鍵盤時把版面往上推的位移也一併抵銷。
 * - 搜尋期間鎖住頁面捲動（html overflow: hidden），只有結果清單可以捲動。
 * - 點結果進入個股頁並記入最近搜尋；結果列左滑（或按列尾的＋）直接加入自選。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { StockRow } from '../data/types';
import { ChangePill } from '../components/Change';
import { IconCheck, IconClose, IconPlus, IconSearch } from '../components/Icons';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadLists } from '../data/api';
import { addWatch, clearRecentSearches, listRecentSearches, listWatch, pushRecentSearch } from '../db/db';
import { searchStocks } from '../lib/search';
import { fmtPrice } from '../lib/format';
import { navigate } from '../router';

const KB_OPEN_PX = 80;

/** 把可見區域（visualViewport）寫成 CSS 變數；鍵盤開啟時標記 data-kb="open"。 */
export function useVisualViewport(ref: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const h = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      const kb = Math.max(0, window.innerHeight - h - top);
      el.style.setProperty('--vv-h', `${Math.round(h)}px`);
      el.style.setProperty('--vv-top', `${Math.round(top)}px`);
      el.style.setProperty('--kb', `${Math.round(kb)}px`);
      el.dataset.kb = kb > KB_OPEN_PX ? 'open' : 'closed';
      // 底部導覽在鍵盤開啟時淡出（global.css :root[data-kb='open'] .dock）
      document.documentElement.dataset.kb = el.dataset.kb;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      delete document.documentElement.dataset.kb;
    };
  }, []);
}

type Row = Pick<StockRow, 'code' | 'name' | 'industry' | 'close' | 'change' | 'change_pct'>;

const SWIPE_ADD = 72; // 左滑超過這個距離放開就加入自選

function ResultRow({ row, watched, onOpen, onAdd, sub, index }: {
  row: Row; watched: boolean; onOpen: () => void; onAdd: () => void; sub?: string; index?: number;
}) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const g = useRef<{ x: number; y: number; lock: 'h' | 'v' | null } | null>(null);
  const moved = useRef(false);
  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.sresult-add')) return;
    g.current = { x: e.clientX, y: e.clientY, lock: null };
    moved.current = false;
  }
  function move(e: PointerEvent) {
    const s = g.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { s.lock = 'v'; return; }
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        s.lock = 'h';
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(true);
      }
    }
    if (s.lock === 'h') {
      moved.current = true;
      setDx(Math.min(0, Math.max(-SWIPE_ADD * 1.6, mx)));
    }
  }
  function up() {
    const s = g.current;
    g.current = null;
    if (s?.lock === 'h') {
      if (dx <= -SWIPE_ADD && !watched) onAdd();
      setDrag(false);
      setDx(0);
    }
  }
  const armed = dx <= -SWIPE_ADD;
  return (
    <li class="sresult-wrap">
      <div class={`sresult-action ${armed ? 'armed' : ''}`} aria-hidden="true">{watched ? '已在自選' : '加入自選'}</div>
      <div class={`sresult ${drag ? 'dragging' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button class="sresult-main" data-index={index}
          onClick={(e) => { if (moved.current) { e.preventDefault(); moved.current = false; return; } onOpen(); }}>
          <span class="grow" style={{ minWidth: 0 }}>
            <span class="body w5 ellipsis" style={{ display: 'block' }}>{row.name}</span>
            <span class="caption muted ellipsis" style={{ display: 'block' }}>{row.code}{sub ? `・${sub}` : row.industry ? `・${row.industry}` : ''}</span>
          </span>
          <span class="right">
            <span class="body" style={{ display: 'block' }}>{fmtPrice(row.close)}</span>
            <ChangePill change={row.change} pct={row.change_pct} />
          </span>
        </button>
        <button class={`sresult-add ${watched ? 'on' : ''}`} aria-label={watched ? `${row.name} 已在自選` : `把 ${row.name} 加入自選`}
          aria-pressed={watched} disabled={watched} onClick={onAdd}>
          {watched ? <IconCheck /> : <IconPlus />}
        </button>
      </div>
    </li>
  );
}

function Section({ title, action, children, reverse }: { title: string; action?: ComponentChildren; children: ComponentChildren; reverse?: boolean }) {
  return (
    <section class="search-section" aria-label={title}>
      <div class="row between"><h2 class="eyebrow">{title}</h2>{action}</div>
      <ul class={`search-list ${reverse ? 'reverse' : ''}`} aria-label={title}>{children}</ul>
    </section>
  );
}

export default function Search() {
  const summary = useScoredSummary();
  const lists = useAsync(loadLists, []);
  const recentDb = useDb(listRecentSearches);
  const watchDb = useDb(listWatch);
  const recent = recentDb ?? [];
  const watch = watchDb ?? [];
  // 所有來源都到齊才一次畫出（避免各區塊先後出現、把彼此往上推造成版面位移）
  const ready = !!summary.data && recentDb !== null && watchDb !== null && !lists.loading;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useVisualViewport(screenRef);

  // 搜尋期間鎖住頁面捲動；聚焦真正的搜尋框（鍵盤已由底部導覽的 primeKeyboard 預熱）。
  // 在搜尋頁再點一次底部的搜尋分頁：回到搜尋框（search-refocus）。
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const focus = () => inputRef.current?.focus({ preventScroll: true });
    focus();
    window.addEventListener('search-refocus', focus);
    return () => { root.style.overflow = prev; window.removeEventListener('search-refocus', focus); };
  }, []);

  const rows = summary.data?.rows ?? [];
  const byCode = summary.data?.byCode;
  const watched = useMemo(() => new Set(watch.map((w) => w.code)), [watch]);
  const hits = useMemo(() => searchStocks(rows, q, 20), [rows, q]);
  const pick = (code: string) => (byCode?.get(code) as Row | undefined);

  async function open(code: string) {
    await pushRecentSearch(code);
    navigate(`/stock/${code}`);
  }
  async function add(r: Row) {
    if (await addWatch(r.code)) setStatus(`已把 ${r.name} 加入自選`);
  }
  function cancel() {
    if (history.length > 1) history.back();
    else navigate('/');
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && hits[0]) open(hits[0].code);
    // 結果在輸入框上方：↑ 移到最相關的結果
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      screenRef.current?.querySelector<HTMLElement>('.sresult-main')?.focus();
    }
  }
  function onListKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t.classList.contains('sresult-main')) return;
    const all = [...(screenRef.current?.querySelectorAll<HTMLElement>('.sresult-main') ?? [])];
    const i = all.indexOf(t);
    if (e.key === 'ArrowUp') { e.preventDefault(); all[i + 1]?.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (i === 0) inputRef.current?.focus(); else all[i - 1]?.focus(); }
  }

  const query = q.trim();
  const hot = (lists.data?.hot_momentum.items ?? []).slice(0, 5);
  const recentRows = recent.map(pick).filter((r): r is Row => !!r);
  const watchRows = watch.map((w) => pick(w.code)).filter((r): r is Row => !!r).slice(0, 8);

  return (
    <div class="search-screen" ref={screenRef} data-kb="closed">
      <div class="search-results" onKeyDown={onListKey}>
        {query ? (
          hits.length ? (
            <Section title={`搜尋結果・${hits.length} 檔`} reverse>
              {hits.map((r, i) => <ResultRow key={r.code} index={i} row={r} watched={watched.has(r.code)} onOpen={() => open(r.code)} onAdd={() => add(r)} />)}
            </Section>
          ) : summary.data ? (
            <p class="search-empty caption muted" role="status">找不到「{query}」。可輸入 4–6 碼代號、公司名稱或名稱中的幾個字。</p>
          ) : <p class="search-empty caption muted" role="status">載入全市場清單中…</p>
        ) : !ready ? null : (
          <>
            {recentRows.length ? (
              <Section title="最近搜尋" reverse action={<button class="text-btn caption" onClick={() => clearRecentSearches()}>清除</button>}>
                {recentRows.map((r) => <ResultRow key={r.code} row={r} watched={watched.has(r.code)} onOpen={() => open(r.code)} onAdd={() => add(r)} />)}
              </Section>
            ) : null}
            {watchRows.length ? (
              <Section title="自選股">
                {watchRows.map((r) => <ResultRow key={r.code} row={r} watched onOpen={() => open(r.code)} onAdd={() => add(r)} />)}
              </Section>
            ) : null}
            {hot.length ? (
              <Section title="熱門動能前 5 名（依規則產生，非推薦）">
                {hot.map((h) => {
                  const r = pick(h.code);
                  return r ? <ResultRow key={h.code} row={r} sub={h.reason} watched={watched.has(h.code)} onOpen={() => open(h.code)} onAdd={() => add(r)} /> : null;
                })}
              </Section>
            ) : null}
            <p class="search-hint caption muted">輸入代號、公司名稱或名稱中的幾個字，例如「2330」「台積」「聯發」。結果左滑可直接加入自選。</p>
          </>
        )}
      </div>
      <p class="sr-only" role="status" aria-live="polite">{status}</p>
      <div class="search-bar">
        <label class="search-field">
          <IconSearch />
          <input ref={inputRef} type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellcheck={false}
            aria-label="搜尋代號或名稱" placeholder="代號或名稱" value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={onKey} />
          {q ? <button class="search-clear" aria-label="清除輸入" onClick={() => { setQ(''); inputRef.current?.focus(); }}><IconClose /></button> : null}
        </label>
        <button class="text-btn search-cancel" onClick={cancel}>取消</button>
      </div>
    </div>
  );
}
