import { expect, test, type Page } from '@playwright/test';

// 第 1 輪健檢修正 M1：使用者看得到的錯誤（docs/BACKLOG.md E-02、U-01、U-02、E-08）。示範資料的市場日是 2026-09-24。

// 攔截 summary.json／inactive.json：service worker 接手後的請求不經過 page.route，所以停用
test.use({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });

/** 在 App 建立的資料庫裡直接寫入資料（不經過 UI），再重新載入。 */
async function seed(page: Page, stores: Record<string, unknown[]>) {
  await page.goto('#/me/settings');
  await expect(page.locator('.page')).toBeVisible();
  // App 第一次讀寫時才建立資料庫：等到 object store 都在，避免搶先建立空的資料庫
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
    req.onerror = () => reject(req.error);
  }), stores);
}

const CHECK = { market: '', trend: '', revenue: '', valuation: '', reason: '' };

test.describe('E-02 休市狀態依交易日曆', () => {
  test('9/28 教師節：顯示「今天休市」，沒有「尚未更新」或琥珀色過期警示', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-28T10:00:00+08:00'));
    await page.goto('#/stock/2330');
    // 2026-10 改版：個股頁不重複狀態列；資料時間一行在圖表下方，休市不是風險（不出現橘色警示）
    await expect(page.getByTestId('data-time')).toContainText('資料至 9/24');
    await expect(page.getByTestId('stock-stale')).toHaveCount(0);
    await expect(page.getByText('今天的資料尚未更新')).toHaveCount(0);
    await expect(page.getByText('資料可能過期')).toHaveCount(0);
  });

  test('9/29 上午：只顯示「今天的資料尚未更新」，不是落後 3 個工作日', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-29T09:00:00+08:00'));
    await page.goto('#/');
    await expect(page.locator('.meta-line').first()).toContainText('今天的資料尚未更新');
    await expect(page.getByText('資料可能過期')).toHaveCount(0);
  });

  test('真的落後超過 2 個交易日才出現「資料可能過期」', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-01T09:00:00+08:00'));
    await page.goto('#/');
    await expect(page.getByText('資料可能過期')).toBeVisible();
    await expect(page.getByText(/落後 3 個交易日/)).toBeVisible();
  });
});

test.describe('U-02 無成交／停牌不是「今日」漲跌', () => {
  test('清單與個股頁顯示「今日無成交」與最後成交日，不顯示舊的漲跌', async ({ page }) => {
    // 2026-10-02：固定時間在示範資料日（9/24）當晚，否則真實日期與示範資料差超過 2 個交易日時會正確出現「資料可能過期」
    await page.clock.setFixedTime(new Date('2026-09-24T18:00:00+08:00'));
    await page.route('**/data/summary.json', async (route) => {
      const res = await route.fetch();
      const s = await res.json();
      const col = (n: string) => s.columns.indexOf(n);
      const row = s.rows.find((r: unknown[]) => r[0] === '2317');
      row[col('trade_status')] = 'no_trade';
      row[col('last_trade_date')] = '2026-09-23';
      row[col('change')] = null;
      row[col('change_pct')] = null;
      await route.fulfill({ response: res, json: s });
    });
    await seed(page, { watchlist: [{ code: '2317', group: '預設', addedAt: '2026-09-01', order: 0, origin: 'user' }] });
    await page.goto('#/mine');
    const row = page.locator('.srow', { hasText: '鴻海' });
    await expect(row.locator('.pill')).toHaveText('今日無成交');
    await row.click();
    await expect(page.locator('.ui-head-sub')).toContainText('今日無成交・最後成交 9/23');
    await expect(page.getByText('資料可能過期')).toHaveCount(0);
  });
});

test.describe('U-01 下市或停牌的持股不消失；404 用友善文字', () => {
  test('持股分段列出沒有資料的持股（含平倉按鈕），數量與標題一致', async ({ page }) => {
    await page.route('**/data/inactive.json', (route) => route.fulfill({
      json: { date: '2026-09-24', rows: [{ code: '1589', name: '永冠-KY', market: 'twse', last_trade_date: '2026-08-20', status: 'halted' }] },
    }));
    await seed(page, {
      trades: [
        { id: 'a', code: '2330', name: '台積電', status: 'open', openedAt: '2026-09-01', entry: 1000, shares: 1000, stop: 1, target: 2000, reasonType: '', checklist: CHECK },
        { id: 'b', code: '1589', name: '永冠-KY', status: 'open', openedAt: '2026-06-01', entry: 30, shares: 2000, stop: 20, target: 40, reasonType: '', checklist: CHECK },
      ],
    });
    await page.goto('#/mine?seg=hold');
    await expect(page.getByRole('button', { name: /持股\s*2/ })).toBeVisible();
    const card = page.getByTestId('missing-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('永冠-KY');
    await expect(card).toContainText('最後成交 8/20・長期停牌中');
    await expect(card.getByRole('button', { name: '平倉' })).toBeVisible();
  });

  test('小寫代號改成大寫網址（E-08）；沒有個股檔時不露出 HTTP 404', async ({ page }) => {
    await page.goto('#/stock/00980a');
    await expect(page).toHaveURL(/#\/stock\/00980A$/);
    await expect(page.getByText('找不到代號 00980A')).toBeVisible();
    await expect(page.getByText(/HTTP/)).toHaveCount(0);
    await expect(page.getByTestId('stock-crumb')).not.toContainText('上市');
  });
});
