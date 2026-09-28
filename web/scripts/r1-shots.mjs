// 第 1 輪健檢修正的改版前後截圖（D-01、E-02、M5 兩個問題、U-03）→ docs/design/r1/{before|after}/
// 用法：先 build（示範資料）並 vite preview，再
//   node scripts/r1-shots.mjs --base http://localhost:4173/twse-money-flow/ --variant before|after
// 截圖用中文字型：CJK_FONT_DIR=<@fontsource/noto-sans-tc 目錄>（見 scripts/cjk-font.mjs）
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4173/twse-money-flow/');
const VARIANT = arg('variant', 'after');
const OUT = new URL(`../../docs/design/r1/${VARIANT}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const CHECK = { market: '偏多', trend: '年線上', revenue: '成長', valuation: '合理', reason: '示範' };

async function newPage({ clock, desktop = false } = {}) {
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' }
    : { ...devices['iPhone 13'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await useCjkFont(ctx);
  await ctx.addInitScript(() => localStorage.setItem('tmf-theme', 'dark'));
  const p = await ctx.newPage();
  if (clock) await p.clock.setFixedTime(new Date(clock));
  return p;
}

async function seed(p, stores) {
  await p.goto(`${BASE}#/me/settings`);
  for (let i = 0; i < 50; i++) {
    if (await p.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'twse-money-flow' && (d.version ?? 0) >= 3))) break;
    await p.waitForTimeout(100);
  }
  await p.evaluate((s) => new Promise((resolve, reject) => {
    const req = indexedDB.open('twse-money-flow');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(Object.keys(s), 'readwrite');
      for (const [name, rows] of Object.entries(s)) for (const r of rows) tx.objectStore(name).put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), stores);
}

async function injectSplit(p) {
  await p.route('**/data/stocks/2330.json', async (route) => {
    const res = await route.fetch();
    const h = await res.json();
    const k = h.d.length - 30;
    for (const key of ['o', 'h', 'l', 'c']) h[key] = h[key].map((v, i) => (v !== null && i < k ? v * 4 : v));
    h.af = h.af.map((v, i) => (i < k ? v * 0.25 : v));
    h.adj_events = [[h.d[k], 0.25, 'split']];
    await route.fulfill({ response: res, json: h });
  });
}

const clip = async (p, sel, name, pad = 8) => {
  const b = await p.locator(sel).first().boundingBox();
  await p.screenshot({ path: `${OUT}${name}.png`, clip: { x: 0, y: Math.max(0, b.y - pad), width: p.viewportSize().width, height: b.height + pad * 2 } });
};

// ---------- E-02：9/29 上午（教師節隔天）個股頁的資料狀態
for (const [when, name] of [['2026-09-28T10:00:00+08:00', 'e02-0928'], ['2026-09-29T09:00:00+08:00', 'e02-0929']]) {
  const p = await newPage({ clock: when });
  await p.goto(`${BASE}#/stock/2330`);
  await p.locator('.stock-lower').waitFor();
  await p.waitForTimeout(1300);
  const low = await p.locator('.stock-lower').boundingBox();
  await p.screenshot({ path: `${OUT}${name}.png`, clip: { x: 0, y: 0, width: 393, height: Math.min(852, low.y + 140) } });
  await p.context().close();
}

// ---------- D-01：0050 一拆四之後的日誌
{
  const p = await newPage();
  await p.route('**/data/summary.json', async (route) => {
    const res = await route.fetch();
    const s = await res.json();
    const row = s.rows.find((r) => r[0] === '0050');
    row[s.columns.indexOf('close')] = 50;
    if (s.columns.includes('adj_ev')) row[s.columns.indexOf('adj_ev')] = [['2026-09-01', 0.25, 'split']];
    await route.fulfill({ response: res, json: s });
  });
  await p.route('**/data/stocks/0050.json', async (route) => {
    const res = await route.fetch();
    const h = await res.json();
    h.adj_events = [['2026-09-01', 0.25, 'split']];
    await route.fulfill({ response: res, json: h });
  });
  await seed(p, { trades: [{ id: 'etf', code: '0050', name: '元大台灣50', status: 'open', openedAt: '2026-08-03', entry: 190, shares: 1000, stop: 180, target: 220, reasonType: '趨勢', checklist: CHECK }] });
  await p.goto(`${BASE}#/discipline/journal`);
  await p.locator('.card', { hasText: '元大台灣50' }).waitFor();
  await p.waitForTimeout(600);
  await clip(p, '.card:has-text("元大台灣50")', 'd01-journal', 16);
  await p.goto(`${BASE}#/mine?seg=hold`);
  await p.locator('.srow').first().waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}d01-mine-hold.png`, clip: { x: 0, y: 0, width: 393, height: 700 } });
  await p.context().close();
}

// ---------- M5-1：切換到原始價（2330 前段模擬一拆四）
{
  const p = await newPage();
  await injectSplit(p);
  await p.goto(`${BASE}#/stock/2330`);
  await p.locator('.hero').first().waitFor();
  await p.waitForTimeout(1300);
  await clip(p, '.hero-block', 'm5-adj', 8);
  const raw = p.getByRole('button', { name: '原始價' }).first();
  await raw.scrollIntoViewIfNeeded();
  await raw.click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(900);
  await clip(p, '.hero-block', 'm5-raw', 8);
  await p.context().close();
}

