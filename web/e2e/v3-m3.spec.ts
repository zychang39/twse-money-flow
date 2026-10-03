import { expect, test, type Page } from '@playwright/test';
import { gotoStock } from './helpers';

// v3 M3（docs/V3_NOTES.md）：投資風格（波段動能／長期投資）決定個股頁區塊順序、預設期間與一句話結論。

test.use({ viewport: { width: 393, height: 852 } });

// M3（恢復環境光改版）：分段「總覽｜動能｜籌碼｜基本面｜事件」；總覽＝分數（四環＋綜合分）→ 重點指標 → 策略訊號。
// 投資風格只決定預設期間與第一次開啟的分段。
const titles = (page: Page) => page.locator('.stock-lower .ui-sec-title').allTextContents();

test('預設波段動能：總覽分段（分數 → 重點指標 → 策略訊號）；預設 1Y；區塊標題是名詞（沒有問句）', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '總覽', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await titles(page)).toEqual(['分數', '重點指標', '策略訊號']);
  for (const t of await titles(page)) expect(t).not.toMatch(/？|\?/);
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const stats = page.getByTestId('stock-stats');
  for (const k of ['RS 百分位', '距 52 週高', '20 日乖離', '量比', '法人 20 日佔量', '千張大戶週變化']) await expect(stats).toContainText(k);
  await expect(page.getByTestId('to-scores')).toContainText(/綜合分 .*・查看全部因子/);
  await expect(page.locator('.stock-lower')).not.toContainText(/整體狀態如何|動能夠不夠強|便宜|昂貴/);
  // 四環點一下跳到對應分段
  await page.getByTestId('ring-momentum').click();
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '動能', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mom-cards')).toBeVisible();
});

test('切到長期投資：預設 5Y、第一次開啟為基本面分段（營收年增率圖、估值三列；沒有價格帶）', async ({ page }) => {
  await page.goto('#/me/settings');
  await page.getByRole('group', { name: '投資風格' }).getByRole('button', { name: '長期投資' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tmf-style'))).toBe('long');
  await gotoStock(page, '#/stock/2330');
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '5Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '基本面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sec-revenue').getByRole('img', { name: /營收年增率柱狀圖/ })).toBeVisible();
  const val = page.getByTestId('sec-valuation');
  for (const k of ['本益比', '淨值比', '殖利率']) await expect(val).toContainText(k);
  await expect(val).toContainText('3 年百分位');
  await expect(page.locator('.stock-lower')).not.toContainText(/便宜|合理價|昂貴|高於區間上緣/);
});

test('兩種風格的期間各自記住；分段記住上次選擇', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await page.getByTestId('stock-periods').first().getByRole('button', { name: '3M', exact: true }).click();
  await page.getByTestId('stock-seg').getByRole('button', { name: '事件', exact: true }).click();
  await page.evaluate(() => { localStorage.setItem('tmf-style', 'long'); window.dispatchEvent(new Event('style-change')); });
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '5Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { localStorage.setItem('tmf-style', 'swing'); window.dispatchEvent(new Event('style-change')); });
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '3M', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '事件', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
