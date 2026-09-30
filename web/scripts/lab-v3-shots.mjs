// v3 實驗室驗收截圖：iPhone 18 Pro 402×874 × 深色／淺色 → docs/design/lab-v3/
// 用法：npm run build && (npx vite preview --port 4173 &) && CJK_FONT_DIR=… PW_CHROMIUM_PATH=… node scripts/lab-v3-shots.mjs
// 評估資料用 e2e/fixtures（data 分支 2026-09-30 本機重算）。
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/twse-money-flow/';
const OUT = new URL('../../docs/design/lab-v3/', import.meta.url).pathname;
const FIX = new URL('../e2e/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

async function fixtures(ctx) {
  const files = ['evidence.json', 'strategies.json', 'evidence_today.json', ...readdirSync(new URL('evidence/', FIX)).map((f) => `evidence/${f}`)];
  for (const f of files) await ctx.route(`**/data/${f}`, (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(new URL(f, FIX), 'utf8') }));
}

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { localStorage.setItem('tmf-theme', t); localStorage.removeItem('tmf-bench'); }, theme);
  await useCjkFont(ctx);
  await fixtures(ctx);
  const p = await ctx.newPage();
  // 1. 指標效度表：基準分段控制＋列表；四種基準表；排序選單
  await p.goto(`${BASE}#/explore/evidence`);
  await p.getByTestId('ev-list').locator('.ev-label').first().waitFor();
  await p.getByTestId('bench-switch').scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -60));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}bench-switch-${theme}.png` });
  await p.evaluate(() => { const el = document.querySelector('.sort-head'); if (el) window.scrollBy(0, el.getBoundingClientRect().top - 180); });
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: '排序', exact: true }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}sort-menu-${theme}.png` });
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: /接近 52 週高點/ }).click();
  const tbl = p.getByRole('table', { name: '相對四種基準的超額' });
  await tbl.waitFor();
  await tbl.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, 120));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}evidence-four-bench-${theme}.png` });
  // 2. 策略頁逐年表（對照基準）＋權益曲線
  await p.goto(`${BASE}#/explore/strategies/revenue_year_high`);
  await p.getByRole('heading', { name: '逐年報酬' }).waitFor();
  await p.getByRole('button', { name: '對照基準' }).click();
  await p.getByRole('heading', { name: '逐年報酬' }).scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, 250));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}strategy-yearly-${theme}.png` });
  // 3. 三方同買：累積超額曲線（拖曳讀值）
  await p.goto(`${BASE}#/explore/strategies/three_buyers`);
  const svg = p.locator('svg.ac-svg').first();
  await svg.waitFor();
  await svg.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, 160));
  const box = await svg.boundingBox();
  await p.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}three-buyers-curve-${theme}.png` });
  await p.mouse.up();
  await ctx.close();
}
await browser.close();
console.warn('saved to', OUT);
