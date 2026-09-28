// 改版前後對照圖：把 before／after 的同一頁並排成一張（1x、JPEG），放在 docs/design/ux-fixes/compare。
// 用法：node scripts/ux-compare.mjs --dir ../docs/design/ux-fixes
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const dir = args.dir;
const COMBOS = ['browser-dark', 'browser-light', 'standalone-dark', 'standalone-light'];
const PAGES = [['01-tonight', '今晚'], ['02-mine', '我的股票'], ['03-search', '搜尋'], ['04-stock', '個股'], ['05-health', '資料健康'], ['06-tonight-bottom', '捲到底（頁尾與導覽列）']];
const MODE = { browser: 'Safari 瀏覽器模式', standalone: '加入主畫面' };
const SCHEME = { dark: '深色', light: '淺色' };

const b64 = (p) => `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`;
mkdirSync(`${dir}/compare`, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 846, height: 900 }, deviceScaleFactor: 1 });
for (const combo of COMBOS) {
  const [mode, scheme] = combo.split('-');
  for (const [id, label] of PAGES) {
    const before = `${dir}/before/${combo}/${id}.jpg`;
    const after = `${dir}/after/${combo}/${id}.jpg`;
    if (!existsSync(before) || !existsSync(after)) continue;
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#2a2a2e;font:600 15px -apple-system,'PingFang TC','Noto Sans TC',sans-serif;color:#fff">
      <div style="padding:10px 20px 0">${label}・${MODE[mode]}・${SCHEME[scheme]}</div>
      <div style="display:flex;gap:20px;padding:10px 20px 20px">
        <figure style="margin:0"><figcaption style="padding-bottom:6px;color:#bbb">改版前</figcaption><img src="${b64(before)}" width="393" height="852"></figure>
        <figure style="margin:0"><figcaption style="padding-bottom:6px;color:#bbb">改版後</figcaption><img src="${b64(after)}" width="393" height="852"></figure>
      </div></body></html>`);
    await page.screenshot({ path: `${dir}/compare/${combo}-${id}.jpg`, type: 'jpeg', quality: 78, fullPage: true });
    process.stdout.write(`${combo}-${id} `);
  }
}
// 每日籌碼：改版前（橫向捲動表格）對照改版後（法人檢視），375／393 × 深淺色
for (const w of [375, 393]) {
  for (const scheme of ['dark', 'light']) {
    const before = `${dir}/chips/before/${w}-${scheme}-table.jpg`;
    const after = `${dir}/chips/after/${w}-${scheme}-1-insti.jpg`;
    if (!existsSync(before) || !existsSync(after)) continue;
    await page.setViewportSize({ width: 2 * w + 60, height: 900 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#2a2a2e;font:600 15px -apple-system,'PingFang TC','Noto Sans TC',sans-serif;color:#fff">
      <div style="padding:10px 20px 0">每日籌碼・${w}pt・${SCHEME[scheme]}</div>
      <div style="display:flex;gap:20px;padding:10px 20px 20px;align-items:flex-start">
        <figure style="margin:0"><figcaption style="padding-bottom:6px;color:#bbb">改版前（需要左右滑動）</figcaption><img src="${b64(before)}" width="${w}"></figure>
        <figure style="margin:0"><figcaption style="padding-bottom:6px;color:#bbb">改版後</figcaption><img src="${b64(after)}" width="${w}"></figure>
      </div></body></html>`);
    await page.screenshot({ path: `${dir}/compare/chips-${w}-${scheme}.jpg`, type: 'jpeg', quality: 78, fullPage: true });
    process.stdout.write(`chips-${w}-${scheme} `);
  }
}
await browser.close();
process.stdout.write('\ndone\n');
