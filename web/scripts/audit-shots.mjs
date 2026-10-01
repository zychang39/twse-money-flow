// 2026-10-01 審查：新舊畫面截圖（iPhone 402×874、深色）→ docs/audit/signals/shots/
// 用法：npm run build && (npx vite preview --port 4173 &) &&
//   BEFORE_DIR=<舊 strategies.json 等的目錄> AFTER_DIR=<新目錄> PW_CHROMIUM_PATH=… node scripts/audit-shots.mjs
// 舊＝main 的程式在同一份 data 分支算出的 JSON；新＝本分支。頁面程式都用本分支（版面相同，只有資料與新欄位不同）。
import { chromium, devices } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useCjkFont } from './cjk-font.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/twse-money-flow/';
const OUT = new URL('../../docs/audit/signals/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

async function fixtures(ctx, dir) {
  const files = ['evidence.json', 'strategies.json', 'evidence_today.json'];
  const evDir = join(dir, 'evidence');
  if (existsSync(evDir)) files.push(...readdirSync(evDir).map((f) => `evidence/${f}`));
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    await ctx.route(`**/data/${f}`, (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(p, 'utf8') }));
  }
}

for (const [tag, dir] of [['before', process.env.BEFORE_DIR], ['after', process.env.AFTER_DIR]]) {
  if (!dir) continue;
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.addInitScript((t) => { localStorage.setItem('tmf-theme', t); localStorage.removeItem('tmf-bench'); localStorage.removeItem('tmf-sort-strategies'); }, theme);
    await useCjkFont(ctx);
    await fixtures(ctx, dir);
    const p = await ctx.newPage();
    await p.goto(`${BASE}#/explore/strategies`);
    await p.getByTestId('st-list').waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}strategies-${tag}-${theme}.png`, fullPage: true });
    await p.goto(`${BASE}#/explore/evidence`);
    await p.getByTestId('ev-list').locator('.ev-label').first().waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}evidence-${tag}-${theme}.png` });
    const detail = process.env.DETAIL_ID || 'revenue_year_high';
    await p.goto(`${BASE}#/explore/strategies/${detail}`);
    await p.getByRole('heading', { name: '健康度' }).waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}strategy-${detail}-${tag}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.warn('saved to', OUT);
