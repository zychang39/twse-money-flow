import { expect, test } from '@playwright/test';

// 報酬拆解（2026-10-27）：個股頁 › 動能 ›「報酬來源」摘要卡與詳情頁；個股拆解（三把尺、兩個狀態、三層、模型與 Alpha、曝險、同業籃子、能力或運氣）。
// 2026-11-13：順風檢查（風格 ETF 與類股當溫度計、同一陣風、自己算一次）；第二層改用同業籃子與風格 ETF。
// 2026-11-19：改名「順風選股」，三步：① 風向 → ② 找股票（從風格、從類股、我的名單、能力圈）→ ③ 個股。
// 示範資料只有 12 檔、約 15 個月（pipeline 以 attribution.demo_settings 放寬門檻；風格溫度計用追蹤的報酬指數），只檢查畫面結構，數字沒有意義。

test.describe('順風選股', () => {
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

  test('個股頁：動能分段的「報酬來源」卡 → 詳情頁（同一套拆解，不含換股）→ 風向', async ({ page }) => {
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

  test('① 風向：本月三個數字、風格與類股同一種橫條（0 與大盤兩條線、分三堆）、點一列看細節、同一陣風；375 寬不需要左右滑動', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/explore');
    await expect(page.getByTestId('ex-attribution')).toContainText('順風選股');
    await page.getByTestId('ex-attribution').click();
    await expect(page.getByTestId('attr-page')).toBeVisible();
    await expect(page.locator('h1.ui-large')).toContainText('順風選股');
    // 三步的分段；預設＝風向（先看風向、再找股票、最後看個股）
    await expect(page.getByTestId('attr-seg').getByRole('button')).toHaveText(['① 風向', '② 找股票', '③ 個股']);
    await expect(page.getByTestId('attr-wind')).toBeVisible();
    await expect(page.getByTestId('wind-stats').locator('.ui-stat')).toHaveCount(3);
    await expect(page.getByTestId('wind-moved')).toContainText('跟上個月底');
    // 風格：五列分在三堆裡，每列有 ETF 代號與「比大盤」；圖例說明兩條線
    const styles = page.getByTestId('wind-styles');
    await expect(styles.locator('.br-row')).toHaveCount(5);
    await expect(styles.getByTestId('wind-legend')).toContainText('大盤');
    await expect(styles.locator('.wtrack-mkt').first()).toBeAttached();
    await expect(page.getByTestId('wind-pile-style-tail')).toContainText('品質');
    await expect(page.getByTestId('wind-style-quality')).toContainText('00938');
    await expect(page.getByTestId('wind-style-quality')).toContainText('比大盤');
    await expect(page.getByTestId('wind-style-momentum')).toContainText('暫定'); // 未滿 12 個月：暫定
    // 未滿 12 個月的那一類：寫出已有幾個月、哪一天滿（不只寫「資料累積中」）
    await expect(styles).toContainText('滿 12 個月');
    // 點一列 → 面板：狀態、各期間跟大盤比、例子、到「找股票」
    await page.getByTestId('wind-style-momentum').click();
    const detail = page.getByTestId('wind-style-detail');
    await expect(page.getByTestId('wind-style-state')).toHaveText('順風（暫定）');
    await expect(page.getByTestId('wind-style-since')).toContainText('以來');
    await expect(page.getByTestId('wind-style-since')).toContainText('滿 12 個月');
    await expect(detail).toContainText('大盤');
    await page.getByRole('button', { name: '關閉' }).click();
    await page.getByTestId('wind-style-quality').click();
    await expect(page.getByTestId('wind-style-detail')).toContainText('近 12 個月');
    await expect(page.getByTestId('wind-style-examples')).toContainText('非推薦');
    await page.getByTestId('wind-style-pick').click();
    await expect(page).toHaveURL(/seg=pick&src=style&k=quality/);
    await expect(page.getByTestId('pick-style')).toBeVisible();
    await page.goBack();
    // 類股：同一種畫法；示範資料 6 個類股（順風 2、逆風 4）；逆風那一堆可以展開
    await expect(page.getByTestId('wind-pile-sector-tail')).toContainText('半導體');
    await expect(page.getByTestId('wind-pile-sector-neutral')).toContainText('中性 0');
    await expect(page.getByTestId('wind-pile-sector-head').locator('.br-row')).toHaveCount(4);
    await page.getByTestId('wind-sector-半導體').click();
    await expect(page.getByTestId('wind-sector-state')).toHaveText('順風');
    await expect(page.getByTestId('wind-sector-detail')).toContainText('最大權值股');
    await expect(page.getByTestId('wind-sector-pick')).toContainText('看這個類股的股票');
    await page.getByRole('button', { name: '關閉' }).click();
    // 同一陣風：風格 ETF 的類股超配（持股）；標「同一陣風／不同陣風」
    await expect(page.getByTestId('wind-same-quality')).toContainText('超配');
    await expect(page.getByTestId('wind-same-quality')).toContainText('金融保險');
    await expect(page.getByTestId('wind-same-quality').locator('.ui-tag')).toHaveText(/同一陣風|不同陣風/);
    // 下一步：從順風的類型直接列出例子，連到找股票
    await expect(page.getByTestId('wind-next-style-quality')).toContainText('例：');
    await expect(page.getByTestId('wind-next-list')).toHaveAttribute('href', /seg=pick&src=list/);
    // 更多：自己算一次（兩個數字 → 三種狀態，含「贏大盤但賠錢仍是逆風」）
    await page.getByTestId('wind-more-try').click();
    const out = page.getByTestId('wind-try-out');
    await expect(out).toContainText('順風');
    await page.getByTestId('wind-try-a').fill('15');
    await expect(out).toContainText('中性');
    await page.getByTestId('wind-try-a').fill('-5');
    await page.getByTestId('wind-try-b').fill('-10');
    await expect(out).toContainText('逆風');
    await page.getByRole('button', { name: '關閉' }).click();
    // 更多：自建的多空因子（用詞同樣是順風／逆風）
    await page.getByTestId('wind-more-factor').click();
    await expect(page.getByTestId('attr-trend-rows').locator('.br-row')).toHaveCount(5);
    await expect(page.getByTestId('attr-trend-rows')).toContainText(/順風|逆風/);
    await page.getByTestId('attr-trend-hml').click();
    await expect(page.getByTestId('attr-factor-chart').locator('.ui-sec-title')).toHaveText('價值因子');
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買|逆著風|暫定順風/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('② 找股票：從風格（ETF 持股）、從類股、我的名單（3×3 矩陣與名單檢查）、能力圈；舊連結 seg=factor 仍可用', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('#/mine?seg=watch');
    await page.getByRole('button', { name: '加入自選股' }).first().click();
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
    await page.getByRole('option', { name: /2330/ }).click();
    await page.getByRole('button', { name: '關閉' }).click();
    await page.goto('#/explore/attribution?seg=factor');
    await expect(page.getByTestId('wind-styles')).toBeVisible();

    // 從風格：品質（00938）的持股；依類股的狀態分堆；標示「依規則產生，非推薦」
    await page.goto('#/explore/attribution?seg=pick&src=style&k=quality');
    await expect(page.getByTestId('pick-note')).toContainText('依規則產生，非推薦');
    await expect(page.getByTestId('pick-style-quality')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pick-style-quality')).toContainText('順風');
    await expect(page.getByTestId('pick-concl')).toContainText('檔');
    const row = page.getByTestId('pick-row-2330');
    await expect(row).toContainText('台積電');
    await expect(row).toContainText('半導體 順風');
    await expect(row).toHaveAttribute('href', '#/stock/2330');
    // 換一種風格（網址跟著換）
    await page.getByTestId('pick-style-value').click();
    await expect(page).toHaveURL(/k=value/);
    await expect(page.getByTestId('pick-row-1101')).toBeVisible();

    // 從類股：選一個類股 → 同產業的公司，依風格的狀態分堆
    await page.getByTestId('pick-src').getByRole('button', { name: '從類股' }).click();
    await expect(page.getByTestId('pick-sector')).toBeVisible();
    await page.getByTestId('pick-sector-pick').click();
    await page.getByTestId('pick-sector-金融保險').click();
    await expect(page).toHaveURL(/src=sector&k=%E9%87%91%E8%9E%8D%E4%BF%9D%E9%9A%AA/);
    await expect(page.getByTestId('pick-sector-pick')).toContainText('金融保險');
    await expect(page.getByTestId('pick-row-2882')).toBeVisible();

    // 我的名單：每一檔的兩個狀態、3×3 矩陣、名單檢查
    await page.getByTestId('pick-src').getByRole('button', { name: '我的名單' }).click();
    const list = page.getByTestId('pick-list');
    await expect(list).toContainText('台積電');
    await expect(page.getByTestId('pick-matrix').locator('.wm-cell')).toHaveCount(9);
    await expect(page.getByTestId('pick-check').locator('.ui-row')).toHaveCount(3);
    await expect(page.getByTestId('pick-check-size')).toContainText('偏少'); // 只有 1 檔
    await expect(page.getByTestId('pick-row-2330')).toContainText('半導體 順風');
    // 點矩陣的一格只看那一格；再點一次取消
    const cell = page.getByTestId('pick-matrix').locator('.wm-cell:not(.zero)').first();
    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/cell=/);
    await expect(page.getByTestId('pick-group-cell')).toContainText('台積電');
    await cell.click();
    await expect(page).not.toHaveURL(/cell=/);

    // 能力圈：熟悉／不碰的類股（存在裝置上）；一個類股只會在其中一邊
    await page.getByTestId('pick-circle').click();
    await page.getByTestId('circle-know-半導體').click();
    await page.getByTestId('circle-skip-金融保險').click();
    await expect(page.getByTestId('circle-know-半導體')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('circle-skip-半導體').click();
    await expect(page.getByTestId('circle-know-半導體')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('circle-know-半導體').click();
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByTestId('pick-circle')).toContainText('熟悉 1・不碰 1');
    await expect(page.getByTestId('pick-row-2330')).toContainText('熟悉');
    await page.reload();
    await expect(page.getByTestId('pick-circle')).toContainText('熟悉 1・不碰 1'); // 存在 IndexedDB
    // 不碰的類股不出現在「從風格」的清單
    await page.goto('#/explore/attribution?seg=pick&src=style&k=value');
    await expect(page.getByTestId('pick-style')).toContainText('不碰的類股');
    await expect(page.locator('body')).not.toContainText(/買進|賣出|推薦買/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
