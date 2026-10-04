import { useEffect, useState } from 'preact/hooks';
import { IconClose } from './components/Icons';
import { useRoute } from './router';
import { normCode } from './lib/code';
import { AmbientLayer, Dock } from './components/Chrome';
import { Footer } from './components/Footer';
import { HelpHost } from './components/kit';
import { lazy } from './lazy';
import Tonight from './pages/Tonight';
import Placeholder from './pages/Placeholder';
import { subscribe } from './db/db';
import { BackupReminder } from './components/BackupReminder';
import { applyAppearance } from './lib/appearance';
import { getUpdater, subscribeUpdate, updateState, type UpdateState } from './lib/swUpdate';

const Mine = lazy(() => import('./pages/Mine'));
const Stock = lazy(() => import('./pages/Stock'));
const Explore = lazy(() => import('./pages/Explore'));
const Screener = lazy(() => import('./pages/Screener'));
const ScreenerCustom = lazy(() => import('./pages/ScreenerCustom'));
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
const DataPage = lazy(() => import('./pages/Data'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Settings = lazy(() => import('./pages/Settings'));
const Backup = lazy(() => import('./pages/Backup'));
const Search = lazy(() => import('./pages/Search'));
const Institutional = lazy(() => import('./pages/Institutional'));
const Holders = lazy(() => import('./pages/Holders'));
const BullBear = lazy(() => import('./pages/BullBear'));
const StockDaily = lazy(() => import('./pages/StockDaily'));
const StockMomentum = lazy(() => import('./pages/StockMomentum'));
const StockScores = lazy(() => import('./pages/StockScores'));
const StockChipDetail = lazy(() => import('./pages/StockChipDetail'));
const Evidence = lazy(() => import('./pages/Evidence'));
const Strategies = lazy(() => import('./pages/Strategies'));
const Leverage = lazy(() => import('./pages/Leverage'));
const Glossary = lazy(() => import('./pages/Glossary'));
const Gallery = lazy(() => import('./pages/Gallery'));

function Page({ parts }: { parts: string[] }) {
  const [a, b, c, d] = parts;
  switch (a) {
    case undefined: return <Tonight />;
    case 'mine': return <Mine />;
    // 元件展示頁（僅開發用；沒有任何入口）
    case 'dev': return <Gallery />;
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
        case 'daily': return <StockDaily code={code} />;
        case 'm': return <StockMomentum code={code} card={d ?? 'returns'} />;
        case 'scores': return <StockScores code={code} />;
        case 'c': return <StockChipDetail code={code} card={d ?? 'qfii'} />;
        default: return <Placeholder title="找不到頁面" back={`/stock/${b}`} />;
      }
    }
    case 'explore':
      switch (b) {
        case undefined: return <Explore />;
        case 'screener': return c === 'custom' ? <ScreenerCustom /> : <Screener />;
        case 'backtest': return <Backtest />;
        case 'sectors': return <Sectors industry={c} />;
        case 'etf': return <Etf />;
        case 'market': return <MarketTemp />;
        case 'calendar': return <CalendarPage />;
        case 'disposition': return <Disposition />;
        case 'evidence': return <Evidence />;
        case 'strategies': return <Strategies id={c} />;
        case 'leverage': return <Leverage />;
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
        case 'data': return <DataPage />;
        case 'methodology': return <Methodology />;
        case 'settings': return <Settings />;
        case 'backup': return <Backup />;
        case 'glossary': return <Glossary />;
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

export { applyAppearance };

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
      <AmbientLayer />
      <main class="app" id="main">
        <div class="page-body">
          <BackupReminder />
          <Page parts={route.parts} />
        </div>
        <Footer />
      </main>
      <Dock path={route.path} />
      <HelpHost />
      <UpdateToast />
    </>
  );
}
