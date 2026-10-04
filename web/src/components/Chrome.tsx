/** App 外框：導覽列（透明→玻璃、大標題收合、齒輪）、底部浮動分頁列（5 個圖示分頁，搜尋在第 4 格）、環境光。 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  IconBack, IconDiscipline, IconDoc, IconExplore, IconExport, IconGear, IconLayers, IconMine, IconPulse, IconSearch, IconSliders, IconTonight,
} from './Icons';
import { TAB_DEFS, tabIndexOf } from '../lib/tabs';
import { goBack, navigate } from '../router';
import { useAmbient, useAmbientMood } from '../lib/ambient';

const TAB_ICONS = [IconTonight, IconMine, IconExplore, IconSearch, IconDiscipline];
const SEARCH_TAB = 3;
const DRAG_START = 10; // 在導覽列上水平拖曳超過這個距離，選取膠囊跟著手指移動（放開即切換）

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 底部導覽（Instagram／iOS 26 樣式的玻璃膠囊）：今晚、我的股票、探索、搜尋、紀律。
 * - 目前分頁底下有一顆較亮的選取膠囊；切換分頁時膠囊滑過去（中途略微拉長再回彈），頁面內容直接替換。
 * - 手指按住導覽列左右拖曳：膠囊跟著手指移動並略微放大，放開時切換到手指下方的分頁。
 * - 搜尋在第 4 格（右手拇指最順手）；點搜尋時同步預熱鍵盤（primeKeyboard），進入搜尋頁鍵盤直接彈出；
 *   鍵盤開啟時導覽列淡出（:root[data-kb='open']），收起後恢復。
 * - 固定在 bottom: 0，以 env(safe-area-inset-bottom) 補齊；往下捲動時縮小（useScrollCompact）。
 */
