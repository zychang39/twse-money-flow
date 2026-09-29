import { expect, test } from '@playwright/test';
import { gotoStock } from './helpers';

// 第三輪修正（docs/design/ROUND3.md）：M1 新版本提示、M2 法人買賣超報表、M3 大戶／散戶門檻、M4 多空對照、M5 參考連結。

test.use({ viewport: { width: 393, height: 852 } });

// M1 新版本提示：更新流程改版（可用性測試第 2 輪 #1），測試移到 e2e/sw-update.spec.ts。

// ---------------------------------------------------------------- M2 法人買賣超報表
const noHScroll = async (page: import('@playwright/test').Page) => {
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  for (const sel of ['.ir-wrap', '.ir-card']) {
    const els = page.locator(sel);
    for (let i = 0; i < (await els.count()); i++) {
      const d = await els.nth(i).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(d.sw, sel).toBeLessThanOrEqual(d.cw);
    }
  }
  // 儲存格是 overflow: hidden，另外確認沒有數字被裁掉
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.ir-table th, .ir-table td, .ir-table .cd-sub, .ir-sum th, .ir-sum td')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(clipped).toEqual([]);
};

test('M2：個股頁有入口；報表一次列出四個法人的區間合計，Tab 切換走勢圖與逐日明細', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('link', { name: /法人買賣超報表/ }).click();
  await expect(page).toHaveURL(/#\/stock\/2330\/institutional$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^外資近\s60\s日(買超|賣超|買賣超持平)/);
  const sum = page.locator('table.ir-sum').first();
  await expect(sum.getByRole('row')).toHaveCount(5);
  for (const name of ['外資', '投信', '自營商', '三大法人']) await expect(sum.getByRole('button', { name: new RegExp(`^${name}：`) })).toBeVisible();
  await expect(page.getByTestId('ir-sentence')).not.toHaveText(/買進|賣出|建議/);
  // 走勢圖：收盤價、買張與賣張、每日買賣超、累計買賣超
  const chart = page.getByRole('img', { name: /外資買賣超走勢/ });
  await expect(chart).toBeVisible();
  for (const t of ['收盤價（元）', '買張與賣張（張）', '每日買賣超（張）', '累計買賣超（張）']) await expect(page.locator('.sc-title', { hasText: t })).toHaveCount(1);
  // 明細：區間合計＋60 日
  await expect(page.locator('.ir-table tbody tr')).toHaveCount(61);
  // 切到投信：標題、圖、明細一起換
  await page.getByRole('group', { name: '法人' }).getByRole('button', { name: '投信' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^投信近\s60\s日/);
  await expect(page.getByRole('img', { name: /投信買賣超走勢/ })).toBeVisible();
  // 點區間合計的一列也能切換
  await sum.getByRole('button', { name: /^自營商：/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^自營商近\s60\s日/);
  // 期間 1 個月＝20 日
  await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '1 個月' }).click();
  await expect(page.locator('.ir-table tbody tr')).toHaveCount(21);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^自營商近\s20\s日/);
});

for (const width of [375, 393]) {
  test(`M2：${width}pt 寬度所有 Tab 與期間都不需要左右滑動`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('#/stock/2330/institutional');
    await expect(page.locator('.ir-table')).toBeVisible();
    for (const tab of ['外資', '投信', '自營商', '三大法人']) {
      await page.getByRole('group', { name: '法人' }).getByRole('button', { name: tab }).click();
      for (const m of ['1 個月', '3 個月']) {
        await page.getByRole('group', { name: '期間' }).getByRole('button', { name: m }).click();
        await expect(page.locator('.ir-wrap')).toHaveAttribute('data-fits', /all|compact/);
        await noHScroll(page);
      }
    }
  });
}

test('v3：八大行庫分頁已移除，分段控制只有外資、投信、自營商、三大法人', async ({ page }) => {
  await page.goto('#/stock/2330/institutional');
  await expect(page.getByRole('group', { name: '法人' }).getByRole('button').first()).toBeVisible();
  const names = await page.getByRole('group', { name: '法人' }).getByRole('button').allTextContents();
  expect(names).toEqual(['外資', '投信', '自營商', '三大法人']);
  await expect(page.getByText(/八大行庫/)).toHaveCount(0);
});

test('M2：點一列打開當天完整籌碼（含四個法人的買張、賣張）；⋯ 複製四個法人的 CSV；圖可用方向鍵逐日查看', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('#/stock/2330/institutional');
  await page.locator('.ir-table tbody tr.day').first().getByRole('button').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('region', { name: '各法人買張與賣張' }).getByRole('row')).toHaveCount(5);
  await sheet.getByRole('button', { name: /關閉|完成/ }).first().click();
  await page.getByRole('button', { name: '更多動作' }).click();
  await page.getByRole('menuitem', { name: /複製為 CSV/ }).click();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv.split('\n')[1]).toContain('外資買張,外資賣張,外資買賣超,投信買張');
  const chart = page.getByRole('img', { name: /外資買賣超走勢/ });
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sc-tip')).toBeVisible();
  await expect(page.locator('.sc-tip')).toContainText('買賣超');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-tip')).toHaveCount(0);
});

