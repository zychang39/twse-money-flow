import { expect, test } from '@playwright/test';

// 興櫃股票（2026-11-14；DECISIONS #465）：搜尋得到、可以加自選（含從貼上的文字加入）、個股頁只顯示興櫃有的資料並說明原因。
// 示範資料有兩檔興櫃：6930 盛新、7777 示範興櫃（最後一天沒有成交）。

test.describe('興櫃股票', () => {
  test('搜尋得到並標示興櫃；個股頁顯示當日均價與說明，沒有分數與五個分段', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('#/search');
    await page.getByRole('searchbox').fill('6930');
    const hit = page.locator('.sresult-main').first();
    await expect(hit).toContainText('盛新');
    await expect(hit).toContainText('6930・興櫃');
    await hit.click();
    await expect(page).toHaveURL(/#\/stock\/6930/);
    await expect(page.locator('.stock-page')).toContainText('6930・興櫃');
    await expect(page.getByTestId('stock-hero')).toContainText('當日均價（興櫃）');
    await expect(page.getByTestId('esb-note')).toContainText('沒有開盤價與收盤價');
    await expect(page.getByTestId('esb-last')).toContainText('成交量');
    await expect(page.getByTestId('esb-coverage')).toContainText('資料累積中：目前有 120 個成交日');
    await expect(page.getByTestId('stock-seg')).toHaveCount(0);
    await expect(page.getByTestId('stock-scores')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('貼上文字加入自選：興櫃股也找得到，加進新群組後出現在自選清單', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('#/mine?seg=watch');
    await page.getByRole('button', { name: '加入自選股' }).first().click();
    await expect(page.getByTestId('watch-import')).toBeVisible();
    await page.getByPlaceholder('預設').fill('Latest');
    await page.evaluate(() => navigator.clipboard.writeText('盛新 現股 3,000\n6930 98,562\n台積電 現股 1,000\n2330 511,258'));
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-summary')).toHaveText('找到 2 檔');
    await expect(page.getByTestId('import-6930')).toContainText('6930・興櫃');
    await expect(page.getByTestId('import-unknown')).toHaveCount(0);
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「Latest」');
    await page.getByRole('button', { name: '關閉' }).click();
    await page.getByRole('group', { name: '群組' }).getByRole('button', { name: 'Latest' }).click();
    await expect(page.locator('.page').first()).toContainText('自選 2 檔');
  });
});
