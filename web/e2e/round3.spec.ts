import { expect, test } from '@playwright/test';

// 第三輪修正（docs/design/ROUND3.md）：M1 新版本提示、M2 法人買賣超報表、M3 大戶／散戶門檻、M4 多空對照、M5 參考連結。

test.use({ viewport: { width: 393, height: 852 } });

// ---------------------------------------------------------------- M1 新版本提示
test('M1：新版本接手後顯示「新版本已就緒」，可重新載入或稍後', async ({ page }) => {
  await page.goto('#/');
  await expect(page.getByText('新版本已就緒')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('app-updated')));
  const toast = page.getByRole('status').filter({ hasText: '新版本已就緒' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: '重新載入' })).toBeVisible();
  // 浮在底部導覽之上，不擋住導覽
  const t = (await toast.boundingBox())!;
  const dock = (await page.locator('.tabbar').boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(dock.y);
  await toast.getByRole('button', { name: '稍後' }).click();
  await expect(toast).toHaveCount(0);
});

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
  await page.goto('#/stock/2330');
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
    for (const tab of ['外資', '投信', '自營商', '三大法人', '八大行庫']) {
      await page.getByRole('group', { name: '法人' }).getByRole('button', { name: tab }).click();
      if (tab === '八大行庫') { await noHScroll(page); continue; }
      for (const m of ['1 個月', '3 個月']) {
        await page.getByRole('group', { name: '期間' }).getByRole('button', { name: m }).click();
        await expect(page.locator('.ir-wrap')).toHaveAttribute('data-fits', /all|compact/);
        await noHScroll(page);
      }
    }
  });
}

test('M2：八大行庫標示資料源待處理，列出預計欄位與可自行查詢的地方', async ({ page }) => {
  await page.goto('#/stock/2330/institutional');
  await page.getByRole('group', { name: '法人' }).getByRole('button', { name: '八大行庫' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('八大行庫：資料源待處理');
  await expect(page.getByText(/需要輸入驗證碼/).first()).toBeVisible();
  for (const col of ['買賣超', '庫存', '持股比率']) await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
  await expect(page.getByRole('link', { name: /證交所・買賣日報表查詢系統/ })).toHaveAttribute('href', 'https://bsr.twse.com.tw/bshtm/');
  await expect(page.getByRole('link', { name: /HiStock/ })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: /HiStock/ })).toContainText('第三方網站');
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

// ---------------------------------------------------------------- M3 大戶與散戶持股
test('M3：個股頁有入口；門檻可用常用組合或滑桿（鍵盤）調整，重新開啟後仍記得', async ({ page }) => {
  await page.goto('#/stock/2330');
  await page.getByRole('link', { name: /大戶與散戶持股/ }).click();
  await expect(page).toHaveURL(/#\/stock\/2330\/holders$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^大戶持股\s[\d.]+%/);
  const groups = page.locator('.hd-groups');
  await expect(groups).toContainText('10 張以下');
  await expect(groups).toContainText('超過 400 張');
  // 常用組合：千張大戶
  await page.getByRole('group', { name: '常用門檻' }).getByRole('button', { name: '千張大戶' }).click();
  await expect(groups).toContainText('超過 1000 張');
  await expect(page.locator('.sc-title', { hasText: '大戶（超過 1000 張）持股比例（%）' })).toHaveCount(1);
  // 滑桿（鍵盤）：大戶門檻往左一格＝800 張；散戶門檻往右一格＝15 張
  const big = page.getByRole('slider', { name: '大戶門檻' });
  await big.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(big).toHaveAttribute('aria-valuetext', '大戶：超過 800 張');
  const small = page.getByRole('slider', { name: '散戶門檻' });
  await small.focus();
  await page.keyboard.press('ArrowRight');
  await expect(small).toHaveAttribute('aria-valuetext', '散戶：15 張以下');
  await expect(page.getByTestId('hd-sentence')).toContainText('超過 800 張');
  await expect(page.getByTestId('hd-sentence')).not.toHaveText(/買進|賣出|建議/);
  // 兩個門檻不會交叉：散戶門檻一路往右，最多停在大戶門檻的前一格
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await expect(small).toHaveAttribute('aria-valuetext', '散戶：600 張以下');
  // 記住設定
  await page.reload();
  await expect(page.getByRole('slider', { name: '大戶門檻' })).toHaveAttribute('aria-valuetext', '大戶：超過 800 張');
  await expect(page.getByRole('slider', { name: '散戶門檻' })).toHaveAttribute('aria-valuetext', '散戶：600 張以下');
});

test('M3：指標與期間切換走勢圖；分級分布依門檻分成散戶／中實戶／大戶', async ({ page }) => {
  await page.goto('#/stock/2330/holders');
  await page.getByRole('group', { name: '常用門檻' }).getByRole('button', { name: '400 張大戶' }).click();
  await page.getByRole('group', { name: '指標' }).getByRole('button', { name: '人數' }).click();
  await expect(page.locator('.sc-title', { hasText: '大戶（超過 400 張）人數（人）' })).toHaveCount(1);
  await page.getByRole('group', { name: '指標' }).getByRole('button', { name: '人均張數' }).click();
  await expect(page.locator('.sc-title', { hasText: '散戶（10 張以下）人均張數（張）' })).toHaveCount(1);
  await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '3 個月' }).click();
  await expect(page.getByRole('heading', { name: /^走勢・\d+ 週$/ })).toHaveText(/走勢・(1[0-3]) 週/);
  const sections = page.locator('.hd-table tbody');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0).getByRole('row')).toHaveCount(1 + 3); // 散戶：不到 1、1–5、5–10 張
  await expect(sections.nth(2).getByRole('row')).toHaveCount(1 + 4); // 大戶：400–600、600–800、800–1000、超過 1000
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
  await page.goto('#/stock/2330');
  const block = page.getByRole('region', { name: '多空' });
  await expect(block.getByRole('heading', { level: 2 })).toHaveText(/^多方 \d+ 項、空方 \d+ 項$/);
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
