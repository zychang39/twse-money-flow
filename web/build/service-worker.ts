/**
 * Vite 外掛：build 時產生 sw.js。
 * - App 外殼（HTML、JS、CSS、圖示）：cache-first，版本以 build 雜湊區分。
 * - 資料（data/*.json）：stale-while-revalidate。
 *
 * 更新流程（見 src/lib/swUpdate.ts）：新版安裝後停在 waiting，由頁面送 SKIP_WAITING 才接手；
 * 頁面在 controllerchange 時重新載入。安裝時外殼一律向網路重新取得（cache: 'reload'，index.html 另加版本參數避開
 * GitHub Pages CDN 的 10 分鐘快取），並確認 index.html 引用的是這一版的入口檔，否則安裝失敗、下次再試——
 * 避免新版 service worker 把舊的 index.html 永久存進快取（使用者一直停在舊版的根本原因之一）。
 */
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

export function serviceWorker(appVersion = 'dev'): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && !f.startsWith('.vite/'));
      const entry = Object.values(bundle).find((b) => b.type === 'chunk' && b.isEntry)?.fileName ?? '';
      const shell = ['./manifest.webmanifest', './icons/icon-192.png', ...files.map((f) => `./${f}`)];
      const version = createHash('sha256').update(files.sort().join('|') + appVersion).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource({ version, appVersion, entry, shell: [...new Set(shell)] }) });
    },
  };
}

export function swSource({ version, appVersion, entry, shell }: { version: string; appVersion: string; entry: string; shell: string[] }): string {
  return `/* 自動產生：勿手改 */
const VERSION = ${JSON.stringify(version)};
const APP_VERSION = ${JSON.stringify(appVersion)};
const ENTRY = ${JSON.stringify(entry)};
const SHELL_CACHE = 'app-' + VERSION;
const DATA_CACHE = 'data-v1';
const SHELL = ${JSON.stringify(shell)};
const isShellCache = (k) => k.startsWith('app-') || k.startsWith('shell-');

async function fillShell() {
  // index.html：加版本參數避開 CDN 快取，並確認引用的是這一版的入口檔（先驗證，再建立快取）
  const res = await fetch('./index.html?v=' + VERSION, { cache: 'reload' });
  if (!res.ok) throw new Error('index.html ' + res.status);
  const html = await res.text();
  if (ENTRY && !html.includes(ENTRY)) throw new Error('index.html 不是這一版（' + ENTRY + '）');
  const cache = await caches.open(SHELL_CACHE);
  try {
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    await cache.put('./index.html', new Response(html, { headers }));
    await cache.put('./', new Response(html, { headers }));
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
  } catch (e) {
    await caches.delete(SHELL_CACHE); // 不留下半套的快取
    throw e;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await fillShell();
    // 從舊版（安裝後自動接手、沒有 SKIP_WAITING 協定）升級：舊頁面不會送訊息，沿用舊行為直接接手一次
    const keys = await caches.keys();
    if (keys.some((k) => k.startsWith('shell-')) && !keys.some((k) => k.startsWith('app-') && k !== SHELL_CACHE)) self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // 保留前一版外殼一份：其他分頁可能仍在跑舊版，懶載入的舊檔案還拿得到
      const old = keys.filter((k) => isShellCache(k) && k !== SHELL_CACHE);
      return Promise.all(old.slice(0, -1).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/data/')) {
    // 資料：先回快取（若有），同時背景更新
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }
  // App 外殼：cache-first，先查這一版的快取（caches.match 會依建立順序先找到舊版的 index.html）；導覽請求回 index.html
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' }))
      || (req.mode === 'navigate' ? await cache.match('./index.html') : null)
      || (await caches.match(req));
    return hit || fetch(req);
  })());
});
`;
}
