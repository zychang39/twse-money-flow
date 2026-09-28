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
import { applyTheme } from './lib/theme';

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
const Institutional = lazy(() => import('./pages/Institutional'));
const Holders = lazy(() => import('./pages/Holders'));
const BullBear = lazy(() => import('./pages/BullBear'));

function Page({ parts }: { parts: string[] }) {
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return <Tonight />;
    case 'mine': return <Mine />;
    case 'search': return <Search />;
    case 'stock':
      if (!b) return <Placeholder title="個股" back="/mine" />;
      switch (c) {
        case undefined: return <Stock code={b} />;
        case 'institutional': return <Institutional code={b} />;
        case 'holders': return <Holders code={b} />;
        case 'bullbear': return <BullBear code={b} />;
        default: return <Placeholder title="找不到頁面" back={`/stock/${b}`} />;
      }
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

/**
 * 外觀：深淺色存在 localStorage（lib/theme.ts，index.html 在第一次繪製前已套用）；
 * 環境光開關存在 IndexedDB，寫在 <html> 的 data-ambient。
 */
export async function applyAppearance(): Promise<void> {
  applyTheme();
  const ambient = await getSetting<boolean>('ambient', true);
  document.documentElement.dataset.ambient = ambient ? 'on' : 'off';
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
      <Dock path={route.path} />
      <UpdateToast />
    </>
  );
}
