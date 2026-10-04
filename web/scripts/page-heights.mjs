// 每頁（含分段）內容高度＝幾個螢幕高（402×874）：改版前後比較用。
// 用法：node scripts/page-heights.mjs --base URL [--seed seed.json] --pages "名稱=#/hash,…"
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4173/twse-money-flow/');
const PAGES = arg('pages', '').split(',').filter(Boolean).map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
const SEED = arg('seed', '');
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark', timezoneId: 'Asia/Taipei' });
const page = await ctx.newPage();
if (SEED) {
  const s = JSON.parse(readFileSync(SEED, 'utf8'));
  await page.goto(BASE);
  await page.waitForTimeout(1500);
  await page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const tx = db.transaction(['watchlist', 'trades'], 'readwrite');
    for (const w of s.watchlist ?? []) tx.objectStore('watchlist').put({ origin: 'user', ...w });
    for (const t of s.trades ?? []) tx.objectStore('trades').put(t);
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, s);
}
const out = {};
for (const [name, hash] of PAGES) {
  await page.goto(BASE + hash);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  out[name] = Math.round((h / 874) * 10) / 10;
}
console.log(JSON.stringify(out));
await browser.close();
