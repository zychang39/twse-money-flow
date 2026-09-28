// v3 驗收截圖：iPhone 393×852 × 深色／淺色 → docs/design/v3/
// 用法：npm run build && npx vite preview --port 4173 & node scripts/v3-shots.mjs（示範資料：python -m pipeline demo-data --out web/public/data）
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/twse-money-flow/';
const OUT = new URL('../../docs/design/v3/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

async function revealAll(p) {
  for (let i = 0; i < 20; i++) {
    const ph = p.locator('.sections-placeholder');
    if (!(await ph.count())) break;
    await ph.scrollIntoViewIfNeeded().catch(() => undefined);
    await p.waitForTimeout(120);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(600);
}

for (const theme of ['dark', 'light']) {
  for (const style of ['swing', 'long']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.addInitScript(([t, s]) => { localStorage.setItem('tmf-theme', t); localStorage.setItem('tmf-style', s); }, [theme, style]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}#/stock/2330`);
    await p.locator('.stock-lower').waitFor();
    await p.waitForTimeout(1200);
    await revealAll(p);
    await p.screenshot({ path: `${OUT}stock-${style}-${theme}.png`, fullPage: true });
    if (style === 'swing') {
      // 每日籌碼
      const chip = p.locator('section.chip-daily');
      await chip.scrollIntoViewIfNeeded();
      await p.waitForTimeout(500);
      await chip.screenshot({ path: `${OUT}chips-daily-${theme}.png` });
      // 信用與空方
      const credit = p.locator('#sec-credit');
      await credit.scrollIntoViewIfNeeded();
      await credit.screenshot({ path: `${OUT}credit-${theme}.png` });
      // 籌碼結構＋查看趨勢（底部面板）
      const st = p.locator('#sec-structure');
      await st.scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      await st.screenshot({ path: `${OUT}structure-${theme}.png` });
      await st.getByRole('button', { name: /查看趨勢/ }).click();
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${OUT}structure-trend-sheet-${theme}.png` });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
      // 兩指區間報酬
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(500);
      const bx = await p.locator('.chart-wrap').first().boundingBox();
      const cdp = await ctx.newCDPSession(p);
      const y = bx.y + bx.height / 2;
      const a = { x: bx.x + bx.width * 0.25, y, id: 1 };
      const b = { x: bx.x + bx.width * 0.8, y, id: 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}range-return-${theme}.png` });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('saved to', OUT);
