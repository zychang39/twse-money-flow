// 2026-10 改版截圖（簡報、個股四個分段、策略詳情、主動式 ETF、流程）：402×874 @3x 為主、440×956 為輔、375 抽查。
// 用法：node scripts/redesign-shots.mjs --base <網址> --out <目錄> [--tag before|after] [--seed ../docs/design/screens/seed.json]
//   改版前用線上版（https://zychang39.github.io/twse-money-flow/）；改版後用本機 vite preview（真實資料 build）。
//   CJK_FONT_DIR 指向 @fontsource/noto-sans-tc（截圖環境沒有蘋方，見 cjk-font.mjs）。
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4173/twse-money-flow/');
const OUT = arg('out', '../docs/screens/redesign-2026-10');
const TAG = arg('tag', 'after');
const SEED = arg('seed', '../docs/design/screens/seed.json');
const STRATEGY = arg('strategy', 'revenue_year_high');
const seed = JSON.parse(readFileSync(SEED, 'utf8'));
const after = TAG === 'after';

const SEGMENTS = ['動能', '籌碼', '基本面', '事件'];
const PAGES = [
  { id: '01-brief', hash: '#/' },
  ...(after ? SEGMENTS.map((s, i) => ({ id: `02-stock-${i + 1}`, hash: '#/stock/2330', seg: s })) : [{ id: '02-stock', hash: '#/stock/2330' }]),
  { id: '03-strategy', hash: `#/explore/strategies/${STRATEGY}` },
  { id: '04-etf', hash: '#/explore/etf' },
  { id: '05-flow', hash: '#/discipline' },
];
const SIZES = [
  { id: '402', width: 402, height: 874, scale: 3, pages: PAGES },
  { id: '440', width: 440, height: 956, scale: 2, pages: PAGES },
  { id: '375', width: 375, height: 812, scale: 2, pages: PAGES.filter((p) => !p.seg || p.seg === '動能') },
];

async function seedDb(page) {
  await page.waitForFunction(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const ok = r.result.objectStoreNames.contains('trades'); r.result.close(); res(ok); };
    r.onerror = () => res(false);
  }), null, { timeout: 20000 });
  await page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const tx = db.transaction(['watchlist', 'settings'], 'readwrite');
    for (const w of s.watchlist) tx.objectStore('watchlist').put({ origin: 'user', ...w });
    tx.objectStore('settings').put({ key: 'firstUseAt', value: new Date().toISOString() });
    tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
  }, seed);
}

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, isMobile: true, hasTouch: true,
    colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW',
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('tmf-theme', 'dark'); } catch { /* 私密模式 */ } });
  await useCjkFont(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await seedDb(page);
  const dir = `${OUT}/${TAG}/${size.id}`;
  mkdirSync(dir, { recursive: true });
  for (const p of size.pages) {
    await page.goto(`${BASE}${p.hash}`);
    await page.reload();
    await page.waitForTimeout(3500);
    if (p.seg) {
      const b = page.getByRole('tab', { name: p.seg }).or(page.getByRole('button', { name: p.seg, exact: true })).first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(1200); }
    }
    // 全頁截圖前先捲到底（觸發延後載入的區塊），再回到頂端
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${dir}/${p.id}.jpg`, type: 'jpeg', quality: 72, fullPage: true });
    process.stdout.write(`${size.id}/${p.id} `);
  }
  await ctx.close();
}
await browser.close();
process.stdout.write('\ndone\n');
