import { useEffect } from 'preact/hooks';
import { useRoute } from './router';
import { TabBar } from './components/TabBar';
import { Footer } from './components/Footer';
import { lazy } from './lazy';
import Watchlist from './pages/Watchlist';
import Placeholder from './pages/Placeholder';
import { getSetting } from './db/db';
import { BackupReminder } from './components/BackupReminder';

const Stock = lazy(() => import('./pages/Stock'));
const Today = lazy(() => import('./pages/Today'));
const Screener = lazy(() => import('./pages/Screener'));
const Backtest = lazy(() => import('./pages/Backtest'));
const Market = lazy(() => import('./pages/Market'));
const Journal = lazy(() => import('./pages/Journal'));
const More = lazy(() => import('./pages/More'));
const Health = lazy(() => import('./pages/Health'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Settings = lazy(() => import('./pages/Settings'));
const Backup = lazy(() => import('./pages/Backup'));
const Weekly = lazy(() => import('./pages/Weekly'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Disposition = lazy(() => import('./pages/Disposition'));

function Page({ parts }: { parts: string[] }) {
  const [a, b] = parts;
  switch (a) {
    case undefined:
    case 'today': return <Today />;
    case 'watchlist': return <Watchlist />;
    case 'stock': return b ? <Stock code={b} /> : <Placeholder title="個股" />;
    case 'screener': return <Screener />;
    case 'backtest': return <Backtest />;
    case 'market': return <Market sector={b} />;
    case 'journal': return <Journal />;
    case 'more':
      switch (b) {
        case 'health': return <Health />;
        case 'methodology': return <Methodology />;
        case 'settings': return <Settings />;
        case 'backup': return <Backup />;
        case 'weekly': return <Weekly />;
        case 'calendar': return <CalendarPage />;
        case 'disposition': return <Disposition />;
        default: return <More />;
      }
    default: return <Placeholder title="找不到頁面" back="/" />;
  }
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    getSetting<string>('theme', 'auto').then((t) => {
      if (t === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    });
  }, []);
  return (
    <>
      <main class="app" id="main">
        <BackupReminder />
        <div class="page-body"><Page parts={route.parts} /></div>
        <Footer />
      </main>
      <TabBar path={route.path} />
    </>
  );
}
