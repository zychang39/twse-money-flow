import { expect, test } from '@playwright/test';

// 2026-10-03 健檢 M2：資料狀態頁（每個資料集的來源、最新日、應有日、涵蓋率、回補進度、失敗原因）
test.describe('資料狀態頁', () => {
  test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });

  test('列出每個資料集，應有日依交易日曆，從資料健康頁與「資料至」可進入', async ({ page }) => {
    await page.goto('./#/me/health');
    await page.getByRole('link', { name: /資料狀態：每個資料集/ }).click();
    await expect(page).toHaveURL(/#\/me\/data$/);
    for (const key of ['quotes', 'insti', 'credit', 'tdcc', 'etf_holdings', 'revenue']) await expect(page.getByTestId(`ds-${key}`)).toBeVisible();
    // 每一列都有「最新」與「應有」兩個日期；沒有裸的「—」（缺值一律附原因）
    const quotes = page.getByTestId('ds-quotes');
    await expect(quotes).toContainText('最新');
    await expect(quotes).toContainText('應有');
    const text = await page.locator('.ds-item').allTextContents();
    for (const t of text) expect(t).not.toMatch(/—(?!（)/);
    // 首頁的「資料至」連到資料狀態頁
    await page.goto('./#/');
    await expect(page.locator('a[href="#/me/data"]').first()).toBeVisible();
  });
});
