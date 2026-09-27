// 產生美術方向 mockup 截圖：node docs/design/mockups/render.mjs
// 需要 web/ 已 npm ci（使用其中的 @playwright/test）；Chromium 路徑可用 PW_CHROMIUM_PATH 指定。
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const here = new URL('.', import.meta.url);
const outDir = fileURLToPath(new URL('../art-direction/', here));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shots = [];
for (const dir of ['a', 'b']) {
  for (const [p, theme] of [['tonight', 'dark'], ['mine', 'dark'], ['stock', 'dark'], ['tonight', 'light']]) {
    await page.goto(new URL(`mockup.html?dir=${dir}&page=${p}&theme=${theme}`, here).href);
    await page.waitForSelector('body[data-ready="1"]');
    const name = `${dir.toUpperCase()}-${p}${theme === 'light' ? '-light' : ''}.png`;
    await page.locator('#screen').screenshot({ path: outDir + name });
    shots.push(name);
  }
}
const board = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5 });
const bp = await board.newPage();
for (const dir of ['A', 'B']) {
  await bp.goto(new URL(`board.html?dir=${dir}`, here).href);
  await bp.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await bp.locator('#board').screenshot({ path: `${outDir}board-${dir}.png` });
}
await browser.close();
console.log(shots.join('\n'));
