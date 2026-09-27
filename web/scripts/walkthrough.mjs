// 「每晚 5 分鐘儀式」走查：從打開 App 到完成三環，每一步截圖並計算點擊次數（捲動與打字不算點擊）。
// 用法：node scripts/walkthrough.mjs --base http://localhost:4181/twse-money-flow/ --seed seed.json --out ../docs/design/walkthrough
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const seed = JSON.parse(readFileSync(args.seed, 'utf8'));
mkdirSync(args.out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const steps = [];
let taps = 0;
async function shot(id, text) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${args.out}/${id}.jpg`, type: 'jpeg', quality: 82 });
  steps.push({ id, text, taps });
  process.stdout.write(`${id} (${taps}) `);
}
async function tap(locator) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().tap();
  taps++;
}

// 準備：真實資料＋測試用的持倉紀錄（有一筆平倉尚未檢討）
await page.goto(args.base);
await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => { res(r.result.objectStoreNames.contains('activity')); r.result.close(); }; }));
await page.evaluate(async (seed) => {
  const db = await new Promise((res) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res(r.result); });
  const tx = db.transaction(['watchlist', 'trades', 'settings'], 'readwrite');
  seed.watchlist.forEach((w) => tx.objectStore('watchlist').put(w));
  seed.trades.forEach((t) => tx.objectStore('trades').put(t));
  tx.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
  await new Promise((r) => { tx.oncomplete = r; });
}, seed);
await page.reload();
await page.waitForTimeout(2600);

await shot('01-open', '打開 App：今晚頁最上方一句話結論與資金環境燈號（環境光為琥珀＝資金環境保守）。');
await tap(page.getByRole('button', { name: /資金環境：/ }));
await shot('02-env-sheet', '點燈號：底部面板列出 5 項資金指標，哪一項亮起風險、依據是什麼。');
await tap(page.getByRole('button', { name: '關閉' }));
await page.evaluate(() => document.querySelector('[aria-label="我的持股有沒有出事？"]')?.scrollIntoView({ block: 'start' }));
await shot('03-holdings', '往下捲：持股警示——觸及停損、接近停損、新風險旗標，其餘持股收合。');
await tap(page.locator('a.card').filter({ hasText: /觸及停損/ }));
await page.waitForTimeout(1500);
await shot('04-stock', '點警示卡：個股頁先給主角數字、走勢、一句話健檢與四環分數。');
await tap(page.getByRole('button', { name: '下一檔' }));
await page.waitForTimeout(1500);
await shot('05-next-holding', '下一檔（也可左右滑動）：依序看完需要注意的持股。');
await tap(page.getByRole('link', { name: '今晚' }));
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('[aria-label="自選股出現了什麼新變化？"]')?.scrollIntoView({ block: 'start' }));
await shot('06-watch-changes', '回到今晚、捲到自選股的新變化：只列出自上次查看以來超過門檻的變化。');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('07-rings', '捲到底：第一環「看完今晚簡報」自動完成；還差平倉檢討。');
await tap(page.getByRole('link', { name: /平倉檢討/ }));
await page.waitForTimeout(1200);
await page.keyboard.type('依計畫在停損附近出場；進場時追高，下次等回檔再評估。');
await tap(page.getByRole('button', { name: '追高' }));
await shot('08-review', '點「寫下平倉檢討」：直接開啟檢討面板，打字不算點擊；加上錯誤標籤。');
await tap(page.getByRole('button', { name: '完成檢討' }));
await page.waitForTimeout(800);
await tap(page.getByRole('link', { name: '今晚' }));
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(900);
await shot('09-complete', '回到今晚：三環完成，播放一次低調的完成動畫；連續天數與紀律等級更新。');

const md = [
  '| 步驟 | 截圖 | 說明 | 累計點擊 |',
  '|---|---|---|---|',
  ...steps.map((s, i) => `| ${i + 1} | ![${s.id}](${s.id}.jpg) | ${s.text} | ${s.taps} |`),
  '',
  `**總點擊次數：${taps} 次**（目標 ≤ 15）。捲動與打字不計入。`,
].join('\n');
writeFileSync(`${args.out}/steps.md`, md);
await browser.close();
process.stdout.write(`\ntotal taps ${taps}\n`);
