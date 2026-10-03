// 對齊稽核（2026-10 改版 §9.2）：無頭瀏覽器在 402×874 逐頁量測 getBoundingClientRect，違反項目寫成 JSON＋Markdown。
// 用法：npm run build && (npx vite preview --port 4173 &) && node scripts/align-audit.mjs [--base URL] [--out 目錄] [--seed seed.json]
// 有任何違反時以非 0 結束。規則：
//   1. 內容左緣只允許 x=16（卡片外）與 x=32（卡片內）；圖表內部、置中元素、右對齊的數值與標籤除外。
//   2. 同一卡片內所有列的數值（data-a="v"）右緣差異 ≤ 0.5px。
//   3. 同一列內 data-a="bl" 的元素基線差異 ≤ 0.5px；摘要格（.ui-stats）同一列各格的標籤頂緣、數值基線一致。
//   4. 無水平溢出；捲到底時內容不被分頁列遮住；標籤與分段控制皆單行、表頭不截斷。
//   5. 無任何一行以標點開頭（，。、；：）・）或以「（」結尾；數字與單位未被拆行。
//   6. 所有 margin／padding／gap 為 4 的倍數（0.5px 分隔線不算間距）。
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4173/twse-money-flow/');
const OUT = arg('out', '../docs/screens/redesign-2026-10/audit');
const SEED = arg('seed', '../docs/design/screens/seed.json');
const STRATEGY = arg('strategy', 'revenue_year_high');
const ONLY = arg('only', '');
const seed = JSON.parse(readFileSync(SEED, 'utf8'));

export const PAGES = [
  { id: 'gallery', hash: '#/dev' },
  { id: 'brief', hash: '#/' },
  { id: 'brief-market', hash: '#/?seg=market' },
  { id: 'brief-money', hash: '#/?seg=money' },
  { id: 'brief-mine', hash: '#/?seg=mine' },
  { id: 'mine', hash: '#/mine' },
  { id: 'mine-hold', hash: '#/mine?seg=hold' },
  { id: 'stock-overview', hash: '#/stock/2330', seg: '總覽' },
  { id: 'stock-momentum', hash: '#/stock/2330', seg: '動能' },
  { id: 'stock-m-returns', hash: '#/stock/2330/m/returns' },
  { id: 'stock-m-sector', hash: '#/stock/2330/m/sector' },
  { id: 'stock-m-trend', hash: '#/stock/2330/m/trend' },
  { id: 'stock-m-position', hash: '#/stock/2330/m/position' },
  { id: 'stock-m-risk', hash: '#/stock/2330/m/risk' },
  { id: 'stock-chips', hash: '#/stock/2330', seg: '籌碼' },
  { id: 'stock-fundamental', hash: '#/stock/2330', seg: '基本面' },
  { id: 'stock-events', hash: '#/stock/2330', seg: '事件' },
  { id: 'stock-tpex', hash: '#/stock/6488', seg: '動能' },
  { id: 'strategies', hash: '#/explore/strategies' },
  { id: 'strategy-detail', hash: `#/explore/strategies/${STRATEGY}` },
  { id: 'etf', hash: '#/explore/etf' },
  { id: 'flow', hash: '#/discipline' },
].filter((p) => !ONLY || ONLY.split(',').includes(p.id));

