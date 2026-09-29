// 通用截圖：指定路由清單，以 iPhone 18 Pro 的 Safari 直向 viewport（402×874，3 倍密度）拍淺色與深色。
// 用法：CJK_FONT_DIR=… node scripts/shots.mjs --base http://localhost:4173/twse-money-flow/ --out ../docs/design/lab-v2 \
//   --routes "evidence=#/explore/evidence,strategies=#/explore/strategies" [--width 402 --height 874] [--full 1] [--click "文字"] [--fill "標籤=值"] [--scroll 選擇器]
import { chromium } from '@playwright/test';
import { useCjkFont } from './cjk-font.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const width = Number(args.width ?? 402);
const height = Number(args.height ?? 874);
mkdirSync(args.out, { recursive: true });
const routes = String(args.routes).split(',').map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]);
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
    if (args.fill) {
      // --fill "欄位標籤=值|…"：填入表單（例：槓桿計算調整可承受回撤）
      for (const pair of String(args.fill).split('|')) {
        const [label, value] = pair.split('=');
        await page.getByLabel(label).first().fill(value);
        await page.waitForTimeout(400);
      }
    }
    if (args.scroll) {
      // 個股頁下方區塊延後渲染：先逐步捲到底把區塊畫出來，再捲到目標（目標置頂，扣掉頂部導覽）
      for (let i = 0; i < 20 && (await page.locator('.sections-placeholder').count()); i++) {
        await page.locator('.sections-placeholder').first().scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
        await page.waitForTimeout(120);
      }
      await page.locator(args.scroll).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: `${args.out}/${name}-${scheme}.png`, fullPage: args.full === '1' });
    process.stdout.write(`${name}-${scheme} `);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
process.stdout.write('\n');
