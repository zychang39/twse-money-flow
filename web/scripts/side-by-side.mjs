// 新舊並排：把兩張截圖（改版前基準、改版後）並排成一張 JPEG（1x），標上標題。
// 用法：node scripts/side-by-side.mjs --out a.jpg --left before.jpg --right after.jpg --title "簡報"
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const b64 = (p) => `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`;
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 860, height: 960 }, deviceScaleFactor: 1 });
await useCjkFont(ctx);
const page = await ctx.newPage();
await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:16px sans-serif">
<div style="display:flex;gap:16px;padding:16px">
<figure style="margin:0;width:402px"><figcaption style="padding-bottom:8px">改版前（基準）・${arg('title', '')}</figcaption><img src="${b64(arg('left'))}" style="width:402px"></figure>
<figure style="margin:0;width:402px"><figcaption style="padding-bottom:8px">改版後・${arg('title', '')}</figcaption><img src="${b64(arg('right'))}" style="width:402px"></figure>
</div></body>`);
await page.waitForTimeout(300);
await page.screenshot({ path: arg('out'), type: 'jpeg', quality: 80, fullPage: true });
await browser.close();
