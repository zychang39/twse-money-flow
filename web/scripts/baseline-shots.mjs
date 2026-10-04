// 改版前基準截圖（402×874 @3x，Safari 直向尺寸）：首屏＋全頁。
// 用法：node scripts/baseline-shots.mjs --base http://localhost:4174/twse-money-flow/ --out ../docs/screens/restore-2026-10/baseline
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4174/twse-money-flow/');
const OUT = arg('out', '../docs/screens/restore-2026-10/baseline');
const PAGES = (arg('pages', 'brief=#/,stock=#/stock/2330')).split(',').map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
mkdirSync(OUT, { recursive: true });
const SEED = arg('seed', '');
const FULL = arg('full', '1') !== '0';
async function seedDb(page, seed) {
  await page.waitForFunction(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const ok = r.result.objectStoreNames.contains('trades'); r.result.close(); res(ok); };
    r.onerror = () => res(false);
  }), null, { timeout: 20000 });
  await page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const tx = db.transaction(['watchlist', 'settings', 'trades'], 'readwrite');
    for (const w of s.watchlist ?? []) tx.objectStore('watchlist').put({ origin: 'user', ...w });
    for (const t of s.trades ?? []) tx.objectStore('trades').put(t);
    tx.objectStore('settings').put({ key: 'firstUseAt', value: new Date().toISOString() });
    for (const st of s.settings ?? []) tx.objectStore('settings').put(st);
    tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, seed);
}
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({
  viewport: { width: Number(arg('width', '402')), height: Number(arg('height', '874')) }, deviceScaleFactor: Number(arg('scale', '3')), isMobile: true, hasTouch: true,
  colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW',
});
await ctx.addInitScript(() => { try { localStorage.setItem('tmf-theme', 'dark'); } catch { /* 私密模式 */ } });
await useCjkFont(ctx);
const page = await ctx.newPage();
if (SEED) { await page.goto(BASE); await seedDb(page, JSON.parse(readFileSync(SEED, 'utf8'))); }
for (const [id, hash] of PAGES) {
  await page.goto(BASE + hash);
  await page.waitForTimeout(2500);
  if (arg('fmt', 'png') === 'jpg') await page.screenshot({ path: `${OUT}/${id}.jpg`, quality: 80, type: 'jpeg' }); else await page.screenshot({ path: `${OUT}/${id}.png` });
  if (FULL) await page.screenshot({ path: `${OUT}/${id}-full.jpg`, fullPage: true, quality: 70, type: 'jpeg' });
}
await browser.close();
