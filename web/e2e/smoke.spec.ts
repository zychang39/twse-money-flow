import { expect, test } from '@playwright/test';

// 冒煙測試：逐一載入每個分頁與「更多」子頁，確認沒有 JS 錯誤、標題正確、頁尾免責聲明存在。
const PAGES: { hash: string; title: RegExp }[] = [
  { hash: '#/', title: /今日/ },
  { hash: '#/watchlist', title: /自選/ },
  { hash: '#/screener', title: /選股/ },
  { hash: '#/market', title: /市場/ },
  { hash: '#/journal', title: /日誌/ },
  { hash: '#/more', title: /更多/ },
  { hash: '#/more/health', title: /資料健康/ },
  { hash: '#/more/methodology', title: /方法說明/ },
  { hash: '#/more/settings', title: /設定/ },
  { hash: '#/more/backup', title: /備份/ },
  { hash: '#/more/weekly', title: /週報/ },
  { hash: '#/more/calendar', title: /行事曆/ },
  { hash: '#/more/disposition', title: /處置/ },
  { hash: '#/backtest', title: /回測/ },
  { hash: '#/stock/2330', title: /台積電/ },
];

for (const p of PAGES) {
  test(`載入 ${p.hash}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(p.hash);
    await expect(page.locator('h1.large-title')).toHaveText(p.title, { timeout: 10_000 });
    await expect(page.getByText('僅供研究參考，非投資建議')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主要分頁' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('自選：新增後出現卡片，點擊進入個股頁', async ({ page }) => {
  await page.goto('#/watchlist');
  await page.getByRole('button', { name: '新增自選股' }).first().click();
  await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
  await page.getByRole('option', { name: /2330/ }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('link', { name: /台積電 2330 詳細資料/ })).toBeVisible();
  await page.getByRole('link', { name: /台積電 2330 詳細資料/ }).click();
  await expect(page.locator('h1.large-title')).toHaveText(/台積電/);
  await expect(page.getByRole('img', { name: /K 線圖/ })).toBeVisible();
});
