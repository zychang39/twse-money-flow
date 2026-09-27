// 行動體驗修正的驗收截圖：iPhone 393×852（@2x）× 瀏覽器模式／加入主畫面（standalone）× 深色／淺色。
// standalone 以 <html class="standalone"> 模擬，並把 safe-area 設為 iPhone 的實際值（上 47、下 34），畫出 Home 指示條。
// 瀏覽器模式：Safari 網址列在頁面視窗之外，safe-area 為 0。
// 用法：node scripts/ux-shots.mjs --base http://localhost:4302/twse-money-flow/ --out ../docs/design/ux-fixes/after --seed ../docs/design/screens/seed.json --variant after
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const seed = JSON.parse(readFileSync(args.seed, 'utf8'));
const after = args.variant !== 'before';
const MODES = ['browser', 'standalone'];
const SCHEMES = ['dark', 'light'];

// 改版前：搜尋是「我的股票」上的漂浮膠囊 → 全頁面板；改版後：#/search
const PAGES = [
  { id: '01-tonight', hash: '#/', wait: 2800 },
  { id: '02-mine', hash: '#/mine', wait: 3000 },
  after
    ? { id: '03-search', hash: '#/search', wait: 1500, type: '聯' }
    : { id: '03-search', hash: '#/mine', wait: 2500, open: '搜尋代號或名稱', type: '聯' },
  ...(after ? [{ id: '03b-search-empty', hash: '#/search', wait: 1800 }] : []),
  { id: '04-stock', hash: '#/stock/2330', wait: 3000 },
  { id: '05-health', hash: '#/me/health', wait: 2000 },
  { id: '06-tonight-bottom', hash: '#/', wait: 2800, bottom: true },
];

async function seedDb(page) {
  await page.waitForFunction(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const ok = r.result.objectStoreNames.contains('trades'); r.result.close(); res(ok); };
    r.onerror = () => res(false);
  }), null, { timeout: 15000 });
  await page.evaluate(async (seed) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const tx = db.transaction(['watchlist', 'trades', 'settings'], 'readwrite');
    for (const w of seed.watchlist) tx.objectStore('watchlist').put({ origin: 'user', ...w });
    for (const t of seed.trades) tx.objectStore('trades').put(t);
    tx.objectStore('settings').put({ key: 'firstUseAt', value: new Date().toISOString() });
    tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
    tx.objectStore('settings').put({ key: 'recentSearches', value: ['2330', '2454', '3037'] });
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, seed);
}

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
for (const mode of MODES) {
  for (const scheme of SCHEMES) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    await ctx.addInitScript((standalone) => {
      if (!standalone) return;
      const apply = () => {
        document.documentElement.classList.add('standalone');
        const st = document.createElement('style');
        st.textContent = ':root{--safe-top:47px!important;--safe-bottom:34px!important}'
          + '#sim-home{position:fixed;z-index:99999;left:50%;bottom:8px;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:CanvasText;opacity:.9;pointer-events:none}';
        document.head.appendChild(st);
        const bar = document.createElement('div');
        bar.id = 'sim-home';
        document.body.appendChild(bar);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
      else apply();
    }, mode === 'standalone');
    const page = await ctx.newPage();
    await page.goto(args.base);
    await seedDb(page);
    const dir = `${args.out}/${mode}-${scheme}`;
    mkdirSync(dir, { recursive: true });
    for (const p of PAGES) {
      await page.goto(`${args.base}${p.hash}`);
      await page.reload();
      await page.waitForTimeout(p.wait);
      if (p.open) {
        await page.getByRole('button', { name: p.open }).first().click();
        await page.waitForTimeout(700);
      }
      if (p.type) {
        await page.getByRole('searchbox').first().fill(p.type);
        await page.waitForTimeout(600);
      }
      if (p.bottom) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(1200); // 停止捲動後導覽列恢復
      }
      await page.screenshot({ path: `${dir}/${p.id}.jpg`, type: 'jpeg', quality: 80 });
      process.stdout.write(`${mode}-${scheme}/${p.id} `);
    }
    await ctx.close();
  }
}
// 新用戶流程（沒有任何自選）：歡迎卡 → 加入範例自選 → 熱門動能群組 → 挑幾檔加入（只有改版後有）
if (after) {
  mkdirSync(`${args.out}/new-user`, { recursive: true });
  for (const scheme of SCHEMES) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const shot = (name) => page.screenshot({ path: `${args.out}/new-user/${scheme}-${name}.jpg`, type: 'jpeg', quality: 80 });
    await page.goto(`${args.base}#/mine`);
    await page.waitForTimeout(2500);
    await shot('1-welcome');
    await page.getByRole('button', { name: '加入範例自選' }).click();
    await page.waitForTimeout(1500);
    await shot('2-sample');
    await page.getByRole('button', { name: /熱門動能/ }).first().click();
    await page.waitForTimeout(1500);
    await shot('3-hot');
    await page.getByRole('button', { name: '挑幾檔加入' }).click();
    await page.waitForTimeout(900);
    await shot('4-pick');
    await ctx.close();
    process.stdout.write(`new-user/${scheme} `);
  }
}
await browser.close();
process.stdout.write('\ndone\n');