export function Dock({ path }: { path: string }) {
  const compact = useScrollCompact(path);
  const active = tabIndexOf(path);
  const indRef = useRef<HTMLSpanElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const prev = useRef(active);
  const drag = useRef<{ id: number; x: number; on: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [lens, setLens] = useState(false);

  // 分頁改變：選取膠囊從舊位置滑到新位置（中途拉長一點再回彈，類似液態玻璃）
  useLayoutEffect(() => {
    const el = indRef.current;
    const from = prev.current;
    prev.current = active;
    if (!el || from === active || from < 0 || active < 0 || reduceMotion() || !el.animate) return;
    const mid = (from + active) / 2;
    const stretch = 1 + Math.min(0.35, 0.12 * Math.abs(active - from));
    el.animate(
      [
        { transform: `translateX(${from * 100}%) scale(1, 1)` },
        { transform: `translateX(${mid * 100}%) scale(${stretch}, 0.92)`, offset: 0.45 },
        { transform: `translateX(${active * 100}%) scale(1, 1)` },
      ],
      { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [active]);

  const cellAt = (clientX: number): { index: number; x: number } | null => {
    const nav = navRef.current;
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(nav).paddingLeft) || 0;
    const w = (r.width - 2 * pad) / TAB_DEFS.length;
    const x = Math.max(0, Math.min(r.width - 2 * pad - w, clientX - r.left - pad - w / 2));
    return { index: Math.round(x / w), x: x / w };
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, on: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on) {
      if (Math.abs(e.clientX - d.x) < DRAG_START) return;
      d.on = true;
      navRef.current?.setPointerCapture(e.pointerId);
      setLens(true);
    }
    const c = cellAt(e.clientX);
    if (c && indRef.current) indRef.current.style.transform = `translateX(${c.x * 100}%) scale(1.12)`;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.on) return;
    setLens(false);
    suppressClick.current = true;
    const c = cellAt(e.clientX);
    const el = indRef.current;
    const to = c ? c.index : active;
    if (el) {
      // 從手指放開的位置吸附到分頁中央
      const from = el.style.transform;
      el.style.transform = `translateX(${Math.max(0, to) * 100}%)`;
      if (!reduceMotion() && el.animate) el.animate([{ transform: from }, { transform: el.style.transform }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    prev.current = to; // 已經在目標位置，不再播放一次滑動
    if (to !== active && to >= 0) {
      if (to === SEARCH_TAB) primeKeyboard();
      navigate(TAB_DEFS[to].path);
    }
  };
  // 拖曳被取消（例：頁面開始捲動）：膠囊回到目前分頁
  const onCancel = () => {
    const wasDragging = drag.current?.on;
    drag.current = null;
    setLens(false);
    if (wasDragging && indRef.current) indRef.current.style.transform = `translateX(${Math.max(0, active) * 100}%)`;
  };

  return (
    <div class={`dock ${compact ? 'compact' : ''}`}>
      <nav ref={navRef} class={`tabbar ${lens ? 'lens' : ''}`} aria-label="主要分頁"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
        onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}>
        <span ref={indRef} class={`tab-indicator ${active < 0 ? 'hidden' : ''}`} aria-hidden="true"
          style={{ transform: `translateX(${Math.max(0, active) * 100}%)` }} />
        {TAB_DEFS.map((t, i) => {
          const Icon = TAB_ICONS[i];
          const current = i === active;
          return (
            <a key={t.path} href={`#${t.path}`} aria-label={i === SEARCH_TAB ? '搜尋代號或名稱' : t.label} aria-current={current ? 'page' : undefined}
              class={i === SEARCH_TAB ? 'tab-search' : undefined}
              onClick={i === SEARCH_TAB ? (e) => {
                primeKeyboard();
                // 已在搜尋頁再點一次：回到搜尋框
                if (current) { e.preventDefault(); window.dispatchEvent(new Event('search-refocus')); }
              } : undefined}>
              <Icon />
              <span class="tab-label" aria-hidden="true">{t.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

/** 捲動方向 → 精簡型態。門檻避免手指微動造成閃爍；停止捲動 700ms 後恢復。 */
export function useScrollCompact(path: string): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => setCompact(false), [path]);
  useEffect(() => {
    let lastY = window.scrollY;
    let raf = 0;
    let idle = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const dy = y - lastY;
        if (Math.abs(dy) > 6) {
          setCompact(dy > 0 && y > 64);
          lastY = y;
        }
        clearTimeout(idle);
        idle = window.setTimeout(() => { setCompact(false); lastY = window.scrollY; }, 700);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); clearTimeout(idle); };
  }, []);
  return compact;
}

/**
 * iOS 只在使用者手勢內聚焦輸入框時才會叫出鍵盤；換頁後才聚焦搜尋框會沒有鍵盤。
 * 點搜尋按鈕時先同步聚焦一個隱形輸入框（#kb-primer），搜尋頁掛載後再把焦點移到真正的搜尋框，鍵盤會保持開啟。
 */
export function primeKeyboard(): void {
  let el = document.getElementById('kb-primer') as HTMLInputElement | null;
  if (!el) {
    el = document.createElement('input');
    el.id = 'kb-primer';
    el.type = 'search';
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    el.className = 'kb-primer';
    document.body.appendChild(el);
  }
  el.focus({ preventScroll: true });
}

const MENU = [
  { path: '/me/settings', label: '設定', desc: '顯示、風險、門檻、資料、名詞表', icon: IconSliders },
  { path: '/me/backup', label: '備份', desc: '匯出／匯入所有本機資料（單一 JSON）', icon: IconExport },
  { path: '/me/health', label: '資料健康', desc: '每個資料集的最新日期、更新時間、來源與落後原因', icon: IconPulse },
  { path: '/me/data', label: '資料狀態', desc: '每個資料集的應有日、涵蓋率與回補進度', icon: IconLayers },
  { path: '/me/methodology', label: '方法說明', desc: '所有指標與分數的計算方式', icon: IconDoc },
];

export function MenuList({ onPick }: { onPick?: () => void }) {
  return (
    <div class="menu-list">
      {MENU.map((m) => {
        const Icon = m.icon;
        return (
          <a key={m.path} class="menu-item" href={`#${m.path}`} onClick={onPick}>
            <span class="ico"><Icon /></span>
            <span class="grow"><span class="body">{m.label}</span><span class="caption muted" style={{ display: 'block' }}>{m.desc}</span></span>
          </a>
        );
      })}
    </div>
  );
}

/** 右上角齒輪（全站）：推入完整設定頁。 */
export function GearButton() {
  return (
    <a class="icon-btn gear-btn" href="#/me/settings" aria-label="設定" data-testid="gear">
      <IconGear />
    </a>
  );
}

/**
 * 捲動狀態（導覽列）：scrolled＝頁面離開頂端（導覽列出現玻璃材質）；collapsed＝大標題已捲到導覽列底下（顯示置中小標題）。
 */
function useNavScroll(path: string): { scrolled: boolean; title: string } {
  const [state, setState] = useState({ scrolled: false, title: '' });
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const y = window.scrollY;
      const h1 = document.querySelector<HTMLElement>('.page .ui-large, .page [data-nav-title]');
      const navBottom = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0) + 44;
      let title = '';
      if (h1) {
        const r = h1.getBoundingClientRect();
        if (r.bottom <= navBottom + 4) title = h1.dataset.navTitle || h1.textContent || '';
      }
      const scrolled = y > 4;
      setState((s) => (s.scrolled === scrolled && s.title === title ? s : { scrolled, title }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); };
  }, [path]);
  return state;
}

/**
 * 導覽列（全站）：預設完全透明（環境光從 y=0 透出）；捲動後才出現玻璃材質，大標題收合成置中小標題。
 * 左：返回（子頁）；中：收合後的標題（或 center 指定的內容，例：個股頁的自選分頁器）；右：動作＋齒輪。
 */
export function TopBar({ back, caption, center, actions, avatar = true, gear }: {
  back?: string;
  /** 舊參數：中間的小字（捲動前顯示；捲動後換成收合標題） */
  caption?: ComponentChildren;
  /** 中間固定內容（例：自選分頁器）；有指定時不顯示收合標題 */
  center?: ComponentChildren;
  actions?: ComponentChildren;
  /** 舊參數名稱：是否顯示右上角齒輪 */
  avatar?: boolean;
  gear?: boolean;
}) {
  const path = typeof location !== 'undefined' ? location.hash : '';
  const { scrolled, title } = useNavScroll(path);
  const showGear = gear ?? avatar;
  return (
    <div class={`topbar ${scrolled ? 'scrolled' : ''}`} data-testid="topbar">
      {back ? (
        <a class="icon-btn" href={`#${back}`} aria-label="返回"
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); goBack(back); }}>
          <IconBack />
        </a>
      ) : <span />}
      <div class="topbar-center">
        {center ?? (
          <>
            <span class={`topbar-title ${title ? 'on' : ''}`} aria-hidden={!title}>{title}</span>
            {caption ? <span class={`topbar-caption caption ${title ? '' : 'on'}`}>{caption}</span> : null}
          </>
        )}
      </div>
      <span class="topbar-actions">
        {actions}
        {showGear ? <GearButton /> : null}
      </span>
    </div>
  );
}

