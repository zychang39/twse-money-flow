// 第四輪的驗收截圖（docs/design/round4/）：底部導覽（深淺色、選取膠囊滑動中的畫格、按住拖曳的放大膠囊、搜尋頁）
// 與個股頁左右換股（拖曳中、後一檔被帶出）。iPhone 393pt × 深色／淺色。
// 用法：CJK_FONT_DIR=… node scripts/round4-shots.mjs --base http://127.0.0.1:4306/twse-money-flow/ --out ../docs/design/round4
import { chromium } from '@playwright/test';
import { useCjkFont } from './cjk-font.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
mkdirSync(args.out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const W = 393;
const H = 852;
const DOCK = { x: 0, y: H - 110, width: W, height: 110 };

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, colorScheme: scheme, isMobile: true, hasTouch: true });
  await useCjkFont(ctx);
  const page = await ctx.newPage();
  const shot = async (name, clip) => { await page.screenshot({ path: `${args.out}/${scheme}-${name}.jpg`, type: 'jpeg', quality: 82, ...(clip ? { clip } : {}) }); process.stdout.write(`${scheme}-${name} `); };
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

  // 底部導覽：各分頁的選取狀態
  await page.goto(`${args.base}#/`);
  await page.waitForTimeout(2500);
  await shot('01-dock-tonight', DOCK);
  // 選取膠囊滑動中的三個畫格（今晚 → 探索）：暫停動畫在 0.09／0.18／0.3 秒
  await page.locator('.tabbar a').nth(2).click();
  for (const t of [90, 180, 300]) {
    await page.locator('.tab-indicator').evaluate((el, ms) => { for (const a of el.getAnimations()) { a.pause(); a.currentTime = ms; } }, t);
    await shot(`02-dock-sliding-${t}ms`, DOCK);
  }
  await page.locator('.tab-indicator').evaluate((el) => { for (const a of el.getAnimations()) a.finish(); });
  await page.waitForTimeout(300);
  await shot('03-dock-explore', DOCK);
  // 按住拖曳：放大的選取膠囊跟著手指
  const links = await page.locator('.tabbar a').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await touch('touchStart', links[2].x, links[2].y);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', links[2].x + ((links[3].x - links[2].x) * i) / 10, links[2].y); await page.waitForTimeout(16); }
  await shot('04-dock-drag-lens', DOCK);
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(800);
  // 搜尋頁（鍵盤收起）：導覽列在搜尋框下方
  await page.goto(`${args.base}#/search`);
  await page.waitForTimeout(1800);
  await page.getByRole('searchbox').first().blur();
  await shot('05-search');

  // 個股頁左右換股：自選 2330、2317、2454，從 2317 往左拖到一半
  await page.goto(`${args.base}#/mine`);
  await page.evaluate(() => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: ['2330', '2317', '2454'] })));
  await page.goto(`${args.base}#/stock/2317`);
  await page.waitForTimeout(2800);
  await shot('06-stock-before');
  await touch('touchStart', 330, 200);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', 330 - i * 14, 202); await page.waitForTimeout(16); }
  await shot('07-stock-swiping');
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(900);
  await shot('08-stock-after');
  await ctx.close();
}
await browser.close();
process.stdout.write('\ndone\n');
