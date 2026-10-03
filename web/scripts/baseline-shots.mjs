// 改版前基準截圖（402×874 @3x，Safari 直向尺寸）：首屏＋全頁。
// 用法：node scripts/baseline-shots.mjs --base http://localhost:4174/twse-money-flow/ --out ../docs/screens/restore-2026-10/baseline
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4174/twse-money-flow/');
const OUT = arg('out', '../docs/screens/restore-2026-10/baseline');
const PAGES = (arg('pages', 'brief=#/,stock=#/stock/2330')).split(',').map((s) => s.split('='));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW',
});
await ctx.addInitScript(() => { try { localStorage.setItem('tmf-theme', 'dark'); } catch { /* 私密模式 */ } });
await useCjkFont(ctx);
const page = await ctx.newPage();
for (const [id, hash] of PAGES) {
  await page.goto(BASE + hash);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  await page.screenshot({ path: `${OUT}/${id}-full.jpg`, fullPage: true, quality: 70, type: 'jpeg' });
}
await browser.close();