/** 在頁面內執行的量測（不能引用外部變數）。 */
function measure() {
  const V = [];
  const vw = window.innerWidth;
  const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
  const skipSel = 'svg, canvas, .laxis, .rings, .sc2, .pbar, .rbar, .dbar, .mini, .skel, .ambient, .chart-wrap, .chart-box, .lw-chart, .netbars, [data-audit-skip], .sheet, .sheet-backdrop, .dock, .topbar, .sr-only, .footer, .update-toast, .status-scrim';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${t}」`;
  };
  const scrollY = window.scrollY;
  const page = document.querySelector('.page');
  if (!page) return [{ rule: 'page', msg: '找不到 .page' }];
  const cardOf = (el) => el.closest('.ui-card, .ui-list, .card, .list, .ui-table, .sheet-body, .sum-card, .stale-note');

  // ---------- 1. 左緣 ----------
  // 以「行內片段」為單位：每個文字節點的每一行（Range.getClientRects）與圖示（svg）、輸入框。
  // 同一張卡片內、同一視覺列左邊沒有其他片段的，才是行首；行首的左緣必須是 32（卡片內）或 16（卡片外）。
  const rightish = (el) => {
    if (el.closest('[data-a="v"], .chev, .stale-note > svg, td.r, th.r, .ui-row-tag, .ui-row-chev, .ui-sec-aside, .ui-head-aside, .ui-tag, .tag, .ui-seg, .segmented, .periods, .ui-info, .ui-btn, .btn')) return true;
    for (let p = el; p && p !== page; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.textAlign === 'center' || cs.textAlign === 'right' || cs.textAlign === 'end') return true;
      if (p !== el && cs.display.includes('flex') && (cs.justifyContent === 'center' || cs.justifyContent === 'flex-end' || cs.justifyContent === 'end')) return true;
    }
    return false;
  };
  const boxes = [];
  const tw0 = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  for (let n = tw0.nextNode(); n; n = tw0.nextNode()) {
    const p = n.parentElement;
    if (!p || !n.textContent.trim() || p.closest(skipSel) || !visible(p)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 0.5) boxes.push({ el: p, r, card: cardOf(p) });
  }
  for (const el of page.querySelectorAll('svg, input, select, textarea, img')) {
    if ((el.parentElement && el.parentElement.closest(skipSel) && !el.matches('svg')) || !visible(el)) continue;
    if (el.matches('svg') && el.parentElement?.closest('svg')) continue;
    if (el.matches('svg') && el.closest('.rings, .sc2, .mini, .metric-g, .sum-graphic, .chart-wrap, .chart-box, .lw-chart, .netbars, [data-audit-skip], .sheet, .dock, .topbar')) continue;
    boxes.push({ el, r: el.getBoundingClientRect(), card: cardOf(el), icon: true });
  }
  for (const a of boxes) {
    if (rightish(a.el)) continue;
    const cy = (a.r.top + a.r.bottom) / 2;
    const leftOf = boxes.some((b) => b !== a && b.card === a.card && b.r.right <= a.r.left + 1 && cy > b.r.top && cy < b.r.bottom);
    if (leftOf) continue;
    // 卡片內＝最外層卡片左緣＋16（兩欄摘要卡的右欄從自己的卡片左緣算；卡片裡的表格不另外內縮）
    let outer = a.card;
    for (let c = a.card?.parentElement ? cardOf(a.card.parentElement) : null; c; c = c.parentElement ? cardOf(c.parentElement) : null) outer = c;
    const want = outer ? Math.round(outer.getBoundingClientRect().left) + 16 : 16;
    if (!near(a.r.left, want)) V.push({ rule: 'left-edge', msg: `左緣 x=${a.r.left.toFixed(1)}（應為 ${want}）`, at: label(a.el), y: Math.round(a.r.top + scrollY) });
  }

  // ---------- 2. 同卡片數值右緣 ----------
  for (const card of page.querySelectorAll('.ui-list, .ui-card')) {
    if (card.closest(skipSel)) continue;
    const vals = [...card.querySelectorAll(':scope > .ui-row [data-a="v"], :scope > .ui-list > .ui-row [data-a="v"]')].filter((v) => visible(v) && v.textContent.trim());
    if (vals.length < 2) continue;
    const rs = vals.map((v) => v.getBoundingClientRect().right);
    const span = Math.max(...rs) - Math.min(...rs);
    if (span > 0.5) V.push({ rule: 'value-right', msg: `數值右緣差 ${span.toFixed(1)}px`, at: label(card), y: Math.round(card.getBoundingClientRect().top + scrollY) });
  }

  // ---------- 3. 基線 ----------
  const baseline = (el) => {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden';
    const host = el.querySelector('[data-a="bl"]') && el.matches('[data-a="v"]') ? el.querySelector('[data-a="bl"]') : el;
    // 放在第一行文字的開頭（第一個文字節點之前）
    const walker2 = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const first = walker2.nextNode();
    if (first && first.parentNode) first.parentNode.insertBefore(probe, first); else host.prepend(probe);
    const y = probe.getBoundingClientRect().top;
    probe.remove();
    return y;
  };
  for (const row of page.querySelectorAll('.ui-row')) {
    if (row.closest(skipSel) || !visible(row)) continue;
    const els = [...row.querySelectorAll('[data-a="bl"]')].filter((e) => visible(e) && e.textContent.trim());
    if (els.length < 2) continue;
    const ys = els.map(baseline);
    const span = Math.max(...ys) - Math.min(...ys);
    if (span > 0.5) V.push({ rule: 'baseline', msg: `同列基線差 ${span.toFixed(1)}px`, at: label(row), y: Math.round(row.getBoundingClientRect().top + scrollY) });
  }
  for (const grid of page.querySelectorAll('.ui-stats')) {
    if (grid.closest(skipSel)) continue;
    const cells = [...grid.querySelectorAll(':scope > .ui-stat')].filter(visible);
    const rowsMap = new Map();
    for (const c of cells) { const k = Math.round(c.getBoundingClientRect().top); rowsMap.set(k, [...(rowsMap.get(k) || []), c]); }
    for (const [, cs] of rowsMap) {
      if (cs.length < 2) continue;
      const lt = cs.map((c) => c.querySelector('.ui-stat-l')?.getBoundingClientRect().top ?? 0);
      const vb = cs.map((c) => baseline(c.querySelector('.ui-stat-v') ?? c));
      if (Math.max(...lt) - Math.min(...lt) > 0.5) V.push({ rule: 'grid-label-top', msg: '摘要格同列標籤頂緣不一致', at: label(cs[0]) });
      if (Math.max(...vb) - Math.min(...vb) > 0.5) V.push({ rule: 'grid-value-baseline', msg: '摘要格同列數值基線不一致', at: label(cs[0]) });
    }
  }

  // ---------- 4. 溢出、單行 ----------
  if (document.documentElement.scrollWidth > vw + 0.5) V.push({ rule: 'h-overflow', msg: `頁面水平溢出 ${document.documentElement.scrollWidth - vw}px` });
  for (const el of page.querySelectorAll('*')) {
    if (el.closest('svg, .chart-wrap, .chart-box, .lw-chart, [data-audit-skip], .sheet')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 0.5 && visible(el)) { V.push({ rule: 'h-overflow', msg: `元素超出畫面右緣 ${(r.right - vw).toFixed(1)}px`, at: label(el), y: Math.round(r.top + scrollY) }); break; }
  }
  const lines = (el) => {
    const tops = new Set();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim() || n.parentElement?.closest('.sr-only')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const x of rg.getClientRects()) if (x.width > 0) tops.add(Math.round(x.top));
    }
    return tops.size;
  };
  for (const el of page.querySelectorAll('.ui-tag, .tag, .ui-seg button, .segmented button, .periods button, .ui-table th, th')) {
    if (el.closest('.sheet') || !visible(el)) continue;
    if (lines(el) > 1) V.push({ rule: 'single-line', msg: '標籤／分段控制／表頭不是單行', at: label(el), y: Math.round(el.getBoundingClientRect().top + scrollY) });
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') V.push({ rule: 'truncated', msg: '文字被截斷', at: label(el) });
  }

  // ---------- 5. 行首標點、數字與單位拆行 ----------
  const HEAD = '，。、；：）・,.;:)%';
  const UNIT = /[0-9%張億元萬日週月年倍檔筆次點]/;
  const tw = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  let prevTop = null; let prevBottom = null; let prevChar = ''; let prevBlock = null;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest('svg, .laxis, .sr-only, [data-audit-skip], .sheet, .dock, .chart-wrap') || !visible(p)) continue;
    const block = p.closest('p, li, td, th, h1, h2, h3, .ui-row-label, .ui-row-sub, .ui-v, .ui-stat-v, .ui-stat-l, div, span');
    const blockRoot = p.closest('button, .ui-sec-head, .nb-dates span, p, li, td, th, h1, h2, h3, .ui-row-label, .ui-row-sub, .ui-row-main, .ui-row-value, .ui-row-subwide, .ui-row-tag, .ui-row-extra, .ui-stat, .ui-head, .ui-empty, .ui-warn');
    if (blockRoot !== prevBlock) { prevTop = null; prevBottom = null; prevChar = ''; prevBlock = blockRoot; }
    const text = n.textContent;
    const rg = document.createRange();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ' || ch === '\n' || ch === ' ') { if (ch !== '\n') prevChar = ch; continue; }
      rg.setStart(n, i); rg.setEnd(n, i + 1);
      const rr = rg.getClientRects()[0];
      if (!rr) continue;
      const top = Math.round(rr.top);
      // 換行＝這個字的上緣在前一個字的下緣之下（字級不同的單位字不算換行）
      if (prevTop !== null && rr.top >= prevBottom - 1) {
        if (HEAD.includes(ch)) V.push({ rule: 'line-head-punct', msg: `行首標點「${ch}」`, at: label(block || p), y: Math.round(rr.top + scrollY) });
        if (prevChar === '（' || prevChar === '(') V.push({ rule: 'line-tail-punct', msg: '行尾「（」', at: label(block || p) });
        if (/[0-9.,+−-]/.test(prevChar) && UNIT.test(ch)) V.push({ rule: 'num-unit-split', msg: `數字與單位拆行「${prevChar}｜${ch}」`, at: label(block || p), y: Math.round(rr.top + scrollY) });
      }
      prevTop = top; prevBottom = rr.bottom; prevChar = ch;
    }
  }

  // ---------- 6. 間距為 4 的倍數 ----------
  const props = ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap'];
  const seen = new Set();
  for (const el of page.querySelectorAll('*')) {
    if (el.matches('.term') || el.closest('svg, .laxis, .chart-wrap, .chart-box, .lw-chart, [data-audit-skip], .sheet, .sr-only') || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' && !el.matches('a, button')) continue;
    for (const k of props) {
      const raw = cs[k];
      if (!raw || raw === 'normal' || raw === 'auto') continue;
      const v = parseFloat(raw);
      if (!Number.isFinite(v) || v === 0) continue;
      if ((k === 'marginLeft' || k === 'marginRight') && near(parseFloat(cs.marginLeft), parseFloat(cs.marginRight)) && v > 40) continue; // 置中（margin: auto）
      // 擴大點擊區（padding 與等量的負 margin 互相抵銷，視覺間距不變）
      const pair = k.startsWith('padding') ? 'margin' + k.slice(7) : k.startsWith('margin') ? 'padding' + k.slice(6) : null;
      if (pair && near(parseFloat(cs[pair]), -v)) continue;
      if (Math.abs(Math.abs(v) / 4 - Math.round(Math.abs(v) / 4)) > 0.01) {
        const key = `${label(el).split('「')[0]}:${k}:${raw}`;
        if (seen.has(key)) continue;
        seen.add(key);
        V.push({ rule: 'spacing-4', msg: `${k} ${raw} 不是 4 的倍數`, at: label(el), y: Math.round(el.getBoundingClientRect().top + scrollY) });
      }
    }
  }
  return V;
}

/** 捲到底：最後一段內容不被分頁列遮住（內容底緣 ≤ 分頁列頂緣）。 */
function bottomClear() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  const dock = document.querySelector('.tabbar');
  const page = document.querySelector('.page');
  if (!dock || !page) return [];
  const top = dock.getBoundingClientRect().top;
  const els = [...page.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0 && e.textContent.trim());
  const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
  return bottom > top + 0.5 ? [{ rule: 'covered-by-tabbar', msg: `捲到底時內容底緣 ${bottom.toFixed(0)} 超過分頁列頂緣 ${top.toFixed(0)}` }] : [];
}

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
await useCjkFont(ctx);
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForFunction(() => new Promise((res) => {
  const r = indexedDB.open('twse-money-flow');
  r.onsuccess = () => { const ok = r.result.objectStoreNames.contains('watchlist'); r.result.close(); res(ok); };
  r.onerror = () => res(false);
}), null, { timeout: 20000 });
await page.evaluate(async (s) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const tx = db.transaction(['watchlist', 'settings'], 'readwrite');
  for (const w of s.watchlist) tx.objectStore('watchlist').put({ origin: 'user', ...w });
  tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
}, seed);

const report = [];
for (const p of PAGES) {
  await page.goto(`${BASE}${p.hash}`);
  await page.reload();
  await page.waitForTimeout(3000);
  if (p.seg) {
    const b = page.getByRole('button', { name: p.seg, exact: true }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(1000); }
  }
  // 延後載入的區塊：逐段捲動後回頂端
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  const v = [...await page.evaluate(measure), ...await page.evaluate(bottomClear)];
  report.push({ page: p.id, hash: p.hash, seg: p.seg ?? null, violations: v });
  process.stdout.write(`${p.id}: ${v.length}\n`);
}
await browser.close();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/align-audit.json`, JSON.stringify(report, null, 1));
const total = report.reduce((n, r) => n + r.violations.length, 0);
const md = [
  `# 對齊稽核（402×874）`,
  '',
  `違反總數：**${total}**`,
  '',
  '| 頁面 | 違反數 |', '|---|---:|',
  ...report.map((r) => `| ${r.page} | ${r.violations.length} |`),
  '',
  ...report.filter((r) => r.violations.length).flatMap((r) => [`## ${r.page}`, '', ...r.violations.slice(0, 60).map((x) => `- [${x.rule}] ${x.msg}${x.at ? ` — ${x.at}` : ''}${x.y !== undefined ? `（y=${x.y}）` : ''}`), '']),
].join('\n');
writeFileSync(`${OUT}/align-audit.md`, md);
process.stdout.write(`total ${total}\n`);
process.exit(total ? 1 : 0);
