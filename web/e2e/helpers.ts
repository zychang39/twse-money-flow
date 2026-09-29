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
