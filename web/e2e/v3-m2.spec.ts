import { expect, test } from '@playwright/test';

// v3 M2（docs/V3_NOTES.md）：每日籌碼表（Apple HIG）、信用與空方拆分、籌碼結構。

test.use({ viewport: { width: 393, height: 852 } });

test.describe('M2-1 每日籌碼表', () => {
  test('沒有每格比例條，表格上方有法人買賣超柱狀圖；同一欄同一種格式；列高約 52pt；區間合計有底色', async ({ page }) => {
    await page.goto('#/stock/2330');
    const daily = page.locator('section.chip-daily');
    await daily.scrollIntoViewIfNeeded();
    const table = daily.locator('.cd-table');
    await expect(table).toBeVisible();
    await expect(daily.locator('.cd-bar')).toHaveCount(0);
    await expect(daily.getByRole('img', { name: /^三大法人近 \d+ 日每日買賣超柱狀圖/ })).toBeVisible();

    // 每欄：全部是「萬張 1 位小數」或全部是整數（—、0 除外）
    const cols = await table.evaluate((t) => {
      const rows = [...t.querySelectorAll('tbody tr')];
      const n = rows[0].querySelectorAll('td').length;
      return Array.from({ length: n }, (_, i) => rows.map((r) => r.querySelectorAll('td')[i].querySelector('.cd-t')?.textContent ?? ''));
    });
    for (const col of cols) {
      const nums = col.map((t) => t.replace(/[▲▼%]/g, '')).filter((t) => t !== '—' && t !== '0');
      const decimals = new Set(nums.map((t) => (t.includes('.') ? t.split('.')[1].length : 0)));
      expect(decimals.size, col.join(' | ')).toBeLessThanOrEqual(1);
    }
    // 數字靠右、等寬數字；▲▼ 縮小
    const style = await table.locator('tbody tr.day td.cd-v').first().evaluate((el) => ({ align: getComputedStyle(el).textAlign, num: getComputedStyle(el).fontVariantNumeric }));
    expect(style.align).toBe('right');
    expect(style.num).toContain('tabular-nums');
    const arrow = table.locator('.cd-arrow').first();
    if (await arrow.count()) {
      const [a, v] = await arrow.evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el.closest('td')!).fontSize)]);
      expect(a).toBeLessThan(v);
    }
    // 列高約 52pt；日期 15pt、日期下方 12pt
    const row = table.locator('tbody tr.day').first();
    const h = (await row.boundingBox())!.height;
    expect(h).toBeGreaterThanOrEqual(50);
    expect(h).toBeLessThanOrEqual(56);
    expect(await row.locator('.cd-date').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px');
    expect(await row.locator('.cd-sub').evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px');
    const totalBg = await table.locator('tr.total td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const dayBg = await row.locator('td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(totalBg).not.toBe(dayBg);
    // 連續天數仍在欄位標題下方
    await expect(table.locator('thead th').nth(1).locator('.cd-sub')).toHaveText(/連(買|賣)|—/);
  });
});

test.describe('M2-2 信用與空方', () => {
  test('散戶信用與空方分成兩張卡；每個數字標明比較基準；價量解讀四種之一或說明不套用', async ({ page }) => {
    await page.goto('#/stock/2330');
    const block = page.getByRole('region', { name: '信用與空方：散戶與空方在做什麼？' });
    await block.scrollIntoViewIfNeeded();
    await expect(block.getByRole('heading', { name: '散戶信用（融資）' })).toBeVisible();
    await expect(block.getByRole('heading', { name: '空方（融券與借券）' })).toBeVisible();
    await expect(block.getByTestId('margin-d5')).toContainText(/與 5 個交易日前（\d+\/\d+）相比/);
    await expect(block.getByText(/與 20 個交易日前/)).toBeVisible();
    await expect(block.getByTestId('margin-usage')).toContainText(/融資餘額 ÷ 融資限額|融資限額/);
    await expect(block.getByTestId('pv-label')).toContainText(/價漲資增|價漲資減|價跌資增|價跌資減|不套用標籤/);
    await expect(block.getByTestId('short-ratio')).toContainText('融券餘額 ÷ 融資餘額');
    await expect(block.getByText('融券最後回補日')).toBeVisible();
    await expect(block).not.toContainText(/買進|建議|(?<!借券)賣出/);
    // 外資持股移到法人區塊
    await expect(block.getByTestId('foreign-hold')).toHaveCount(0);
    const inst = page.getByRole('region', { name: '法人在買還是賣？' });
    await expect(inst.getByTestId('foreign-hold')).toContainText(/外資持股比.*與 20 個交易日前（\d+\/\d+）相比/);
    await expect(inst.getByTestId('foreign-hold')).toContainText('個百分點');
  });

  test('券資比 ≥ 30% 時說明軋空風險', async ({ page }) => {
    await page.route('**/data/stocks/2330.json', async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      const n = j.sb.length;
      j.sb[n - 1] = Math.round((j.mb[n - 1] ?? 1000) * 0.35);
      await route.fulfill({ response: res, json: j });
    });
    await page.goto('#/stock/2330');
    await expect(page.getByTestId('squeeze-note')).toContainText('軋空');
  });
});

test.describe('M2-3 籌碼結構', () => {
  test('一句話結論、四段堆疊比例條與週變化、分級定義；查看趨勢在底部面板（比例／人數／人均張數）', async ({ page }) => {
    await page.goto('#/stock/2330');
    const block = page.getByRole('region', { name: '籌碼結構：大戶在增加還是減少？' });
    await block.scrollIntoViewIfNeeded();
    await expect(block.getByRole('heading', { level: 2 })).toHaveText(/^千張大戶本週 (\+|−)[\d.]+ 個百分點|^千張大戶本週持平/);
    const bar = block.getByTestId('structure-bar');
    await expect(bar.locator('.st-seg')).toHaveCount(4);
    for (const t of ['散戶', '中實戶', '大戶', '千張大戶']) await expect(bar.locator('dt', { hasText: new RegExp(`^${t}`) }).first()).toBeVisible();
    await expect(block).toContainText('散戶 ≤ 5 張｜中實戶 5–400 張｜大戶 ≥ 400 張（含千張大戶）｜千張大戶 ≥ 1,000 張');
    await block.getByRole('button', { name: /查看趨勢/ }).click();
    const sheet = page.getByRole('dialog', { name: '籌碼結構趨勢' });
    await expect(sheet).toBeVisible();
    for (const m of ['持股比例', '人數', '人均張數']) await expect(sheet.getByRole('group', { name: '指標' }).getByRole('button', { name: m })).toBeVisible();
    await sheet.getByRole('group', { name: '指標' }).getByRole('button', { name: '人數' }).click();
    await expect(sheet.locator('.sc-title', { hasText: '千張大戶（≥ 1,000 張）人數（人）' })).toHaveCount(1);
  });

  test('全站沒有「超過 100 張」等不一致的大戶定義', async ({ page }) => {
    for (const hash of ['#/stock/2330', '#/stock/2330/holders']) {
      await page.goto(hash);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(300);
      await expect(page.getByText(/超過 100 張|百張大戶|10 張以下/)).toHaveCount(0);
    }
  });
});
