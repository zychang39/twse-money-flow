import { useEffect, useState } from 'preact/hooks';
import { IconClose } from './components/Icons';
import { useRoute } from './router';
import { Dock } from './components/Chrome';
import { Footer } from './components/Footer';
import { lazy } from './lazy';
import Tonight from './pages/Tonight';
import Placeholder from './pages/Placeholder';
import { getSetting, subscribe } from './db/db';
import { BackupReminder } from './components/BackupReminder';

const Mine = lazy(() => import('./pages/Mine'));
const Stock = lazy(() => import('./pages/Stock'));
const Explore = lazy(() => import('./pages/Explore'));
const Screener = lazy(() => import('./pages/Screener'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Sectors = lazy(() => import('./pages/Sectors'));
const Etf = lazy(() => import('./pages/Etf'));
const MarketTemp = lazy(() => import('./pages/MarketTemp'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Disposition = lazy(() => import('./pages/Disposition'));
const Discipline = lazy(() => import('./pages/Discipline'));
const Journal = lazy(() => import('./pages/Journal'));
const Stats = lazy(() => import('./pages/Stats'));
const Badges = lazy(() => import('./pages/Badges'));
const Weekly = lazy(() => import('./pages/Weekly'));
const Me = lazy(() => import('./pages/Me'));
const Health = lazy(() => import('./pages/Health'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Settings = lazy(() => import('./pages/Settings'));
const Backup = lazy(() => import('./pages/Backup'));
const Search = lazy(() => import('./pages/Search'));

function Page({ parts }: { parts: string[] }) {
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return <Tonight />;
    case 'mine': return <Mine />;
    case 'search': return <Search />;
    case 'stock': return b ? <Stock code={b} /> : <Placeholder title="個股" back="/mine" />;
    case 'explore':
      switch (b) {
        case undefined: return <Explore />;
        case 'screener': return <Screener />;
        case 'backtest': return <Backtest />;
        case 'sectors': return <Sectors industry={c} />;
        case 'etf': return <Etf />;
        case 'market': return <MarketTemp />;
        case 'calendar': return <CalendarPage />;
        case 'disposition': return <Disposition />;
        default: return <Placeholder title="找不到頁面" back="/explore" />;
      }
    case 'discipline':
      switch (b) {
        case undefined: return <Discipline />;
        case 'journal': return <Journal />;
        case 'checklist': return <Journal startChecklist />;
        case 'stats': return <Stats />;
        case 'badges': return <Badges />;
        case 'weekly': return <Weekly />;
        default: return <Placeholder title="找不到頁面" back="/discipline" />;
      }
    case 'me':
      switch (b) {
        case undefined: return <Me />;
        case 'health': return <Health />;
        case 'methodology': return <Methodology />;
        case 'settings': return <Settings />;
        case 'backup': return <Backup />;
        default: return <Placeholder title="找不到頁面" back="/me" />;
      }
    default: return <Placeholder title="找不到頁面" back="/" />;
  }
}

/** 新版本已就緒（service worker 已更新）：由使用者點「重新載入」，不在使用中途自動重新整理。 */
function UpdateToast() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('app-updated', on);
    return () => window.removeEventListener('app-updated', on);
  }, []);
  if (!ready) return null;
  return (
    <div class="update-toast glass" role="status">
      <span>新版本已就緒</span>
      <button class="btn small primary" onClick={() => location.reload()}>重新載入</button>
      <button class="icon-btn" aria-label="稍後" onClick={() => setReady(false)}><IconClose /></button>
    </div>
  );
}

/** 外觀（淺／深／跟隨系統）與環境光開關：寫在 <html> 的 data-theme、data-ambient；狀態列顏色跟著背景。 */
export async function applyAppearance(): Promise<void> {
  const theme = await getSetting<string>('theme', 'auto');
  const ambient = await getSetting<boolean>('ambient', true);
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.dataset.ambient = ambient ? 'on' : 'off';
  const bg = getComputedStyle(root).getPropertyValue('--status-bar').trim() || '#000000';
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'auto') m.content = m.media.includes('dark') ? '#000000' : '#f4f4f6';
    else m.content = bg;
  });
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    applyAppearance();
    return subscribe(() => { applyAppearance(); });
  }, []);
  return (
    <>
      <div class="status-scrim" aria-hidden="true" />
      <main class="app" id="main">
        <div class="page-body">
          <BackupReminder />
          <Page parts={route.parts} />
        </div>
        <Footer />
      </main>
      {route.path === '/search' ? null : <Dock path={route.path} />}
      <UpdateToast />
    </>
  );
}
