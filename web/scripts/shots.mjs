// 通用截圖：指定路由清單，以 iPhone 18 Pro 的 Safari 直向 viewport（402×874，3 倍密度）拍淺色與深色。
// 用法：CJK_FONT_DIR=… node scripts/shots.mjs --base http://localhost:4173/twse-money-flow/ --out ../docs/design/lab-v2 \
//   --routes "evidence=#/explore/evidence,strategies=#/explore/strategies" [--width 402 --height 874] [--full 1] [--click "文字"]
import { chromium } from '@playwright/test';
import { useCjkFont } from './cjk-font.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const width = Number(args.width ?? 402);
const height = Number(args.height ?? 874);
mkdirSync(args.out, { recursive: true });
const routes = String(args.routes).split(',').map((s) => s.split('='));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const scheme of (args.schemes ?? 'light,dark').split(',')) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, colorScheme: scheme, isMobile: true, hasTouch: true });
  await useCjkFont(ctx);
  // 主題：預設深色、不跟隨系統（產品原則 2）；截圖時明確指定
  await ctx.addInitScript((s) => { try { localStorage.setItem('tmf-theme', s); } catch { /* 無痕 */ } }, scheme);
  for (const [name, hash] of routes) {
    const page = await ctx.newPage();
    await page.goto(`${args.base}${hash}`);
    await page.waitForTimeout(2500);
    if (args.click) {
      for (const text of String(args.click).split('|')) {
        const el = page.getByText(text, { exact: false }).first();
        if (await el.count()) { await el.click(); await page.waitForTimeout(900); }
      }
    }
    if (args.scroll) { await page.locator(args.scroll).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(600); }
    await page.screenshot({ path: `${args.out}/${name}-${scheme}.png`, fullPage: args.full === '1' });
    process.stdout.write(`${name}-${scheme} `);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
process.stdout.write('\n');
