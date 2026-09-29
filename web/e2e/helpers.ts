import { expect, type Page } from '@playwright/test';

/**
 * 個股頁：前兩個區塊先畫，其餘在捲動接近時才畫（v3 效能）。需要下方區塊的測試先捲到底把全部區塊畫出來，再捲回頂端。
 */
export async function revealAllSections(page: Page): Promise<void> {
  await expect(page.locator('.stock-lower')).toBeVisible();
  for (let i = 0; i < 20; i++) {
    const ph = page.locator('.sections-placeholder');
    if (!(await ph.count())) break;
    // 佔位元素可能在捲動途中被移除（全部區塊已畫出）；沒有逾時的話 locator 會一直等它重新出現，直到整個測試逾時
    await ph.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(80);
  }
  await expect(page.locator('.sections-placeholder')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
}

export async function gotoStock(page: Page, hash: string): Promise<void> {
  await page.goto(hash);
  await revealAllSections(page);
}

/** 直接寫入 IndexedDB（自選、持倉、設定…）。App 第一次讀寫時才建立資料庫，先開設定頁等 object store 建好。 */
export async function seed(page: Page, stores: Record<string, unknown[]>): Promise<void> {
  await page.goto('#/me/settings');
  await expect(page.locator('.page')).toBeVisible();
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
