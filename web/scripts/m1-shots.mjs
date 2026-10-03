// 2026-10-02 健檢驗收截圖：390×844（iPhone 14／15 的 CSS 寬度）深色，每個里程碑 6 張關鍵頁 → docs/screens/audit-2026-10/{m1|m2}/
// 用法：npm run build && npx vite preview --port 4173 & node scripts/m1-shots.mjs [m1|m2]
// 需要真實衍生資料（python -m pipeline build-web --data-dir data --out web/public/data）才會有策略與效度表的數字。
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/twse-money-flow/';
const TAG = process.argv[2] || 'm1';
const OUT = new URL(`../../docs/screens/audit-2026-10/${TAG}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  localStorage.setItem('tmf-theme', 'dark');
  localStorage.setItem('tmf-style', 'swing');
  localStorage.setItem('tmf-bench', '0050');
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

async function revealAll() {
  for (let i = 0; i < 30; i++) {
    const ph = p.locator('.sections-placeholder');
    if (!(await ph.count())) break;
    await ph.scrollIntoViewIfNeeded().catch(() => undefined);
    await p.waitForTimeout(150);
  }
  // 讓所有 lazy 區塊與圖表畫完
  await p.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(800);
}

async function shot(name, hash, ready) {
  await p.goto(`${BASE}#${hash}`);
  await p.waitForTimeout(800);
  if (ready) await ready().catch(() => undefined);
  await revealAll();
  await p.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.warn(`✓ ${name}`);
}

// 第一個上架策略（有效或觀察中）的 id；沒有就拿第一套
const st = await (await p.request.get(`${BASE}data/strategies.json`)).json();
const listed = st.strategies.find((s) => s.grade === '有效' || s.grade === '觀察中') ?? st.strategies[0];
// 自選用範例自選（首頁與我的股票才有內容）
await p.goto(`${BASE}#/mine`);
await p.waitForTimeout(1000);
const sample = p.getByRole('button', { name: /加入範例自選/ });
if (await sample.count()) { await sample.first().click(); await p.waitForTimeout(800); }

await shot('01-home', '/', () => p.locator('.hero-block').first().waitFor());
await shot('02-mine', '/mine', () => p.locator('.stock-list').first().waitFor());
await shot('03-explore', '/explore', () => p.locator('.tile-grid').waitFor());
await shot('04-strategy', `/explore/strategies/${listed.id}`, () => p.getByRole('heading', { name: '健康度' }).waitFor());
await shot('05-stock', '/stock/2330', () => p.locator('.stock-lower').waitFor());
await shot('06-evidence', '/explore/evidence', () => p.getByTestId('ev-list').waitFor());
if (TAG === 'm2') {
  await shot('07-data-status', '/me/data', () => p.locator('.page').waitFor());
}
await browser.close();
if (errors.length) { console.error('頁面 JS 錯誤：', errors); process.exit(1); }