// ---------- M5-2：手機單指在走勢圖上左右拖曳（改版前會換到下一檔；改版後是查價，不換股）
{
  const p = await newPage();
  await p.goto(`${BASE}#/mine`);
  await p.evaluate(() => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: ['2330', '2317', '2454'] })));
  await p.goto(`${BASE}#/stock/2317`);
  await p.locator('.hero').first().waitFor();
  await p.waitForTimeout(1300);
  const chart = await p.locator('.pager-pane:not([inert]) .chart-wrap').first().boundingBox();
  const y = chart.y + chart.height / 2;
  const cdp = await p.context().newCDPSession(p);
  const from = { x: chart.x + chart.width * 0.85, y }, to = { x: chart.x + chart.width * 0.2, y };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y }] });
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}m5-drag-during.png`, clip: { x: 0, y: 0, width: 393, height: Math.min(852, chart.y + chart.height + 40) } });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}m5-drag-after.png`, clip: { x: 0, y: 0, width: 393, height: Math.min(852, chart.y + chart.height + 40) } });
  await p.context().close();
}

// ---------- U-03：點擊區域（虛線＝實際可點範圍，含 ::before 擴大的部分；數字＝高度 pt）
{
  const p = await newPage();
  await p.goto(`${BASE}#/stock/2330`);
  await p.locator('.stock-lower').waitFor();
  for (let i = 0; i < 20; i++) {
    const ph = p.locator('.sections-placeholder');
    if (!(await ph.count())) break;
    await ph.scrollIntoViewIfNeeded().catch(() => undefined);
    await p.waitForTimeout(120);
  }
  const outline = async () => p.evaluate(() => {
    document.querySelectorAll('.tap-overlay').forEach((e) => e.remove());
    const sel = '.segmented button, .chip, .btn.small, .sort-select, .range-seg button, .text-btn, .icon-btn, .periods button';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const before = getComputedStyle(el, '::before');
      let top = r.top, bottom = r.bottom;
      if (before.content && before.content !== 'none' && before.position === 'absolute') {
        const t = parseFloat(before.top), b = parseFloat(before.bottom);
        if (!Number.isNaN(t)) top = Math.min(top, r.top + t);
        if (!Number.isNaN(b)) bottom = Math.max(bottom, r.bottom - b);
      }
      const h = Math.round(bottom - top);
      const box = document.createElement('div');
      box.className = 'tap-overlay';
      Object.assign(box.style, { position: 'absolute', left: `${r.left + scrollX}px`, top: `${top + scrollY}px`, width: `${r.width}px`, height: `${bottom - top}px`,
        outline: `1.5px dashed ${h >= 44 ? '#3ddc84' : '#ff5c4d'}`, pointerEvents: 'none', zIndex: 9999 });
      const tag = document.createElement('span');
      tag.textContent = String(h);
      Object.assign(tag.style, { position: 'absolute', right: '1px', top: '-1px', font: '600 9px/1 system-ui', color: h >= 44 ? '#3ddc84' : '#ff5c4d', background: '#000a', padding: '1px 2px' });
      box.appendChild(tag);
      document.body.appendChild(box);
    }
  });
  const shoot = async (sel, name) => {
    const el = p.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await outline();
    await el.screenshot({ path: `${OUT}${name}.png` });
  };
  await shoot('.hero-block', 'u03-hero');
  await shoot('#sec-institutional', 'u03-institutional');
  await p.context().close();
}

await browser.close();
console.warn(`已輸出到 ${OUT}`);
