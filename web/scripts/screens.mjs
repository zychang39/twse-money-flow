// 驗收截圖：iPhone（393×852）與桌機（1440 寬）× 深淺色，使用 data 分支產生的真實資料＋測試用的使用者資料。
// 用法：node scripts/screens.mjs --base http://localhost:4180/twse-money-flow/ --out ../docs/design/screens/after --pages pages.json --seed seed.json [--only mobile-dark]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const pages = JSON.parse(readFileSync(args.pages, 'utf8'));
const seed = JSON.parse(readFileSync(args.seed, 'utf8'));
const VARIANTS = [
  { id: 'mobile-dark', viewport: { width: 393, height: 852 }, scale: 2, scheme: 'dark', mobile: true },
  { id: 'mobile-light', viewport: { width: 393, height: 852 }, scale: 2, scheme: 'light', mobile: true },
  { id: 'desktop-dark', viewport: { width: 1440, height: 900 }, scale: 1, scheme: 'dark', mobile: false },
  { id: 'desktop-light', viewport: { width: 1440, height: 900 }, scale: 1, scheme: 'light', mobile: false },
].filter((v) => !args.only || args.only.split(',').includes(v.id));

async function seedDb(page, extra = {}) {
  await page.waitForFunction(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const ok = r.result.objectStoreNames.contains('trades'); r.result.close(); res(ok); };
    r.onerror = () => res(false);
  }), null, { timeout: 15000 });
  await page.evaluate(async ({ seed, extra }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const stores = ['watchlist', 'trades', 'settings', ...(db.objectStoreNames.contains('activity') ? ['activity'] : [])];
    const tx = db.transaction(stores, 'readwrite');
    for (const w of seed.watchlist) tx.objectStore('watchlist').put(w);
    for (const t of seed.trades) tx.objectStore('trades').put(t);
    tx.objectStore('settings').put({ key: 'firstUseAt', value: new Date().toISOString() });
    tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
    for (const [key, value] of Object.entries(extra.settings ?? {})) tx.objectStore('settings').put({ key, value });
    for (const a of extra.activity ?? []) if (stores.includes('activity')) tx.objectStore('activity').put(a);
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, { seed, extra });
}

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
for (const v of VARIANTS) {
  const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.scale, colorScheme: v.scheme, isMobile: v.mobile, hasTouch: v.mobile, reducedMotion: args.motion === 'reduce' ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.goto(args.base);
  await seedDb(page, JSON.parse(args.extra ?? '{}'));
  const dir = `${args.out}/${v.id}`;
  mkdirSync(dir, { recursive: true });
  for (const p of pages) {
    await page.goto(`${args.base}${p.hash}`);
    await page.reload();
    await page.waitForTimeout(p.wait ?? 2200);
    for (const step of p.steps ?? []) {
      if (step.click) await page.getByRole(step.role ?? 'button', { name: new RegExp(step.click) }).first().click();
      if (step.rightclickSel) await page.locator(step.rightclickSel).first().dispatchEvent('contextmenu');
      if (step.rightclick) await page.getByRole(step.role ?? 'button', { name: new RegExp(step.rightclick) }).first().click({ button: 'right' });
      if (step.scroll) await page.evaluate((y) => window.scrollTo(0, y), step.scroll);
      await page.waitForTimeout(step.wait ?? 600);
    }
    // 整頁截圖時固定元素會出現在中間，改為隱藏（Tab 與搜尋膠囊另見視窗截圖）
    if (p.full) await page.addStyleTag({ content: '.tabbar, .search-float { display: none !important; }' });
    const jpeg = args.format === 'jpeg';
    await page.screenshot({ path: `${dir}/${p.id}.${jpeg ? 'jpg' : 'png'}`, fullPage: !!p.full, ...(jpeg ? { type: 'jpeg', quality: 82 } : {}) });
    process.stdout.write(`${v.id}/${p.id} `);
  }
  await ctx.close();
}
await browser.close();
process.stdout.write('\ndone\n');
