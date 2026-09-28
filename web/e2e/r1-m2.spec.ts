import { expect, test, type Page } from '@playwright/test';

// 第 1 輪健檢修正 M2：損益、日誌與備份（docs/BACKLOG.md D-01、E-04）。
// 攔截 summary.json：service worker 接手後的請求不經過 page.route，所以停用
test.use({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });

async function seed(page: Page, stores: Record<string, unknown[]>) {
  await page.goto('#/me/settings');
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'twse-money-flow' && (d.version ?? 0) >= 3))).toBe(true);
  await page.evaluate((s) => new Promise<void>((resolve, reject) => {
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

const CHECK = { market: '偏多', trend: '年線上', revenue: '成長', valuation: '合理', reason: '示範' };

test('D-01：0050 分割 1 拆 4 後，日誌以換算後的價格比較，不會假觸及停損，並標示「已依某日分割調整」', async ({ page }) => {
  // 示範資料的 0050 約 180 元；模擬 9/1 分割（因子 0.25）後收盤 50 元
  await page.route('**/data/summary.json', async (route) => {
    const res = await route.fetch();
    const s = await res.json();
    const col = (n: string) => s.columns.indexOf(n);
    const row = s.rows.find((r: unknown[]) => r[0] === '0050');
    row[col('close')] = 50;
    row[col('adj_ev')] = [['2026-09-01', 0.25, 'split']];
    await route.fulfill({ response: res, json: s });
  });
  await page.route('**/data/stocks/0050.json', async (route) => {
    const res = await route.fetch();
    const h = await res.json();
    h.adj_events = [['2026-09-01', 0.25, 'split']];
    await route.fulfill({ response: res, json: h });
  });
  await seed(page, { trades: [{ id: 'etf', code: '0050', name: '元大台灣50', status: 'open', openedAt: '2026-08-03', entry: 190, shares: 1000, stop: 180, target: 220, reasonType: '趨勢', checklist: CHECK }] });
  await page.goto('#/discipline/journal');
  const card = page.locator('.card', { hasText: '元大台灣50' });
  await expect(card.getByTestId('adjusted-note')).toHaveText('已依 2026/9/1 分割調整：換算為 4,000 股 @ 47.50・停損 45.00・目標 55.00');
  await expect(card.getByText('已觸及停損')).toHaveCount(0);
  await expect(card.getByText('190.0', { exact: false }).first()).toBeVisible(); // 使用者原始輸入保留
  await expect(card.locator('.num').first()).toContainText('未實現損益增加 1.0 萬'); // (50 − 47.5) × 4,000；原始價比較會是 −14 萬
});

test('E-04：壞檔不會清空資料；取代全部前要確認，取消就不變更', async ({ page }) => {
  await seed(page, { watchlist: [{ code: '2330', group: '預設', addedAt: '2026-09-01', order: 0, origin: 'user' }] });
  await page.goto('#/me/backup');
  const input = page.locator('input[type=file]');
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'twse-money-flow', schemaVersion: 3 })) });
  await expect(page.getByText(/匯入失敗：備份檔缺少資料內容/)).toBeVisible();
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"app": "twse-money-flow",') });
  await expect(page.getByText('匯入失敗：檔案不是有效的 JSON')).toBeVisible();
  const good = { app: 'twse-money-flow', schemaVersion: 3, exportedAt: '', stores: { watchlist: [{ code: '2317', group: '預設', addedAt: '', order: 0, origin: 'user' }], settings: [], screens: [], trades: [], activity: [] } };
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); void d.dismiss(); });
  await input.setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await expect(page.getByText('已取消匯入，現有資料沒有變更。')).toBeVisible();
  expect(asked).toContain('自選 1 檔');
  await page.goto('#/mine');
  await expect(page.locator('.srow', { hasText: '台積電' })).toBeVisible();
});
