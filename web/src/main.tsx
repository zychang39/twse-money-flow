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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('SW 註冊失敗', e));
  });
}
