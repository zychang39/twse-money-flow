import { render } from 'preact';
import { App } from './app';
import './styles/global.css';
import { createUpdater, domBusy, getUpdater, publishState, setUpdater } from './lib/swUpdate';

/**
 * 顯示模式：加入主畫面（standalone）與 Safari 瀏覽器模式的 safe-area 處理不同（見 global.css）。
 * CSS 以 @media (display-mode: standalone) 判斷；iOS 舊版只提供 navigator.standalone，
 * 所以同時在 <html> 加上 .standalone（驗收截圖也用這個 class 模擬）。
 */
const nav = navigator as Navigator & { standalone?: boolean };
if (window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone) document.documentElement.classList.add('standalone');

render(<App />, document.getElementById('app')!);

/**
 * Service worker：App 外殼是 cache-first，新版安裝後停在 waiting，由 lib/swUpdate 決定何時接手：
 * 啟動或回到前景 3 秒內、使用者還沒操作就自動套用並重新載入；正在操作時只顯示「有新版本，點此更新」。
 * 監聽在 register 之前就接好（不等 load），避免錯過啟動時的 updatefound／controllerchange。
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const container = navigator.serviceWorker;
  let interacted = false;
  const mark = () => { interacted = true; getUpdater()?.markInteraction(); };
  window.addEventListener('pointerdown', mark, { capture: true, passive: true });
  window.addEventListener('keydown', mark, { capture: true, passive: true });
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).then((reg) => {
    const updater = createUpdater({
      reg,
      container,
      now: () => performance.now(),
      isBusy: () => domBusy(),
      reload: () => location.reload(),
      onState: publishState,
      startedAt: 0, // performance.now() 從頁面載入起算：自動套用的時間窗從啟動開始
    });
    if (interacted) updater.markInteraction();
    setUpdater(updater);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updater.foreground().catch(() => undefined);
    });
    updater.check().catch(() => undefined);
  }).catch((e) => { console.warn('SW 註冊失敗', e); setUpdater(null); });
} else {
  setUpdater(null);
}
