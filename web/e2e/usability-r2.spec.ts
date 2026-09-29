import { expect, test } from '@playwright/test';

// 可用性測試修正（第 2 輪）：每一項的回歸測試。
// 視窗 390×844（使用者測試環境）；個別測試另指定 375／393。
test.use({ viewport: { width: 390, height: 844 } });

test.describe('#1 版本字串與 service worker 更新', () => {
  test('設定頁與資料健康頁顯示同一個版本字串（commit 短碼・建置日期）', async ({ page }) => {
    await page.goto('#/me/settings');
    const v = page.getByTestId('app-version-string');
    await expect(v).toHaveText(/^[0-9a-z]{4,}・\d{4}-\d{2}-\d{2}$/);
    const text = await v.textContent();
    await expect(page.getByRole('button', { name: '檢查更新' })).toBeVisible();
    await page.goto('#/me/health');
    await expect(page.getByTestId('app-version-string')).toHaveText(text!);
  });

  test('service worker 安裝成功（index.html 版本驗證通過）並控制頁面；檢查更新回報已是最新版本', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
    const keys = await page.evaluate(() => caches.keys());
    expect(keys.some((k) => k.startsWith('app-'))).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto('#/me/settings');
    await page.getByRole('button', { name: '檢查更新' }).click();
    await expect(page.getByText('已是最新版本')).toBeVisible();
  });
});
