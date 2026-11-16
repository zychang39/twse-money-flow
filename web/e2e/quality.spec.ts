import { expect, test } from '@playwright/test';
import { gotoStock } from './helpers';

// 生意體質（2026-11；DECISIONS #470）：個股基本面的新區塊與詳情頁、總覽的「生意與市場」、選股 › 更多 › 生意體質。
// 示範資料每一種類型至少一檔（pipeline/derive/demo.py DEMO_ROIC）：2330 報酬高且穩、2454 跟著景氣走、1101 報酬連年降、
// 2882 金融業、6182 只有 2 年、0050 沒有財報。

test.describe('生意體質', () => {
  test('基本面：新區塊在最上面（一句結論、類型、ROIC 對門檻的橫條、三列），原有的營收、季財報、估值都還在', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await gotoStock(page, '#/stock/2330?seg=f');
    const sec = page.getByTestId('sec-quality');
    await expect(sec.getByTestId('quality-concl')).toHaveText('每投入 100 元，一年賺回 31 元，高於 8 元的門檻');
    await expect(sec.getByTestId('quality-kind')).toHaveText('報酬高且穩');
    await expect(sec).toContainText('依規則分類，非推薦');
    await expect(sec.getByTestId('quality-bar')).toHaveAttribute('aria-label', /ROIC 31\.0%，門檻 8%（刻度 0%～40%）/);
    await expect(sec.getByTestId('quality-last')).toContainText('近 10 年都在門檻以上');
    for (const id of ['sec-revenue', 'sec-quarters', 'sec-valuation']) await expect(page.getByTestId(id)).toBeVisible();
    // 新區塊排在營收之前
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="sec-"]')].map((e) => e.getAttribute('data-testid')));
    expect(order.indexOf('sec-quality')).toBeLessThan(order.indexOf('sec-revenue'));
    await expect(sec).not.toContainText(/買進|賣出/);
    expect(errors).toEqual([]);
  });

  test('詳情頁：ROIC 與門檻同一張圖、營收另一張同寬的圖（不用雙軸）、年度表格；返回回到基本面', async ({ page }) => {
    await page.goto('#/stock/2330?seg=f');
    await page.getByTestId('quality-last').click();
    await expect(page).toHaveURL(/#\/stock\/2330\/q\?at=last/);
    await expect(page.getByTestId('q-earn-concl')).toContainText('高於 8 元的門檻');
    await expect(page.getByTestId('roic-chart')).toBeVisible();
    await expect(page.getByTestId('roic-chart')).toContainText('門檻');
    await expect(page.getByTestId('revenue-chart')).toBeVisible();
    // 兩張圖的繪圖區一樣寬（年份上下對齊）
    const widths = await page.evaluate(() => ['roic-chart', 'revenue-chart'].map((id) => Math.round(document.querySelector(`[data-testid="${id}"] svg`)!.getBoundingClientRect().width)));
    expect(widths[0]).toBe(widths[1]);
    await expect(page.getByTestId('q-years').locator('tbody tr')).toHaveCount(11); // 10 個年度＋近四季
    await expect(page.getByTestId('q-kind')).toContainText('報酬高且穩');
    await expect(page.getByTestId('q-pending')).toHaveText('尚未接入：現金流量、董監持股設質、買回庫藏股（資料源待處理）'); // 說明原因、不留白，也不排一列「—」
    await expect(page.getByTestId('q-years')).toContainText('近四季（2026Q2）');
    await page.getByRole('link', { name: /返回|上一頁/ }).first().click();
    await expect(page).toHaveURL(/#\/stock\/2330\?seg=f/);
  });

  test('資料不足與金融業：說明原因，不留白', async ({ page }) => {
    await page.goto('#/stock/6182?seg=f');
    await expect(page.getByTestId('quality-last')).toContainText('資料累積中：目前只有 2 年（自 2024 年起），滿 5 年才分類');
    await expect(page.getByTestId('quality-kind')).toHaveCount(0); // 分不出類型時不放標籤（結論句已經說了高於門檻）
    await page.goto('#/stock/2882?seg=f');
    await expect(page.getByTestId('quality-concl')).toHaveText(/^金融業改看 ROE \d+\.\d%$/);
    await page.goto('#/stock/0050?seg=f');
    await expect(page.getByTestId('quality-empty')).toContainText('資料累積中');
  });

  test('總覽：市場熱度與 ROIC 排名兩條橫條只描述位置；金融業不顯示這一塊', async ({ page }) => {
    await page.goto('#/stock/2330?seg=o');
    const box = page.getByTestId('biz-market');
    await expect(box.getByTestId('biz-market-concl')).toHaveText(/生意(排在|與市場熱度都在)(前段|中段|後段)/);
    await expect(box).toContainText('市場熱度');
    await expect(box).toContainText('ROIC 排名');
    await box.getByTestId('to-quality').click();
    await expect(page).toHaveURL(/seg=f/);
    await page.goto('#/stock/2882?seg=o');
    await expect(page.getByTestId('stock-scores')).toBeVisible();
    await expect(page.getByTestId('biz-market')).toHaveCount(0);
  });

  test('選股 › 更多 › 生意體質：四個走向與類型可以篩選；375 寬不需要左右滑動；點一列到個股基本面', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/explore/screener');
    await page.getByTestId('to-quality-market').click();
    await expect(page).toHaveURL(/#\/explore\/quality/);
    await expect(page.getByTestId('quality-sentence')).toContainText('營收成長的公司');
    const rows = page.getByTestId('quality-table').locator('tbody tr');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('台積電');
    await page.getByTestId('kind-fading').click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('quality-list')).toContainText('報酬連年降');
    await page.getByTestId('kind-fading').click(); // 再點一次取消
    await page.getByTestId('quad-down_down').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('世界');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await rows.first().click();
    await expect(page).toHaveURL(/#\/stock\/5347\?seg=f/);
    await page.goto('#/explore/quality?s=mine');
    await expect(page.getByTestId('quality-none')).toContainText('還沒有自選股');
  });

  test('自訂選股：兩個內建組合（名稱寫出條件）與生意體質欄位；選了就有結果', async ({ page }) => {
    await page.goto('#/explore/screener/custom');
    await page.getByRole('button', { name: '高報酬穩定' }).click();
    await expect(page.getByTestId('screen-desc')).toHaveText('ROIC 近 5 年都 ≥ 15%・營收 3 年成長');
    await expect(page.locator('.page')).toContainText('ROIC 近 5 年最低');
    await expect(page.locator('.page')).toContainText('台積電');
    await expect(page.getByRole('button', { name: '報酬率回升' })).toBeVisible();
  });
});