/**
 * 頁首（2026-10 改版）：名詞標題（LargeTitle）＋可選的一行副資訊。不再顯示問題式的小字（eyebrow 只保留參數相容、不顯示）。
 */
export function PageHead({ title, sub, children }: { eyebrow?: ComponentChildren; title: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren; twoLine?: boolean }) {
  return (
    <header class="page-head ui-head">
      <h1 class="ui-large">{title}</h1>
      {sub ? <div class="ui-foot ui-muted ui-head-sub">{sub}</div> : null}
      {children}
    </header>
  );
}

/** 區塊：先寫在回答哪個問題（小字），再寫答案（區塊標題），往下才是依據。 */
export function Block({ question, answer, children, id }: { question: ComponentChildren; answer?: ComponentChildren; children?: ComponentChildren; id?: string }) {
  return (
    <section class="block" id={id} aria-label={typeof question === 'string' ? question : undefined}>
      <span class="eyebrow">{question}</span>
      <h2 class="section">{answer || '\u00a0'}</h2>
      {children}
    </section>
  );
}

/**
 * 環境光：從螢幕最頂端（y=0，狀態列與動態島底下）開始，顏色跟隨該頁主標的當日漲跌（漲紅、跌綠、平中性），
 * 由上往下淡出到黑，涵蓋主數字與主圖區。強度與範圍沿用改版前（d6a9362）的 radial-gradient。
 * 全站只有一層（app.tsx 的 AmbientLayer）；頁面以 useAmbient(mood) 指定顏色，離開頁面回到中性。
 */
export type Mood = 'up' | 'down' | 'risk' | 'neutral' | 'flat';
export { useAmbient } from '../lib/ambient';
export function AmbientLayer() {
  const mood = useAmbientMood();
  const m = mood === 'flat' ? 'neutral' : mood;
  return (
    <div class="ambient" aria-hidden="true" data-mood={m} data-testid="ambient">
      {(['up', 'down', 'risk', 'neutral'] as const).map((k) => <i key={k} class={`${k} ${k === m ? 'on' : ''}`} />)}
    </div>
  );
}
/** 舊介面相容：頁面內直接放 <Ambient mood=… />＝設定全站環境光的顏色（不另外繪製）。 */
export function Ambient({ mood }: { mood: Mood }) {
  useAmbient(mood);
  return null;
}
