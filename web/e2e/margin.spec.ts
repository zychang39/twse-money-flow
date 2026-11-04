import { expect, test } from '@playwright/test';

// 融資增減（2026-10-20）：盤後簡報總覽 2×2（上市融資＋漲跌家數；2026-11-04 主數字改上市）、資金分段的融資區塊、探索 › 融資增減（可回看）。
// 示範資料最後一天是 2026-09-24（四）：固定時鐘在當晚 21:30（融資已公布）與 18:00（尚未公布）。

test.describe('融資增減', () => {
  test('總覽 2×2：上市融資與漲跌家數（上櫃、合計在解讀行）；公布前寫「尚未公布」並附前一天上市', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-09-24T21:30:00+08:00'));
    await page.goto('#/?seg=overview');
    const grid = page.locator('.sum-grid');
    await expect(grid.locator('.sum-title')).toHaveText(['三大法人合計', '成交金額', '上市融資', '漲跌家數']);
    const card = page.getByTestId('sum-margin');
    await expect(card.locator('.sum-concl')).toContainText('億');
    await expect(card).toContainText('9/24・上櫃');
    await expect(card).toContainText('合計');
    await expect(page.getByTestId('sum-breadth').locator('.sum-concl')).toContainText('／');

    await page.clock.setFixedTime(new Date('2026-09-29T18:00:00+08:00')); // 示範日曆 9/25、9/28 休市
    await page.reload();
    await expect(page.getByTestId('sum-margin').locator('.sum-concl')).toHaveText('尚未公布');
    await expect(page.getByTestId('sum-margin')).toContainText('約 20:45 公布・9/24 上市');
    expect(errors).toEqual([]);
  });

  test('資金分段：融資區塊 → 排行；前後切換交易日、期間與排序；375 寬不需要左右滑動', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.clock.setFixedTime(new Date('2026-09-24T21:30:00+08:00'));
    await page.goto('#/?seg=money');
    const sec = page.getByTestId('margin-card');
    await expect(sec.getByTestId('conclusion')).toContainText('上市');
    await expect(sec).toContainText('近 5 日');
    await expect(sec.getByTestId('margin-note')).toContainText('上櫃');
    await expect(sec.getByTestId('margin-note')).toContainText('上市＋上櫃');
    await sec.getByTestId('margin-rank-link').click();

    await expect(page).toHaveURL(/#\/explore\/margin/);
    await expect(page.getByTestId('margin-date')).toHaveText('9/24(四)・最新');
    await expect(page.getByTestId('margin-next')).toBeDisabled();
    const rows = page.getByTestId('margin-rows').locator('.ui-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('margin-rank').locator('.ui-sec-title')).toContainText('當日融資減少');

    await page.getByTestId('margin-prev').click();
    await expect(page).toHaveURL(/d=2026-09-23/);
    await expect(page.getByTestId('margin-date')).toHaveText('9/23(三)');

    await page.getByTestId('margin-period').getByRole('button', { name: '20 日' }).click();
    await expect(page.getByTestId('margin-rank')).toContainText('20 日融資減少');
    await expect(page.getByTestId('margin-rank')).toContainText('期間漲跌');
    await page.getByTestId('margin-kind').getByRole('button', { name: '資增張數' }).click();
    await expect(page.getByTestId('margin-rank')).toContainText('20 日融資增加');
    await expect(page).toHaveURL(/k=up_lots/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('探索有融資增減入口', async ({ page }) => {
    await page.goto('#/explore');
    await expect(page.getByTestId('ex-margin')).toContainText('資減');
    await page.getByTestId('ex-margin').click();
    await expect(page.getByTestId('margin-page')).toBeVisible();
  });
});
