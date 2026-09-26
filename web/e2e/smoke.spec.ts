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

test('選股：切換預設組合、新增條件並看到結果', async ({ page }) => {
  await page.goto('#/screener');
  await page.getByRole('button', { name: '強勢突破' }).click();
  await expect(page.getByRole('heading', { name: /結果/ })).toBeVisible();
  await page.getByRole('button', { name: '新增條件' }).click();
  await expect(page.getByLabel('欄位').last()).toHaveValue('composite');
  await expect(page.getByRole('link', { name: '一鍵回測' })).toHaveAttribute('href', /#\/backtest\?c=/);
});

test('方法說明由設定產生', async ({ page }) => {
  await page.goto('#/more/methodology');
  await expect(page.getByText('外資連買天數')).toBeVisible();
  await expect(page.getByText(/線性：-5 → 0 分/).first()).toBeVisible();
});

test('設定：調整權重後自選卡片仍可顯示', async ({ page }) => {
  await page.goto('#/more/settings');
  await expect(page.getByLabel('籌碼分權重')).toBeVisible();
  await page.getByRole('button', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('回測：預設組合顯示統計；自訂條件在 Web Worker 計算', async ({ page }) => {
  await page.goto('#/backtest');
  await expect(page.getByRole('columnheader', { name: '勝率' })).toBeVisible();
  await expect(page.getByText('訊號衰減曲線')).toBeVisible();
  const c = encodeURIComponent(JSON.stringify([{ field: 'composite', op: '>=', value: 50 }]));
  await page.goto(`#/backtest?c=${c}&name=test`);
  await expect(page.getByRole('columnheader', { name: '勝率' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/訊號 \d+ 筆 · 範圍：成交值前/)).toBeVisible();
});
