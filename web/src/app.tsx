import { useEffect, useState } from 'preact/hooks';
import { IconClose } from './components/Icons';
import { useRoute } from './router';
import { normCode } from './lib/code';
import { Dock } from './components/Chrome';
import { Footer } from './components/Footer';
import { lazy } from './lazy';
import Tonight from './pages/Tonight';
import Placeholder from './pages/Placeholder';
import { getSetting, subscribe } from './db/db';
import { BackupReminder } from './components/BackupReminder';
import { applyTheme } from './lib/theme';
import { getUpdater, subscribeUpdate, updateState, type UpdateState } from './lib/swUpdate';

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
const Tracking = lazy(() => import('./pages/Tracking'));
const Me = lazy(() => import('./pages/Me'));
const Health = lazy(() => import('./pages/Health'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Settings = lazy(() => import('./pages/Settings'));
const Backup = lazy(() => import('./pages/Backup'));
const Search = lazy(() => import('./pages/Search'));
const Institutional = lazy(() => import('./pages/Institutional'));
const Holders = lazy(() => import('./pages/Holders'));
const BullBear = lazy(() => import('./pages/BullBear'));
const Evidence = lazy(() => import('./pages/Evidence'));

function Page({ parts }: { parts: string[] }) {
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return <Tonight />;
    case 'mine': return <Mine />;
    case 'search': return <Search />;
    case 'stock': {
      if (!b) return <Placeholder title="個股" back="/mine" />;
      // E-08：代號一律大寫（網址另由 router 的 legacyRedirect 改成大寫）
      const code = normCode(b);
      switch (c) {
        case undefined: return <Stock code={code} />;
        case 'institutional': return <Institutional code={code} />;
        case 'holders': return <Holders code={code} />;
        case 'bullbear': return <BullBear code={code} />;
        default: return <Placeholder title="找不到頁面" back={`/stock/${b}`} />;
      }
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
        case 'evidence': return <Evidence />;
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
        case 'tracking': return <Tracking />;
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

/**
 * 更新提示（lib/swUpdate）：使用者正在操作時偵測到新版才出現；不遮擋內容、不打斷表單。
 * 點擊後送 SKIP_WAITING，新版接手時重新載入。
 */
function UpdateToast() {
  const [state, setState] = useState<UpdateState>(updateState());
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => subscribeUpdate((s) => { setState(s); if (s === 'available') setDismissed(false); }), []);
  if (state === 'idle' || dismissed) return null;
  return (
    <div class="update-toast glass" role="status" data-testid="update-toast">
      <button class="update-toast-main" disabled={state === 'applying'} onClick={() => getUpdater()?.apply()}>
        {state === 'applying' ? '更新中…' : '有新版本，點此更新'}
      </button>
      {state === 'available' ? <button class="icon-btn" aria-label="稍後" onClick={() => setDismissed(true)}><IconClose /></button> : null}
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
  // S3：啟動後（閒置時）同步訊號追蹤的新觸發；沒有追蹤策略時不下載任何資料
  useEffect(() => {
    const t = setTimeout(() => { import('./lib/trackingSync').then((m) => m.syncTracking()).catch(() => undefined); }, 2500);
    return () => clearTimeout(t);
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
