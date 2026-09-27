import { render } from 'preact';
import { App } from './app';
import './styles/global.css';

/**
 * 顯示模式：加入主畫面（standalone）與 Safari 瀏覽器模式的 safe-area 處理不同（見 global.css）。
 * CSS 以 @media (display-mode: standalone) 判斷；iOS 舊版只提供 navigator.standalone，
 * 所以同時在 <html> 加上 .standalone（驗收截圖也用這個 class 模擬）。
 */
const nav = navigator as Navigator & { standalone?: boolean };
if (window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone) document.documentElement.classList.add('standalone');

render(<App />, document.getElementById('app')!);

/**
 * Service worker：App 外殼是 cache-first，新版本要等新的 service worker 接手後才生效。
 * - 每次回到前景都檢查更新（iOS 加入主畫面的 App 很少主動檢查）。
 * - 新版本接手（controllerchange）時發出 app-updated，畫面顯示「新版本已就緒」，由使用者決定何時重新載入，
 *   不在使用中途自動重新整理。第一次安裝（原本沒有 controller）不提示。
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) window.dispatchEvent(new Event('app-updated'));
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    }).catch((e) => console.warn('SW 註冊失敗', e));
  });
}
