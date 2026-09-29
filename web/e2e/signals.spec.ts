import { expect, test } from '@playwright/test';
import { seed } from './helpers';

// 第二部分：訊號驗證與追蹤（S1 回測資料涵蓋與訊號定義、S2 今日新觸發、S3 訊號追蹤、S5 停損比較）
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });

test('S1／S5 回測頁：說明訊號定義、資料涵蓋、各股訊號數，並列停損與每天符合的對照', async ({ page }) => {
  await page.goto('#/explore/backtest?preset=chip_concentration');
  await expect(page.getByTestId('bt-definition')).toContainText('今日新觸發');
  await expect(page.getByTestId('bt-definition')).toContainText('不重疊');
  const cov = page.getByTestId('bt-coverage');
  await expect(cov).toContainText('條件資料起始日');
  await expect(cov).toContainText('千張大戶週變化');
  await expect(cov.getByText(/訊號來自哪些股票/)).toBeVisible();
  const cmp = page.getByTestId('bt-exit-compare');
  await expect(cmp).toContainText('停損 -7%');
  await expect(cmp).toContainText('跌破 20 日線');
  await expect(cmp).toContainText('每天符合');
});

test('S1 回測頁：欄位只涵蓋少數股票時標示「樣本範圍受限」（琥珀色）', async ({ page }) => {
  await page.route('**/data/backtests/chip_concentration.json', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.coverage.limited = true;
    j.coverage.universe = 2379;
    j.coverage.fields = j.coverage.fields.map((f: { field: string }) => (f.field === 'whale_change' ? { ...f, stocks: 31 } : { ...f, stocks: 2400 }));
    await route.fulfill({ response: res, json: j });
  });
  await page.goto('#/explore/backtest?preset=chip_concentration');
  const banner = page.getByTestId('bt-limited');
  await expect(banner).toContainText('樣本範圍受限');
  await expect(banner).toContainText('「千張大戶週變化」只有 31 檔有資料');
  await expect(banner).toHaveClass(/risk/);
});

test('S2 選股：「今日新觸發」切換；條件含千張大戶時顯示資料基準日；可設為追蹤策略', async ({ page }) => {
  await page.goto('#/explore/screener');
  await page.getByRole('group', { name: '內建組合' }).getByRole('button', { name: '三方同買' }).click();
  await expect(page.getByTestId('weekly-note')).toHaveText(/^大戶資料：\d+\/\d+ 持股・\d+\/\d+ 公布/);
  const all = Number((await page.getByRole('heading', { level: 1 }).textContent())!.match(/(\d+) 檔符合/)![1]);
  await page.getByRole('group', { name: '結果範圍' }).getByRole('button', { name: '今日新觸發' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/三方同買：今日新觸發 \d+ 檔/);
  await expect(page.getByTestId('screen-mode-note')).toContainText(/今日新觸發＝\d+\/\d+ 全部條件成立、\d+\/\d+ 不成立/);
  const fresh = Number((await page.getByRole('heading', { level: 1 }).textContent())!.match(/今日新觸發 (\d+) 檔/)![1]);
  expect(fresh).toBeLessThanOrEqual(all);
  await expect(page.getByRole('link', { name: '設為追蹤策略' })).toHaveAttribute('href', '#/discipline/tracking?preset=chip_concentration');
});

test('S3 訊號追蹤：新增策略只記錄啟用之後的觸發；有觸發時顯示狀態與和回測的比較', async ({ page }) => {
  // 新增：從啟用當天（最新資料日）之後才記錄 → 還沒有觸發
  await page.goto('#/discipline/tracking?preset=chip_concentration');
  const sheet = page.getByRole('dialog', { name: '新增追蹤策略' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /三方同買/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByLabel('持有交易日數（N）').fill('5');
  await sheet.getByRole('button', { name: '開始追蹤' }).click();
  const card = page.getByTestId('track-strategy');
  await expect(card).toContainText('三方同買');
  await expect(card).toContainText('持有 5 個交易日');
  await expect(card).toContainText('還沒有新觸發');
  await expect(card.getByTestId('track-compare')).toContainText('回測');
});

test('S3 訊號追蹤：啟用日之後的觸發 → 等待進場／持有中／已出場，累計勝率與回測並排；納入備份', async ({ page }) => {
  await seed(page, { strategies: [{ id: 'st1', presetId: 'chip_concentration', name: '三方同買', conditions: [], horizon: 5, startAfter: '2026-08-20', enabledAt: '2026-08-20T12:00:00Z', active: true }] });
  await page.goto('#/discipline/tracking');
  const card = page.getByTestId('track-strategy');
  await expect(card.getByTestId('track-position').first()).toBeVisible({ timeout: 10_000 });
  const tags = await card.locator('.tag').allTextContents();
  expect(tags.some((t) => t === '已出場')).toBe(true);
  const signals = await card.getByTestId('track-position').allTextContents();
  for (const s of signals) {
    const m = s.match(/訊號 (\d+)\/(\d+)/)!;
    expect(`${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}` > '0820').toBe(true); // 不回溯
  }
  await expect(card.getByTestId('track-compare').locator('tbody tr').first()).toContainText(/已出場\d+ 筆/);
  // 備份包含追蹤策略與紀錄
  const stores = await page.evaluate(() => new Promise<string[]>((res) => { const r = indexedDB.open('twse-money-flow'); r.onsuccess = () => res([...r.result.objectStoreNames]); }));
  expect(stores).toEqual(expect.arrayContaining(['strategies', 'tracked']));
  await page.goto('#/discipline');
  await expect(page.getByRole('link', { name: /訊號追蹤/ })).toBeVisible();
});

test('375pt：追蹤比較表與出場規則比較不需要左右滑動', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page, { strategies: [{ id: 'st1', presetId: 'chip_concentration', name: '三方同買', conditions: [], horizon: 5, startAfter: '2026-08-20', enabledAt: '2026-08-20T12:00:00Z', active: true }] });
  await page.goto('#/discipline/tracking');
  const t = page.getByTestId('track-compare');
  await expect(t).toBeVisible();
  const fits = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.right <= document.documentElement.clientWidth + 0.5 && el.scrollWidth <= el.clientWidth + 1;
  });
  expect(await fits(t)).toBe(true);
  await page.goto('#/explore/backtest?preset=chip_concentration');
  const cmp = page.getByTestId('bt-exit-compare');
  await expect(cmp).toBeVisible();
  expect(await fits(cmp)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
