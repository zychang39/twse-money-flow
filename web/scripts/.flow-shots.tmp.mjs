import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { useCjkFont } from './cjk-font.mjs';
const BASE = 'http://localhost:4305/twse-money-flow/';
const src = readFileSync(new URL('./align-audit.mjs', import.meta.url), 'utf8');
const measureSrc = src.slice(src.indexOf('function measure() {'), src.indexOf('/** 捲到底'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
await useCjkFont(ctx);
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForTimeout(3000);
const empty = process.argv[2] === 'empty';
await page.evaluate(async (empty) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const tx = db.transaction(['activity', 'trades', 'settings'], 'readwrite');
  if (!empty) {
    const days = ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14','2026-09-15','2026-09-16','2026-09-18','2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-29','2026-09-30','2026-10-01','2026-10-02'];
    days.forEach((d, i) => tx.objectStore('activity').put({ id: `b${i}`, type: 'brief_read', day: d, at: `${d}T12:00:00.000Z` }));
    tx.objectStore('activity').put({ id: 'legacy-xp', type: 'legacy_xp', day: '2026-09-01', at: '2026-09-01T00:00:00.000Z', meta: { xp: 60, level: 1 } });
    const CK = { market: '中性', trend: '多頭（年線、季線之上）', revenue: '成長', valuation: '合理', reason: '投信連買' };
    tx.objectStore('trades').put({ id: 't1', code: '2330', name: '台積電', status: 'open', openedAt: '2026-10-02', entry: 1000, shares: 10, stop: 950, target: 1200, reasonType: '籌碼', checklist: CK, createdAt: '2026-10-02T05:00:00.000Z', checklistDone: true, plannedRisk: 500, riskLimit: 10000 });
    tx.objectStore('trades').put({ id: 't2', code: '2317', name: '鴻海', status: 'closed', openedAt: '2026-09-15', closedAt: '2026-09-30', exit: 190, exitReason: 'stop', entry: 200, shares: 500, stop: 190, target: 230, reasonType: '籌碼', checklist: CK, createdAt: '2026-09-15T05:00:00.000Z', checklistDone: true, plannedRisk: 5000, riskLimit: 10000, closedRecordedAt: '2026-09-30T06:00:00.000Z' });
  }
  await new Promise((res) => { tx.oncomplete = res; });
  db.close();
}, empty);
const out = [];
for (const [id, hash] of [['flow', '#/discipline'], ['badges', '#/discipline/badges'], ['stats', '#/discipline/stats'], ['weekly', '#/discipline/weekly'], ['brief', '#/']]) {
  await page.goto(`${BASE}${hash}`); await page.reload(); await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/claude-0/sp/shots-flow/${id}${empty ? '-empty' : ''}.png`, fullPage: true });
  const v = await page.evaluate(`(${measureSrc})()`);
  out.push(`${id}: ${v.length}`);
  for (const x of v.slice(0, 15)) out.push(`  [${x.rule}] ${x.msg} ${x.at ?? ''}`);
}
console.log(out.join('\n'));
await browser.close();
