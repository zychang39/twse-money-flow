import { expect, test } from '@playwright/test';

// 第三輪修正（docs/design/ROUND3.md）：M1 新版本提示、M2 法人買賣超報表、M3 大戶／散戶門檻、M4 多空對照、M5 參考連結。

test.use({ viewport: { width: 393, height: 852 } });

// ---------------------------------------------------------------- M1 新版本提示
test('M1：新版本接手後顯示「新版本已就緒」，可重新載入或稍後', async ({ page }) => {
  await page.goto('#/');
  await expect(page.getByText('新版本已就緒')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('app-updated')));
  const toast = page.getByRole('status').filter({ hasText: '新版本已就緒' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: '重新載入' })).toBeVisible();
  // 浮在底部導覽之上，不擋住導覽
  const t = (await toast.boundingBox())!;
  const dock = (await page.locator('.tabbar').boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(dock.y);
  await toast.getByRole('button', { name: '稍後' }).click();
  await expect(toast).toHaveCount(0);
});
