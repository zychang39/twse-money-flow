// 第三輪修正的驗收截圖（docs/design/round3/）：iPhone 393／375 寬 × 深色／淺色。
// 法人買賣超報表、八大行庫、大戶與散戶持股、多空對照、個股頁的新區塊、新版本提示。
// 用法：CJK_FONT_DIR=… node scripts/round3-shots.mjs --base http://127.0.0.1:4306/twse-money-flow/ --out ../docs/design/round3 [--code 2330]
import { chromium } from '@playwright/test';
import { useCjkFont } from './cjk-font.mjs';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const code = args.code ?? '2330';
mkdirSync(args.out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
// 元素截圖時隱藏固定在底部的導覽列（否則會蓋在元素中間）
const HIDE_DOCK = '.dock{display:none!important}';

async function ctxFor(width, scheme) {
  const ctx = await browser.newContext({ viewport: { width, height: 852 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  await useCjkFont(ctx);
  return ctx;
}

for (const width of [393, 375]) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await ctxFor(width, scheme);
    const page = await ctx.newPage();
    const tag = `${width}-${scheme}`;
    const view = async (name) => { await page.mouse.move(1, 1); await page.screenshot({ path: `${args.out}/${tag}-${name}.jpg`, type: 'jpeg', quality: 78 }); process.stdout.write(`${tag}-${name} `); };
    const el = async (sel, name) => {
      const style = await page.addStyleTag({ content: HIDE_DOCK });
      await page.locator(sel).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.locator(sel).first().screenshot({ path: `${args.out}/${tag}-${name}.jpg`, type: 'jpeg', quality: 78 });
      await style.evaluate((n) => n.remove());
      process.stdout.write(`${tag}-${name} `);
    };

    // 法人買賣超報表
    await page.goto(`${args.base}#/stock/${code}/institutional`);
    await page.waitForTimeout(2500);
    await view('01-institutional-top');
    await el('.stacked', '02-institutional-chart');
    await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '1 個月' }).click();
    await el('.ir-wrap', '03-institutional-table');
    if (width === 393) {
      // 十字線與提示框（鍵盤逐日移動）
      await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '3 個月' }).click();
      const chart = page.locator('.stacked-plot').first();
      await chart.focus();
      for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
      await el('.stacked', '02b-institutional-crosshair');
      await page.keyboard.press('Escape');
      await page.locator('.ir-table tbody tr.day').first().getByRole('button').click();
      await page.waitForTimeout(800);
      await view('03b-institutional-day-sheet');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await page.getByRole('group', { name: '法人' }).getByRole('button', { name: '八大行庫' }).click();
    await page.waitForTimeout(300);
    await view('04-banks');

    // 大戶與散戶持股
    await page.goto(`${args.base}#/stock/${code}/holders`);
    await page.waitForTimeout(2500);
    await view('05-holders-top');
    await el('.stacked', '06-holders-chart');
    await el('.hd-table', '07-holders-distribution');

    // 多空對照
    await page.goto(`${args.base}#/stock/${code}/bullbear`);
    await page.waitForTimeout(2500);
    await view('08-bullbear-top');
    await el('.bb-card', '09-bullbear-fundamental');

    // 個股頁的新區塊
    await page.goto(`${args.base}#/stock/${code}`);
    await page.waitForTimeout(3000);
    await el('section[aria-label="多空"]', '10-stock-bullbear-block');
    await el('section[aria-label="研究參考"]', '11-stock-research');
    if (width === 393) {
      await page.evaluate(() => window.dispatchEvent(new Event('app-updated')));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await view('12-update-toast');
    }
    await ctx.close();
  }
}
await browser.close();
process.stdout.write('\ndone\n');
