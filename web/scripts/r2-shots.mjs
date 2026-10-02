// 2026-10-02 第二輪：新畫面截圖（iPhone 402×874、深淺色）→ docs/audit/signals/shots/r2/
// 用法：npm run build && (npx vite preview --port 4173 &) &&
//   AFTER_DIR=<本輪 strategies.json 等的目錄> DETAIL_ID=<策略 id> PW_CHROMIUM_PATH=… node scripts/r2-shots.mjs
// 舊畫面＝第一輪的 shots/strategies-after-*.png（第一輪結束時的策略庫），本輪不重拍。
import { chromium, devices } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useCjkFont } from './cjk-font.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/twse-money-flow/';
const OUT = new URL('../../docs/audit/signals/shots/r2/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const dir = process.env.AFTER_DIR;
if (!dir) throw new Error('AFTER_DIR 必填');

async function fixtures(ctx) {
  const files = ['evidence.json', 'strategies.json', 'evidence_today.json'];
  const evDir = join(dir, 'evidence');
  if (existsSync(evDir)) files.push(...readdirSync(evDir).map((f) => `evidence/${f}`));
  for (const f of files) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    await ctx.route(`**/data/${f}`, (r) => r.fulfill({ contentType: 'application/json', body: readFileSync(p, 'utf8') }));
  }
}

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.addInitScript((t) => { localStorage.setItem('tmf-theme', t); localStorage.removeItem('tmf-bench'); localStorage.removeItem('tmf-sort-strategies'); }, theme);
  await useCjkFont(ctx);
  await fixtures(ctx);
  const p = await ctx.newPage();
  // 1. 策略庫三區（第三區收合）
  await p.goto(`${BASE}#/explore/strategies`);
  await p.getByTestId('st-sec-停用').waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}strategies-${theme}.png`, fullPage: true });
  // 2. 第三區展開
  await p.getByTestId('st-sec-停用').getByRole('button').click();
  await p.getByTestId('st-sec-停用-list').waitFor();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}strategies-expanded-${theme}.png`, fullPage: true });
  // 3. 排序選單
  await p.getByRole('button', { name: '排序', exact: true }).click();
  await p.getByRole('menu', { name: '排序方式' }).waitFor();
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}sort-menu-${theme}.png` });
  await p.keyboard.press('Escape');
  // 4. 策略頁（波段策略：三段、門檻、延後、前瞻）
  const detail = process.env.DETAIL_ID || 'rev_confirm';
  await p.goto(`${BASE}#/explore/strategies/${detail}`);
  await p.getByTestId('swing-gates').waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}strategy-${detail}-${theme}.png`, fullPage: true });
  // 5. 現有策略頁（分級標籤與理由）
  const old = process.env.DETAIL_OLD || 'revenue_year_high';
  await p.goto(`${BASE}#/explore/strategies/${old}`);
  await p.getByTestId('grade-tag').first().waitFor();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}strategy-${old}-${theme}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.warn('saved to', OUT);
