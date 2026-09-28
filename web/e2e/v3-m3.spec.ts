import { expect, test, type Page } from '@playwright/test';
import { gotoStock } from './helpers';

// v3 M3（docs/V3_NOTES.md）：投資風格（波段動能／長期投資）決定個股頁區塊順序、預設期間與一句話結論。

test.use({ viewport: { width: 393, height: 852 } });

const questions = (page: Page) => page.locator('.stock-lower > section.block > .eyebrow').allTextContents();

test('預設波段動能：區塊順序、預設 1Y、每個區塊標題是「問題＋一句結論」', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await expect(page.locator('.stock-lower')).toHaveAttribute('data-style', 'swing');
  expect(await questions(page)).toEqual([
    '整體狀態如何？（波段動能）', '動能夠不夠強？', '法人在買還是賣？', '融資與空方在做什麼？', '大戶在增加還是減少？', '營收與基本面如何？', '現在貴不貴？', '最近有什麼事件？',
  ]);
  await expect(page.getByRole('group', { name: '股價走勢期間' }).first().getByRole('button', { name: /^1Y/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sec-momentum h2')).toHaveText(/^RS \d+，(站上全部均線|跌破全部均線|跌破 [\d／]+ 日線|均線資料不足)$/);
  await expect(page.getByTestId('momentum-facts')).toContainText('距 52 週高點');
  await expect(page.getByTestId('momentum-facts')).toContainText('量能');
  await expect(page.locator('#sec-momentum')).toContainText('240 日線');
  // 每個區塊都有非空的一句結論
  for (const h of await page.locator('.stock-lower > section.block > h2').allTextContents()) expect(h.trim().length).toBeGreaterThan(3);
  await expect(page.locator('#sec-conclusion h2')).toHaveText(/動能/);
});

test('切到長期投資：區塊順序、預設 5Y、結論側重營收／獲利／估值；本益比河流、外資持股比趨勢', async ({ page }) => {
  await page.goto('#/me/settings');
  await page.getByRole('group', { name: '投資風格' }).getByRole('button', { name: '長期投資' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tmf-style'))).toBe('long');
  await gotoStock(page, '#/stock/2330');
  await expect(page.locator('.stock-lower')).toHaveAttribute('data-style', 'long');
  expect(await questions(page)).toEqual([
    '整體狀態如何？（長期投資）', '營收有沒有在成長？', '獲利品質好不好？', '現在貴不貴？', '大戶在增加還是減少？', '法人在買還是賣？', '融資與空方在做什麼？', '最近有什麼事件？',
  ]);
  await expect(page.getByRole('group', { name: '股價走勢期間' }).first().getByRole('button', { name: /^5Y/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sec-conclusion h2')).toHaveText(/營收|ROE|本益比/);
  await expect(page.locator('#sec-conclusion h2')).not.toHaveText(/動能/);
  await expect(page.locator('#sec-revenue').getByRole('img', { name: /營收年增率柱狀圖/ })).toBeVisible();
  await expect(page.locator('#sec-profit h2')).toContainText('EPS');
  await expect(page.getByTestId('pe-river')).toBeVisible();
  await expect(page.getByTestId('foreign-trend')).toBeVisible();
  await expect(page.getByTestId('style-note')).toContainText('長期投資');
});

test('兩種風格的期間各自記住；切換風格時個股頁即時重排', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('group', { name: '股價走勢期間' }).first().getByRole('button', { name: /^3M/ }).click();
  await page.evaluate(() => { localStorage.setItem('tmf-style', 'long'); window.dispatchEvent(new Event('style-change')); });
  await expect(page.locator('.stock-lower')).toHaveAttribute('data-style', 'long');
  await expect(page.getByRole('group', { name: '股價走勢期間' }).first().getByRole('button', { name: /^5Y/ })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { localStorage.setItem('tmf-style', 'swing'); window.dispatchEvent(new Event('style-change')); });
  await expect(page.getByRole('group', { name: '股價走勢期間' }).first().getByRole('button', { name: /^3M/ })).toHaveAttribute('aria-pressed', 'true');
});
