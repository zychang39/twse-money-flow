/**
 * M7 四種狀態（F 節）：每頁模擬載入中（回應延遲 → 骨架）、載入失敗（資料檔 500 → 一行說明＋重試或資料健康連結），
 * 不得出現空白頁、無限轉圈或 JS 錯誤。
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

const PAGES = ['#/', '#/?seg=market', '#/mine', '#/stock/2330', '#/stock/2330?seg=c', '#/stock/2330?seg=f', '#/explore', '#/explore/screener', '#/explore/strategies',
  '#/explore/strategies/rev_confirm', '#/explore/sectors', '#/explore/market', '#/explore/evidence', '#/explore/etf', '#/explore/calendar', '#/explore/disposition', '#/discipline', '#/me/health'];

for (const hash of PAGES) {
  // 流程頁只用本機資料（資料檔失敗不影響），不測載入失敗
  if (hash !== '#/discipline') test(`載入失敗：${hash}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/\/data\/(?!meta\.json).*\.json/, (r) => r.fulfill({ status: 500, body: 'error' }));
    await page.goto(hash);
    await page.waitForTimeout(3000);
    const text = await page.locator('.page').innerText();
    expect(text.trim().length).toBeGreaterThan(0);
    // 有失敗說明（一行原因／重試／資料健康）
    const failed = page.locator('[data-phase="error"], .banner, .ds-error').or(page.getByText(/暫時無法取得|讀取失敗|無法載入|找不到/));
    await expect(failed.first()).toBeVisible();
    // 沒有停在載入中
    await expect(page.locator('[data-phase="loading"], [aria-busy="true"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`載入中：${hash}`, async ({ page }) => {
    await page.route(/\/data\/.*\.json/, async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
    await page.goto(hash);
    await page.waitForTimeout(400);
    await expect(page.locator('.skeleton, [data-phase="loading"], [aria-busy="true"]').first()).toBeVisible();
    // 載入完成後骨架消失
    await page.waitForTimeout(4000);
    await expect(page.locator('[data-phase="loading"], [aria-busy="true"]')).toHaveCount(0);
  });
}

// 資料落後：把時間設在資料日之後 10 天（中間有多個交易日）→ 各頁頁首下方顯示橘色「資料落後 收盤行情 …（落後 N 個交易日）」，可點進資料健康頁
const STALE_PAGES: [string, string][] = [['#/', 'brief-lag'], ['#/stock/2330', 'stock-stale'], ['#/explore', 'page-stale'], ['#/explore/screener', 'page-stale'],
  ['#/explore/strategies', 'page-stale'], ['#/explore/sectors', 'page-stale'], ['#/explore/market', 'page-stale'], ['#/explore/evidence', 'page-stale'], ['#/explore/etf', 'page-stale'], ['#/explore/disposition', 'page-stale']];
for (const [hash, id] of STALE_PAGES) {
  test(`資料落後：${hash}`, async ({ page, request }) => {
    const { market_date: d } = await (await request.get('data/meta.json')).json() as { market_date: string };
    const later = new Date(`${d}T20:00:00+08:00`);
    later.setDate(later.getDate() + 10);
    await page.clock.setFixedTime(later);
    await page.goto(hash);
    const note = page.getByTestId(id);
    await expect(note).toBeVisible();
    await expect(note).toContainText(/資料落後/);
    await expect(note).toContainText(/收盤行情 \d+\/\d+（落後 \d+ 個交易日）/);
  });
}
