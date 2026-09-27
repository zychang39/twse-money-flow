/** App 外框：頂列（含頭像選單）、底部導覽（4 個圖示 Tab＋圓形搜尋按鈕）、環境光。 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import {
  IconBack, IconDiscipline, IconDoc, IconExplore, IconExport, IconMine, IconPerson, IconPulse, IconSearch, IconSliders, IconTonight,
} from './Icons';

const TABS = [
  { path: '/', label: '今晚', icon: IconTonight, match: (p: string) => p === '/' },
  { path: '/mine', label: '我的股票', icon: IconMine, match: (p: string) => p.startsWith('/mine') || p.startsWith('/stock') },
  { path: '/explore', label: '探索', icon: IconExplore, match: (p: string) => p.startsWith('/explore') },
  { path: '/discipline', label: '紀律', icon: IconDiscipline, match: (p: string) => p.startsWith('/discipline') },
];

/**
 * 底部導覽（iOS 26 慣例）：4 個圖示 Tab 的膠囊＋右側獨立的圓形搜尋按鈕，合併成一列。
 * - 固定在 bottom: 0，以 env(safe-area-inset-bottom) 補齊（不另加 margin）；內容底部保留剛好等於這一列的高度。
 * - 往下捲動時縮小成精簡型態；往上捲、停止捲動或換頁時恢復（useScrollCompact）。
 * - 搜尋頁（#/search）有自己的底部搜尋列，這一列隱藏。
 */
export function Dock({ path }: { path: string }) {
  const compact = useScrollCompact(path);
  return (
    <div class={`dock ${compact ? 'compact' : ''}`}>
      <nav class="tabbar glass" aria-label="主要分頁">
        {TABS.map((t) => {
          const Icon = t.icon;
          const current = t.match(path);
          return (
            <a key={t.path} href={`#${t.path}`} aria-label={t.label} aria-current={current ? 'page' : undefined}>
              <Icon />
            </a>
          );
        })}
      </nav>
      <a class="search-btn glass" href="#/search" aria-label="搜尋代號或名稱" onClick={primeKeyboard}>
        <IconSearch />
      </a>
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
  { path: '/me/settings', label: '設定', desc: '環境光、遊戲化、分數權重、交易成本、外觀、提醒匯出', icon: IconSliders },
  { path: '/me/backup', label: '備份', desc: '匯出／匯入所有本機資料（單一 JSON）', icon: IconExport },
  { path: '/me/health', label: '資料健康', desc: '各資料源狀態、推估事件與最近執行紀錄', icon: IconPulse },
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

/** 右上角頭像：設定、備份、資料健康、方法說明。 */
export function AvatarButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="avatar-btn" aria-label="帳戶選單：設定、備份、資料健康、方法說明" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span><IconPerson /></span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="我的">
        <MenuList onPick={() => setOpen(false)} />
        <p class="caption muted" style={{ marginTop: 'var(--s-6)' }}>所有使用者資料只存在這台裝置，不會上傳。</p>
      </Sheet>
    </>
  );
}

/**
 * 頂列：左側為返回或日期說明，右側為動作與頭像。
 * back 為返回路徑；caption 為左側小字（例如「9月24日（四）盤後簡報」）。
 */
export function TopBar({ back, caption, actions, avatar = true }: { back?: string; caption?: ComponentChildren; actions?: ComponentChildren; avatar?: boolean }) {
  return (
    <div class="topbar">
      {back ? (
        <a class="icon-btn" href={`#${back}`} aria-label="返回">
          <IconBack />
        </a>
      ) : <span style={{ width: 'var(--s-3)' }} />}
      <div class="grow caption">{caption}</div>
      {actions}
      {avatar ? <AvatarButton /> : null}
    </div>
  );
}

/** 頁首：問題（小字）＋ 結論句（頁面標題）。 */
export function PageHead({ eyebrow, title, children, twoLine }: { eyebrow?: ComponentChildren; title: ComponentChildren; children?: ComponentChildren; twoLine?: boolean }) {
  return (
    <header class="page-head">
      {eyebrow ? <div class="eyebrow">{eyebrow}</div> : null}
      <h1 class={`title ${twoLine ? 'two-line' : ''}`}>{title}</h1>
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

/** 環境光（B 方向）：頁首的靜態漸層，狀態切換時以透明度交叉淡入。 */
export type Mood = 'up' | 'down' | 'risk' | 'neutral' | 'flat';
export function Ambient({ mood }: { mood: Mood }) {
  const m = mood === 'flat' ? 'neutral' : mood;
  return (
    <div class="ambient" aria-hidden="true" data-mood={m}>
      {(['up', 'down', 'risk', 'neutral'] as const).map((k) => <i key={k} class={`${k} ${k === m ? 'on' : ''}`} />)}
    </div>
  );
}
