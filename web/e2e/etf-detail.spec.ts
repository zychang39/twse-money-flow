/**
 * 主動式 ETF 詳細頁（2026-10-08）：持股占比、拉日期看加碼／減碼（權重變化發散橫條）。
 * 示範資料沒有 ETF 持股：以 golden（tests/fixtures/golden/etf_pair.json，pytest 與 vitest 共用）當 etf/{code}.json。
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' }); // 讓 page.route 攔得到資料檔

const golden = JSON.parse(readFileSync(new URL('../../tests/fixtures/golden/etf_pair.json', import.meta.url), 'utf8')) as { detail: unknown };

test.beforeEach(async ({ page }) => {
  await page.route('**/data/etf/00999A.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(golden.detail) }));
});

test('ETF 詳細頁：預設前一次揭露，拉起日看整段期間的加碼與減碼', async ({ page }) => {
  await page.goto('#/explore/etf/00999A');
  await expect(page.getByTestId('etf-detail-sub')).toHaveText('00999A・測試投信・持股 7 檔・持股日 10/6');
  // 預設：前一次揭露（10/5 → 10/6）沒有實際買賣（等比例申購）
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/5 → 10/6・1 次揭露');
  await expect(page.getByTestId('etf-no-change')).toBeVisible();
  // 拉起日到最左：10/1 → 10/6
  await page.getByTestId('etf-from').locator('input').fill('0');
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/1 → 10/6・3 次揭露');
  await expect(page.getByTestId('etf-quick').locator('[aria-pressed=true]')).toHaveText('全部');
  await expect(page.getByTestId('etf-kind-counts')).toContainText('新增 1・加碼 2・減碼 2・剔除 1');
  const rows = page.getByTestId('etf-change-row');
  await expect(rows).toHaveCount(6);
  // 權重增加最多在上（紅）、減少最多在下（綠）
  await expect(rows.first()).toContainText('2330');
  await expect(rows.first().locator('.sv.up')).toBeVisible();
  await expect(rows.last()).toContainText('2412');
  await expect(rows.last().locator('.sv.down')).toBeVisible();
  // 全部持股：含股數沒變、只因股價變動的持股
  await page.getByTestId('etf-filter').getByRole('button', { name: '全部持股' }).click();
  await expect(rows).toHaveCount(8);
  // 持股占比：迄日依權重排序
  await expect(page.getByTestId('etf-weight-row').first()).toContainText('2330');
  // 列進入個股頁
  await rows.first().click();
  await expect(page).toHaveURL(/#\/stock\/2330/);
});

test('ETF 詳細頁：拖迄日時起日跟著往前；375 寬不需要左右滑動', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('#/explore/etf/00999A');
  await page.getByTestId('etf-to').locator('input').fill('0');
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/1 → 10/2・1 次揭露');
  await expect(page.getByTestId('etf-quick').locator('[aria-pressed=true]')).toHaveText('自訂');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  // 滑桿點擊區域至少 44pt
  const box = await page.getByTestId('etf-to').locator('input').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('ETF 清單的列進入詳細頁；投信尚未涵蓋的 ETF 說明原因並連到個股頁', async ({ page }) => {
  await page.goto('#/explore/etf/00981A');
  await expect(page.getByTestId('etf-detail-missing')).toContainText('尚未涵蓋');
  await expect(page.getByRole('link', { name: /股價與成交/ })).toHaveAttribute('href', '#/stock/00981A');
});
