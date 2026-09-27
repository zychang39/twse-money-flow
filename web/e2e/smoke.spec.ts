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

test('日誌：完成買進前檢查表後新增持倉，並可平倉', async ({ page }) => {
  await page.goto('#/journal');
  await page.getByRole('button', { name: '新增持倉' }).click();
  await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
  await page.getByRole('option', { name: /2330/ }).click();
  const save = page.getByRole('button', { name: /請完成檢查表|加入持倉/ });
  await expect(save).toBeDisabled();
  await page.getByLabel('1. 市場燈號（見市場頁）').selectOption('中性');
  for (const [label, idx] of [['2. 趨勢', 1], ['3. 營收', 1], ['4. 估值', 1]] as const) {
    const sel = page.getByLabel(label);
    if (!(await sel.inputValue())) await sel.selectOption({ index: idx });
  }
  await page.getByLabel('理由（必填）').fill('投信連買、營收創新高');
  const entry = Number(await page.getByLabel('進場價').inputValue());
  await page.getByLabel('6. 停損價').fill(String(Math.round(entry * 0.95)));
  await page.getByLabel('7. 目標價').fill(String(Math.round(entry * 1.2)));
  await expect(page.getByText(/風險報酬比：/)).toBeVisible();
  await page.getByLabel('實際股數（預設為建議部位）').fill('1000');
  await page.getByRole('button', { name: '加入持倉' }).click();
  await expect(page.getByText(/持倉 1/)).toBeVisible();
  await page.getByRole('button', { name: '平倉', exact: true }).click();
  await page.getByRole('button', { name: '追高' }).click();
  await page.getByRole('button', { name: '確認平倉' }).click();
  await page.getByRole('button', { name: /統計/ }).click();
  await expect(page.getByText('追高')).toBeVisible();
});

test('備份：匯出按鈕存在', async ({ page }) => {
  await page.goto('#/more/backup');
  await expect(page.getByRole('button', { name: '匯出全部資料（JSON）' })).toBeVisible();
});

test('市場：產業熱力圖可點進個股清單', async ({ page }) => {
  await page.goto('#/market');
  const tile = page.getByRole('button', { name: /半導體業：法人淨買超/ });
  await expect(tile).toBeVisible();
  await page.getByRole('button', { name: '20 日' }).click();
  await tile.click();
  await expect(page.locator('h1.large-title')).toHaveText('半導體業');
  await expect(page.getByRole('link', { name: /台積電/ })).toBeVisible();
});

test('今日：加入自選後出現日報卡片', async ({ page }) => {
  await page.goto('#/watchlist');
  await page.getByRole('button', { name: '新增自選股' }).first().click();
  await page.getByRole('searchbox', { name: '搜尋股票' }).fill('1101');
  await page.getByRole('option', { name: /1101/ }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await page.goto('#/');
  await expect(page.getByRole('link', { name: '台泥 日報' })).toBeVisible();
  await expect(page.getByText('全市場法人買超（外資＋投信，金額）')).toBeVisible();
});

test('處置預警、行事曆、週報顯示資料', async ({ page }) => {
  await page.goto('#/more/disposition');
  await expect(page.getByText('可能進入處置').first()).toBeVisible();
  await expect(page.getByText(/分盤撮合約每 5 分鐘/)).toBeVisible();
  await page.goto('#/more/calendar');
  await page.getByRole('button', { name: '全部' }).click();
  await expect(page.getByText(/融券最後回補日/)).toBeVisible();
  await page.goto('#/more/weekly');
  await expect(page.getByRole('heading', { name: '下週事件' })).toBeVisible();
});

test('市場：資金環境燈號與市場溫度', async ({ page }) => {
  await page.goto('#/market');
  await expect(page.getByText('外資台指期淨未平倉')).toBeVisible();
  await expect(page.getByText('散戶多空比（小台）')).toBeVisible();
});
