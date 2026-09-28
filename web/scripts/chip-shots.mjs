// 個股頁「每日籌碼」改版前後截圖：iPhone 375／393 寬 × 深色／淺色；改版後另拍三種檢視、放大字級的卡片版面、點列的底部面板與橫向寬度。
// 用法：node scripts/chip-shots.mjs --base http://localhost:4173/twse-money-flow/ --out ../docs/design/ux-fixes/chips --variant after [--code 2330]
import { chromium } from '@playwright/test';
import { useCjkFont } from './cjk-font.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const after = args.variant !== 'before';
const code = args.code ?? '2330';
const out = `${args.out}/${after ? 'after' : 'before'}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});

async function open(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${args.base}#/stock/${code}`);
  await page.waitForTimeout(2500);
  if (!after) await page.getByRole('button', { name: /查看明細/ }).click();
  const section = page.locator(after ? '.chip-daily' : '.chip-detail').first();
  await section.scrollIntoViewIfNeeded();
  if (after) await page.locator('#chip-daily-body').waitFor();
  await page.waitForTimeout(500);
  return { page, section };
}

for (const width of [375, 393]) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await useCjkFont(ctx);
    const { page, section } = await open(ctx);
    const shot = async (name) => { await page.mouse.move(1, 1); await section.screenshot({ path: `${out}/${width}-${scheme}-${name}.jpg`, type: 'jpeg', quality: 80 }); process.stdout.write(`${width}-${scheme}-${name} `); };
    if (!after) {
      await shot('table');
      await ctx.close();
      continue;
    }
    await shot('1-insti');
    const views = page.getByRole('group', { name: '檢視' });
    await views.getByRole('button', { name: '信用' }).click();
    await shot('2-credit');
    await views.getByRole('button', { name: '借券當沖' }).click();
    await shot('3-sbl');
    await views.getByRole('button', { name: '法人' }).click();
    if (width === 393) {
      await page.locator('.chip-daily tbody tr.day').first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/${width}-${scheme}-5-day-sheet.jpg`, type: 'jpeg', quality: 80 });
      process.stdout.write(`${width}-${scheme}-5-day-sheet `);
    }
    await ctx.close();
    // 放大字級（相當於 Dynamic Type 大 2 級以上）：寬度不夠時自動改為卡片式版面
    const big = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await useCjkFont(big);
    await big.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '125%'; }));
    const b = await open(big);
    await b.section.screenshot({ path: `${out}/${width}-${scheme}-4-large-text-cards.jpg`, type: 'jpeg', quality: 80 });
    process.stdout.write(`${width}-${scheme}-4-large-text-cards `);
    await big.close();
  }
}
if (after) {
  // 橫向（iPhone 393 橫放＝852 寬）：同時顯示全部欄位，不需要切換檢視
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await useCjkFont(ctx);
    const { page, section } = await open(ctx);
    // 寬表格刻意比所在區塊寬（置中延伸），改拍整個視窗
    await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -8));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/852-landscape-${scheme}-all.jpg`, type: 'jpeg', quality: 80 });
    process.stdout.write(`852-landscape-${scheme}-all `);
    await ctx.close();
  }
}
await browser.close();
process.stdout.write('\ndone\n');
