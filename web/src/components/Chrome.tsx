/** App 外框：頂列（含頭像選單）、底部 4 個圖示 Tab、漂浮搜尋膠囊、環境光。 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import {
  IconBack, IconDiscipline, IconDoc, IconExplore, IconExport, IconMine, IconPerson, IconPulse, IconSearch, IconSliders, IconTonight,
} from './Icons';
import { StockSearch } from './StockSearch';
import { useScoredSummary } from '../data/useSummary';
import { navigate } from '../router';

const TABS = [
  { path: '/', label: '今晚', icon: IconTonight, match: (p: string) => p === '/' },
  { path: '/mine', label: '我的股票', icon: IconMine, match: (p: string) => p.startsWith('/mine') || p.startsWith('/stock') },
  { path: '/explore', label: '探索', icon: IconExplore, match: (p: string) => p.startsWith('/explore') },
  { path: '/discipline', label: '紀律', icon: IconDiscipline, match: (p: string) => p.startsWith('/discipline') },
];

/** 底部 Tab：只有線條圖示，文字標籤給輔助科技（aria-label）。 */
export function TabBar({ path }: { path: string }) {
  return (
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
  );
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

/** 漂浮搜尋膠囊：搜尋全市場代號或名稱，直接開啟個股頁。 */
export function SearchFloat() {
  const [open, setOpen] = useState(false);
  const summary = useScoredSummary();
  return (
    <>
      <button class="search-float glass" onClick={() => setOpen(true)} aria-label="搜尋代號或名稱">
        <IconSearch /><span>搜尋代號或名稱</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="搜尋" detent="full">
        {summary.data ? (
          <StockSearch rows={summary.data.rows} autoFocus onPick={(r) => { setOpen(false); navigate(`/stock/${r.code}`); }} />
        ) : <div class="skeleton" />}
      </Sheet>
    </>
  );
}
