import { expect, test } from '@playwright/test';

// 報酬拆解（2026-10-27）：個股頁 › 動能 ›「報酬來源」摘要卡與詳情頁；個股拆解（三把尺、兩個狀態、三層、模型與 Alpha、曝險、同業籃子、能力或運氣）。
// 2026-11-13：順風檢查（風格 ETF 與類股當溫度計、同一陣風、自選的兩個狀態、自己算一次）；第二層改用同業籃子與風格 ETF。
// 示範資料只有 12 檔、約 15 個月（pipeline 以 attribution.demo_settings 放寬門檻；風格溫度計用追蹤的報酬指數），只檢查畫面結構，數字沒有意義。

test.describe('報酬拆解', () => {
  test('個股拆解：各區塊都有；換一檔、換期間；375 寬不需要左右滑動', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/explore/attribution?code=2330&p=6');
    await expect(page.getByTestId('attr-pick')).toContainText('2330'); // 網址帶了代號 → 個股拆解
    for (const id of ['attr-rulers', 'attr-wind-stock', 'attr-layers', 'attr-models', 'attr-exposures', 'attr-peers', 'attr-luck']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // 尺：這一檔、大盤、類股（半導體類報酬指數）、同業籃子、風格 ETF
    await expect(page.getByTestId('attr-ruler-rows').locator('.br-row')).toHaveCount(5);
    await expect(page.getByTestId('attr-ruler-sector')).toContainText('半導體');
    await expect(page.getByTestId('attr-ruler-style')).toContainText('風格 ETF');
    // 兩個狀態：風格 × 類股，各有狀態標籤；五種風格的百分位
    const wind = page.getByTestId('attr-wind-rows');
    await expect(wind).toContainText('風格：');
    await expect(wind).toContainText('類股：半導體');
    await expect(wind.locator('.ui-tag')).toHaveCount(2);
    await expect(page.getByTestId('attr-style-rows').locator('.ui-row')).toHaveCount(5);
    await expect(page.getByTestId('attr-layer1')).toContainText('市場');
    // 第二層：產業（同業籃子）＋風格 ETF（每列寫出 ETF 代號與曝險）
    const layer2 = page.getByTestId('attr-layer2');
    await expect(layer2).toContainText('同業籃子');
    await expect(page.getByTestId('attr-layer2-quality')).toContainText('00938');
    await expect(page.getByTestId('attr-layer2-quality')).toContainText('曝險');
    await expect(page.getByTestId('attr-layer3')).toContainText('Alpha');
    await expect(page.getByTestId('attr-models')).toContainText('加上同業與風格 ETF');
    await expect(page.getByTestId('attr-peer-rows').locator('.ui-row').first()).toBeVisible();
    await expect(page.getByTestId('attr-fit')).toContainText('類股報酬指數');
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買/);

    await page.getByTestId('attr-period').getByRole('button', { name: '3 個月' }).click();
    await expect(page).toHaveURL(/p=3/);
    await expect(page.getByTestId('attr-range')).toContainText('持有期間太短');

    await page.getByTestId('attr-pick').click();
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2317');
    await page.getByRole('option').first().click();
    await expect(page).toHaveURL(/code=2317/);
    await expect(page.getByTestId('attr-pick')).toContainText('2317');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('個股頁：動能分段的「報酬來源」卡 → 詳情頁（同一套拆解，不含換股）→ 順風檢查', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/stock/2330?seg=m');
    const card = page.getByTestId('mom-attr');
    await expect(card).toContainText('報酬來源');
    await expect(card).toContainText('Alpha');
    await expect(card.locator('.attr-mini-row')).toHaveCount(3);
    await expect(page.getByTestId('mom-attr-wind')).toContainText('半導體'); // 兩個狀態：風格 × 類股
    await expect(card).toHaveAttribute('href', '#/stock/2330/m/attribution');
    await card.click();
    await expect(page).toHaveURL(/#\/stock\/2330\/m\/attribution/);
    await expect(page.locator('h1.ui-large')).toContainText('報酬來源');
    for (const id of ['attr-rulers', 'attr-wind-stock', 'attr-layers', 'attr-models', 'attr-peers', 'attr-luck']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('attr-pick')).toHaveCount(0);
    await page.getByTestId('attr-period').getByRole('button', { name: '2 年' }).click();
    await expect(page).toHaveURL(/p=24/);
    await expect(page.getByTestId('attr-layers')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('attr-to-wind')).toHaveAttribute('href', /#\/explore\/attribution\?seg=wind&code=2330/);
    await page.getByTestId('attr-to-wind').click();
    await expect(page.getByTestId('wind-styles')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('順風檢查：每月五步、五種風格、類股三堆、同一陣風、自己算一次；375 寬不需要左右滑動', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/explore');
    await expect(page.getByTestId('ex-attribution')).toBeVisible();
    await page.getByTestId('ex-attribution').click();
    await expect(page.getByTestId('attr-page')).toBeVisible();
    // 預設分段＝順風檢查（先看風向、再看公司）
    await expect(page.getByTestId('attr-wind')).toBeVisible();
    await expect(page.getByTestId('wind-step-rows').locator('.ui-row')).toHaveCount(5);
    // 五種風格各一列（ETF 代號＋狀態）；點一列看細節（12／6／3 個月各跟大盤比）
    const styles = page.getByTestId('wind-style-rows');
    await expect(styles.locator('.br-row')).toHaveCount(5);
    await expect(page.getByTestId('wind-style-quality')).toContainText('00938');
    await expect(page.getByTestId('wind-style-quality')).toContainText('順風');
    await expect(page.getByTestId('wind-style-momentum')).toContainText('暫定'); // 未滿 12 個月：暫定
    await page.getByTestId('wind-style-value').click();
    const detail = page.getByTestId('wind-style-detail');
    await expect(detail).toContainText('00940');
    await expect(detail).toContainText('近 12 個月');
    await expect(detail).toContainText('大盤');
    // 類股：三堆（順風／中性／逆風）；示範資料 6 個類股
    for (const k of ['tail', 'neutral', 'head']) await expect(page.getByTestId(`wind-pile-${k}`)).toBeVisible();
    await expect(page.getByTestId('wind-pile-tail')).toContainText('半導體');
    await page.getByTestId('wind-pile-more-head').click();
    await expect(page.getByTestId('wind-pile-head').locator('.br-row')).toHaveCount(4);
    // 同一陣風：風格 ETF 的類股超配（持股）
    await expect(page.getByTestId('wind-same-quality')).toContainText('超配');
    await expect(page.getByTestId('wind-same-quality')).toContainText('金融保險');
    // 自選的兩個狀態：還沒有自選時說明用途
    await expect(page.getByTestId('wind-watch')).toContainText('還沒有自選');
    // 自己算一次：兩個數字 → 三種狀態（含「贏大盤但賠錢仍是逆風」）
    const out = page.getByTestId('wind-try-out');
    await expect(out).toContainText('順風');
    await page.getByTestId('wind-try-a').fill('15');
    await expect(out).toContainText('中性');
    await page.getByTestId('wind-try-a').fill('-5');
    await page.getByTestId('wind-try-b').fill('-10');
    await expect(out).toContainText('逆風');
    // 對照：自建的多空因子（原本的「因子順逆風」）
    await expect(page.getByTestId('attr-trend-rows').locator('.br-row')).toHaveCount(5);
    await page.getByTestId('attr-trend-hml').click();
    await expect(page.getByTestId('attr-factor-chart').locator('.ui-sec-title')).toHaveText('價值因子');
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('順風檢查：自選的每一檔標上風格與類股的狀態，點進個股的報酬來源；舊連結 seg=factor 仍可用', async ({ page }) => {
    await page.goto('#/mine?seg=watch');
    await page.getByRole('button', { name: '加入自選股' }).first().click();
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
    await page.getByRole('option', { name: /2330/ }).click();
    await page.getByRole('button', { name: '關閉' }).click();
    await page.goto('#/explore/attribution?seg=factor');
    await expect(page.getByTestId('wind-styles')).toBeVisible();
    const rows = page.getByTestId('wind-watch-rows');
    await expect(rows.locator('.ui-row')).toHaveCount(1);
    await expect(rows).toContainText('台積電');
    await expect(rows).toContainText('半導體');
    await expect(rows.locator('.ui-row').first()).toHaveAttribute('href', '#/stock/2330/m/attribution');
  });
});