// ---------------------------------------------------------------- M3 籌碼結構（v3：全站統一分級，移除可調門檻）
test('M3（v3）：個股頁有「15 級完整分布」入口；分級定義固定並顯示在畫面上；沒有可調門檻', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('link', { name: /15 級完整分布/ }).click();
  await expect(page).toHaveURL(/#\/stock\/2330\/holders$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^千張大戶本週/);
  await expect(page.getByTestId('hd-definition')).toHaveText('分級：散戶 ≤ 5 張｜中實戶 5–400 張｜大戶 ≥ 400 張（含千張大戶）｜千張大戶 ≥ 1,000 張。');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByText(/超過 100 張/)).toHaveCount(0);
  await expect(page.locator('.sc-title', { hasText: '千張大戶（≥ 1,000 張）持股比例（%）' })).toHaveCount(1);
  await expect(page.locator('.sc-title', { hasText: '大戶（≥ 400 張，含千張）持股比例（%）' })).toHaveCount(1);
  await expect(page.locator('.sc-title', { hasText: '散戶（≤ 5 張）持股比例（%）' })).toHaveCount(1);
});

test('M3（v3）：指標與期間切換走勢圖；15 級分布分成四段', async ({ page }) => {
  await page.goto('#/stock/2330/holders');
  await page.getByRole('group', { name: '指標' }).getByRole('button', { name: '人數' }).click();
  await expect(page.locator('.sc-title', { hasText: '千張大戶（≥ 1,000 張）人數（人）' })).toHaveCount(1);
  await page.getByRole('group', { name: '指標' }).getByRole('button', { name: '人均張數' }).click();
  await expect(page.locator('.sc-title', { hasText: '散戶（≤ 5 張）人均張數（張）' })).toHaveCount(1);
  await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '3 個月' }).click();
  await expect(page.getByRole('heading', { name: '走勢・3 個月' })).toBeVisible();
  const sections = page.locator('.hd-table tbody');
  await expect(sections).toHaveCount(4);
  await expect(sections.nth(0).getByRole('row')).toHaveCount(1 + 2); // 散戶：不到 1、1–5 張
  await expect(sections.nth(1).getByRole('row')).toHaveCount(1 + 9); // 中實戶：分級 3–11
  await expect(sections.nth(2).getByRole('row')).toHaveCount(1 + 3); // 大戶段：400–600、600–800、800–1000
  await expect(sections.nth(3).getByRole('row')).toHaveCount(1 + 1); // 千張大戶：超過 1000
  await expect(page.getByTestId('hd-basis')).toContainText(/與\s1[23]\s週前（\d{2}\/\d{2}）相比/);
});

for (const width of [375, 393]) {
  test(`M3：${width}pt 寬度不需要左右滑動，數字沒有被裁切`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('#/stock/2330/holders');
    await expect(page.locator('.hd-table')).toBeVisible();
    for (const m of ['持股比例', '人數', '人均張數']) {
      await page.getByRole('group', { name: '指標' }).getByRole('button', { name: m }).click();
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(doc.sw).toBeLessThanOrEqual(doc.cw);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.hd-table th, .hd-table td, .hd-groups dd span, .hd-groups dt')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(clipped).toEqual([]);
    }
  });
}

// ---------------------------------------------------------------- M4 多空對照
test('M4：個股頁的多空區塊有比例條與入口；多空對照並排列出四個面向的多方與空方', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  // v3：多空比例條併入「整體狀態如何？」區塊
  const block = page.getByRole('region', { name: /^整體狀態如何？/ });
  await expect(block.getByRole('region', { name: '多空' })).toContainText(/多空條件：多方 \d+ 項、空方 \d+ 項/);
  await expect(block.getByRole('img', { name: /^多方 \d+ 項、中性 \d+ 項、空方 \d+ 項$/ })).toBeVisible();
  await block.getByRole('link', { name: /多空對照/ }).click();
  await expect(page).toHaveURL(/#\/stock\/2330\/bullbear$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^多方\s\d+\s項、空方\s\d+\s項$/);
  const cards = page.locator('.bb-card');
  await expect(cards).toHaveCount(4);
  for (const [i, name] of ['基本面', '籌碼面', '量價面', '技術面'].entries()) {
    await expect(cards.nth(i).getByRole('heading', { level: 2 })).toHaveText(name);
    await expect(cards.nth(i).getByRole('group', { name: `${name}多方` })).toBeVisible();
    await expect(cards.nth(i).getByRole('group', { name: `${name}空方` })).toBeVisible();
  }
  // 篩選單一面向
  await page.getByRole('group', { name: '面向' }).getByRole('button', { name: '技術面' }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading', { level: 2 })).toHaveText('技術面');
  // 中性字眼
  await expect(page.locator('main')).not.toContainText(/買進|賣出|建議買|建議賣/);
});

for (const width of [375, 393]) {
  test(`M4：${width}pt 寬度多方與空方兩欄並排，不需要左右滑動`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('#/stock/2330/bullbear');
    const cols = page.locator('.bb-card').first().locator('.bb-col');
    const a = (await cols.nth(0).boundingBox())!;
    const b = (await cols.nth(1).boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  });
}

// ---------------------------------------------------------------- M5 研究參考
test('M5：個股頁列出近一年法說會（含主辦／邀請券商）與研究參考連結；第三方連結清楚標示', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  // v3：研究參考併入「最近有什麼事件？」區塊
  const block = page.getByRole('region', { name: '最近有什麼事件？' });
  await expect(block.getByRole('heading', { level: 2 })).toHaveText(/^近一年 \d+ 筆事件、\d+ 場法說會$/);
  await expect(block).toContainText('主辦／邀請券商：BofA、元大證券');
  await expect(block.locator('.rs-item')).toHaveCount(4);
  const official = block.getByRole('link', { name: /公開資訊觀測站・法人說明會一覽表/ });
  await expect(official).toHaveAttribute('href', 'https://mopsov.twse.com.tw/mops/web/t100sb02_1');
  for (const name of [/新聞搜尋/, /鉅亨網/, /Yahoo 股市/]) {
    const link = block.getByRole('link', { name });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toContainText('第三方');
  }
  await expect(block).toContainText('券商研究報告多為付費或只提供給客戶');
});
