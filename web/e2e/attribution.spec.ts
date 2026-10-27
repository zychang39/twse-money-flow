import { expect, test } from '@playwright/test';

// 報酬拆解（2026-10-27）：個股拆解（三把尺、三層、模型與 Alpha、曝險、同業籃子、能力或運氣）與因子順逆風。
// 示範資料只有 12 檔、約 15 個月（pipeline 以 attribution.demo_settings 放寬門檻），只檢查畫面結構，數字沒有意義。

test.describe('報酬拆解', () => {
  test('個股拆解：各區塊都有；換一檔、換期間；375 寬不需要左右滑動', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/explore/attribution?code=2330&p=6');
    await expect(page.getByTestId('attr-pick')).toContainText('2330');
    for (const id of ['attr-rulers', 'attr-layers', 'attr-models', 'attr-exposures', 'attr-peers', 'attr-luck']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('attr-ruler-rows').locator('.br-row')).toHaveCount(4);
    await expect(page.getByTestId('attr-layer1')).toContainText('市場');
    await expect(page.getByTestId('attr-layer3')).toContainText('Alpha');
    await expect(page.getByTestId('attr-peer-rows').locator('.ui-row').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買/);

    await page.getByTestId('attr-period').getByRole('button', { name: '3 個月' }).click();
    await expect(page).toHaveURL(/p=3/);
    await expect(page.getByTestId('attr-range')).toContainText('持有期間太短');

    await page.getByTestId('attr-pick').click();
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2317');
    await page.getByRole('option').first().click();
    await expect(page).toHaveURL(/code=2317/);
    await expect(page.getByTestId('attr-pick')).toContainText('2317');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('因子順逆風：五個因子、點一列換圖；探索有入口', async ({ page }) => {
    await page.goto('#/explore');
    await expect(page.getByTestId('ex-attribution')).toBeVisible();
    await page.getByTestId('ex-attribution').click();
    await expect(page.getByTestId('attr-page')).toBeVisible();
    await page.getByTestId('attr-seg').getByRole('button', { name: '因子順逆風' }).click();
    await expect(page.getByTestId('attr-trend-rows').locator('.br-row')).toHaveCount(5);
    await page.getByTestId('attr-trend-hml').click();
    await expect(page.getByTestId('attr-factor-chart').locator('.ui-sec-title')).toHaveText('價值因子');
  });
});
