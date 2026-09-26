/**
 * Vite 外掛：build 時產生 sw.js。
 * - App 外殼（HTML、JS、CSS、圖示）：cache-first，版本以 build 雜湊區分。
 * - 資料（data/*.json）：stale-while-revalidate。
 */
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

export function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const shell = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', ...files.map((f) => `./${f}`)];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const source = `/* 自動產生：勿手改 */
const VERSION = ${JSON.stringify(version)};
const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data-v1';
const SHELL = ${JSON.stringify([...new Set(shell)])};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
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
  // App 外殼：cache-first；導覽請求回 index.html
  event.respondWith(
    caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : null)).then((hit) => hit || fetch(req)),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
