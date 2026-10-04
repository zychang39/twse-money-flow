// 元素截圖（402 寬 @2x）：檢查單一區塊。用法：node scripts/el-shots.mjs --base URL --out DIR --items "name=hash|selector,..."
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4175/twse-money-flow/');
const OUT = arg('out', '/tmp/el');
const W = Number(arg('width', '402'));
mkdirSync(OUT, { recursive: true });
const items = arg('items', '').split(',').filter(Boolean).map((s) => { const [n, r] = [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]; const [h, sel] = r.split('|'); return { n, h, sel }; });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
await ctx.addInitScript(() => { try { localStorage.setItem('tmf-theme', 'dark'); } catch { /* */ } });
await useCjkFont(ctx);
const page = await ctx.newPage();
for (const it of items) {
  await page.goto(BASE + it.h);
  const el = page.locator(it.sel).first();
  await el.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await el.screenshot({ path: `${OUT}/${it.n}.png`, animations: 'disabled' });
}
await browser.close();
