import { expect, test, type Page } from '@playwright/test';
import { gotoStock } from './helpers';

// 個股籌碼：區間統計卡、每日籌碼（預設展開、一排控制列、三種檢視、不需左右滑動、底部面板、收合偏好、卡片版面、⋯ 選單）、法人柱狀圖。

test('區間統計：天數切換後結論與數字跟著變，且只用規則式的中性字眼', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  const card = page.getByLabel('籌碼區間統計');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const sentence = card.getByTestId('chip-sentence');
  await expect(sentence).toHaveText(/^近 5 日/);
  await card.getByRole('group', { name: '統計天數' }).getByRole('button', { name: '20 日' }).click();
  await expect(sentence).toHaveText(/^近 20 日/);
  await card.getByRole('group', { name: '統計天數' }).getByRole('button', { name: '1 日' }).click();
  await expect(sentence).toHaveText(/^最近一個交易日/);
  await expect(sentence).not.toHaveText(/買進|賣出|建議/);
  for (const label of ['買賣超（張）', '金額（億元・估）', '佔區間成交量（%）', '佔股本（%）', '估計成本（元・估）', '現價相對成本（%）']) {
    await expect(card.getByRole('rowheader', { name: label })).toBeVisible();
  }
});

// ---------------------------------------------------------------- 每日籌碼（HIG 改版）
const daily = (page: Page) => page.locator('section.chip-daily');
const table = (page: Page) => daily(page).locator('.cd-wrap, .cd-cards').first();

for (const width of [375, 393]) {
  test(`每日籌碼：${width}pt 寬度預設展開、表格不需要左右滑動（三種檢視、三種單位、四種期間）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await gotoStock(page, '#/stock/2330');
    const toggle = daily(page).getByRole('button', { name: '每日籌碼' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(table(page)).toHaveAttribute('data-mode', 'table');
    const noScroll = async () => {
      const d = await table(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(d.sw).toBeLessThanOrEqual(d.cw);
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(doc.sw).toBeLessThanOrEqual(doc.cw);
      // 上方的區間統計卡也不需要左右滑動
      const stats = await page.locator('.chip-stats-card .scroll-x').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(stats.sw).toBeLessThanOrEqual(stats.cw);
    };
    for (const view of ['法人', '信用', '借券當沖']) {
      await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: view }).click();
      for (const unit of ['lots', 'amount', 'pct']) {
        await page.getByRole('combobox', { name: '單位' }).selectOption(unit);
        for (const n of ['5 日', '60 日']) {
          await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: n }).click();
          await expect(table(page)).toHaveAttribute('data-mode', 'table');
          await noScroll();
        }
      }
    }
  });
}

test('每日籌碼：一排控制列；法人檢視固定 4 欄＋日期，收盤與漲跌在日期下方；區間合計在最上方、連買天數在標題下方', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoStock(page, '#/stock/2330');
  const periods = page.getByRole('group', { name: '明細期間' });
  const unit = page.getByRole('combobox', { name: '單位' });
  const pb = (await periods.boundingBox())!;
  const ub = (await daily(page).locator('.cd-unit').boundingBox())!;
  expect(Math.abs(pb.y + pb.height / 2 - (ub.y + ub.height / 2))).toBeLessThan(2); // 同一排
  expect(ub.x).toBeGreaterThan(pb.x + pb.width - 1); // 單位在右
  await expect(unit.locator('option')).toHaveText(['張', '金額（億元，估）', '佔成交量 %']);
  const views = page.getByRole('group', { name: '檢視' }).getByRole('button');
  await expect(views).toHaveText(['法人', '信用', '借券當沖']);
  await expect(views.first()).toHaveAttribute('aria-pressed', 'true');

  const region = page.getByRole('region', { name: '每日籌碼明細・法人' });
  const heads = region.locator('thead th');
  await expect(heads).toHaveCount(5);
  await expect(heads.nth(1)).toContainText('外資');
  await expect(heads.nth(1).locator('.cd-sub')).toHaveText(/^(連[買賣] \d+\+? 日|—)$/);
  await expect(region.locator('tbody tr').first()).toContainText('區間合計');
  await expect(region.locator('tbody tr.day')).toHaveCount(10);
  await expect(region.getByText('目前連續')).toHaveCount(0);
  await expect(region.locator('tbody tr.day').first().locator('th .cd-sub')).toHaveText(/^[\d,.]+ [▲▼－][\d.]+%$/);
  await expect(daily(page).locator('.cd-unit-label')).toHaveText('單位：張');
  // 欄位標題不重複單位
  await expect(heads.nth(1).locator('.cd-h')).not.toContainText('張');
  // 日期不是藍色底線連結
  const dateStyle = await region.locator('tbody tr.day').first().locator('.cd-date').evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(dateStyle).toBe('none');

  await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: '信用' }).click();
  await expect(page.getByRole('region', { name: '每日籌碼明細・信用' }).locator('thead th .cd-h')).toHaveText(['融資增減', '融券增減', /^融資餘額(萬張)?$/, '券資比']);
  await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: '借券當沖' }).click();
  await expect(page.getByRole('region', { name: '每日籌碼明細・借券當沖' }).locator('thead th .cd-h')).toHaveText([/^借券賣出(萬張)?$/, /^借券賣出餘額(萬張)?$/, '當沖比率', /^當沖量(萬張)?$/]);

  await unit.selectOption('amount');
  await expect(daily(page).locator('.cd-unit-label')).toHaveText('單位：億元（估）');
  await unit.selectOption('pct');
  await expect(daily(page).locator('.cd-unit-label')).toHaveText('單位：佔成交量 %');
  await expect(page.getByRole('region', { name: '每日籌碼明細・借券當沖' }).locator('thead th').nth(2).locator('.cd-sub')).toHaveText('張'); // 餘額沒有佔量的意義
});

test('每日籌碼：數字 ≥ 10,000 縮寫為「萬」；正負同時用紅綠與 ▲▼；每列至少 44pt；VoiceOver 唸完整句子', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 852 });
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '60 日' }).click();
  const region = page.getByRole('region', { name: /每日籌碼明細/ });
  const texts = await region.locator('tbody td .cd-t').allInnerTexts();
  for (const t of texts) expect(t).toMatch(/^(—|[▲▼]?[\d,.]+(\u00a0萬)?%?)$/);
  for (const t of texts) expect(t.replace(/[▲▼,%]/g, '').split('.')[0].length).toBeLessThanOrEqual(4); // 不超過 4 位數（≥ 10,000 已縮寫）
  const cell = region.locator('tbody tr.day td.cd-v.up, tbody tr.day td.cd-v.down').first();
  const [cls, txt] = await cell.evaluate((el) => [el.className, el.textContent]);
  expect(txt).toMatch(cls.includes('up') ? /▲/ : /▼/);
  const h = await region.locator('tbody tr.day').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  const btn = region.locator('tbody tr.day').first().getByRole('button');
  await expect(btn).toHaveAttribute('aria-label', /^\d+ 月 \d+ 日，外資(買超|賣超|持平)( [\d,.]+( 萬)? 張)?，投信.+，自營商（自行買賣）.+，三大法人合計.+；收盤 [\d,.]+ 元/);
});

test('每日籌碼：點一列從底部拉出當天完整資料（含自營商避險、成交量、官方來源、複製這天資料）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('region', { name: /每日籌碼明細/ }).locator('tbody tr.day').first().click();
  const sheet = page.getByRole('dialog', { name: /月 \d+ 日（.）籌碼/ });
  await expect(sheet).toBeVisible();
  for (const label of ['收盤', '漲跌', '成交量', '外資', '投信', '自營商（自行買賣）', '自營商（避險）', '三大法人合計', '融資增減', '融券增減', '借券賣出', '當沖比率']) {
    await expect(sheet.locator('dt', { hasText: new RegExp(`^${label.replace(/[（）]/g, '.')}`) }).first()).toBeVisible();
  }
  const link = sheet.getByRole('link', { name: '證交所・三大法人買賣超' });
  await expect(link).toHaveAttribute('href', /twse\.com\.tw\/rwd\/zh\/fund\/T86\?date=\d{8}&selectType=ALLBUT0999&response=html/);
  await expect(link).toHaveAttribute('target', '_blank');
  await sheet.getByRole('button', { name: '複製這天資料' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^台積電 2330 \d{4}-\d{2}-\d{2}\n收盤\t/);
  expect(text).toContain('自營商（避險）(張)\t');
});

test('每日籌碼：收合後記住偏好（IndexedDB）', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  const toggle = daily(page).getByRole('button', { name: '每日籌碼' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#chip-daily-body')).toHaveCount(0);
  await page.reload();
  await expect(daily(page).getByRole('button', { name: '每日籌碼' })).toHaveAttribute('aria-expanded', 'false');
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const g = r.result.transaction('settings').objectStore('settings').get('chipDailyOpen'); g.onsuccess = () => res(g.result?.value); };
  }));
  expect(stored).toBe(false);
  await daily(page).getByRole('button', { name: '每日籌碼' }).click();
  await page.reload();
  await expect(daily(page).getByRole('button', { name: '每日籌碼' })).toHaveAttribute('aria-expanded', 'true');
});

test('每日籌碼：放大字級（約 Dynamic Type +2）時寬度不夠自動改為卡片（2×2）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 852 });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '125%'; }));
  await gotoStock(page, '#/stock/2330');
  const cards = daily(page).locator('.cd-cards');
  await expect(cards).toHaveAttribute('data-mode', 'cards');
  const first = cards.locator('li.cd-card.day').first();
  await expect(first.locator('.cd-cell')).toHaveCount(4);
  const boxes = await first.locator('.cd-cell').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  expect(new Set(boxes.map((b) => b[0])).size).toBe(2); // 兩欄
  expect(new Set(boxes.map((b) => b[1])).size).toBe(2); // 兩列
  const d = await cards.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(d.sw).toBeLessThanOrEqual(d.cw);
  await expect(first.getByRole('button')).toHaveAttribute('aria-label', /^\d+ 月 \d+ 日，外資/);
  await first.click();
  await expect(page.getByRole('dialog', { name: /籌碼/ })).toBeVisible();
});

test('每日籌碼：橫向寬度同時顯示全部欄位，不需要切換檢視', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await gotoStock(page, '#/stock/2330');
  const region = page.getByRole('region', { name: '每日籌碼明細・全部欄位' });
  await expect(region).toHaveAttribute('data-mode', 'all');
  await expect(page.getByRole('group', { name: '檢視' })).toHaveCount(0);
  await expect(region.locator('thead tr:last-child th')).toHaveCount(13);
  await expect(region.locator('thead th[scope="colgroup"]')).toHaveText(['法人', '信用', '借券當沖']);
  const d = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(d.sw).toBeLessThanOrEqual(d.cw);
  expect(d.right).toBeLessThanOrEqual(852);
});

test('每日籌碼：「⋯」選單的複製為 CSV（標題帶單位、含區間合計）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoStock(page, '#/stock/2330');
  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '5 日' }).click();
  await daily(page).getByRole('button', { name: '更多動作' }).click();
  await page.getByRole('menuitem', { name: '複製為 CSV' }).click();
  await expect(daily(page).locator('.cd-status')).toHaveText(/已複製 CSV（5 日，單位：張）/);
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  const lines = csv.trim().split('\n');
  expect(lines[0]).toContain('2330');
  expect(lines[1]).toBe('日期,收盤,漲跌(%),外資(張),投信(張),自營商（自行買賣）(張),自營商（避險）(張),三大法人合計(張),融資增減(張),融券增減(張),借券賣出(張),當沖比率(%)');
  expect(lines[2]).toMatch(/^區間合計\(5日\),/);
  expect(lines).toHaveLength(8); // 說明、標題、合計、5 日
});

test('單位名稱沒有「估成交量」錯字（全站）', async ({ page }) => {
  for (const hash of ['#/stock/2330', '#/me/methodology']) {
    await page.goto(hash);
    await expect(page.locator('body')).not.toContainText('估成交量');
  }
});

test('法人柱狀圖：座標軸帶單位（張），拖曳或 hover 時顯示日期、數值與單位；圖例說明紅綠', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  const fig = page.locator('figure.netbars').first();
  await expect(fig).toBeVisible({ timeout: 15_000 });
  await expect(fig.locator('.nb-axes')).toContainText(/張/);
  await expect(fig).toContainText('紅色＝淨買超');
  await expect(fig).toContainText('綠色＝淨賣超');
  const bars = fig.locator('.nb-bars');
  await bars.scrollIntoViewIfNeeded();
  const box = (await bars.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  const tip = fig.locator('.nb-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/\d{4}-\d{2}-\d{2}/);
  await expect(tip).toContainText(/(淨買超|淨賣超) [\d,.]+ (萬張|張)|無資料|^.*0 張/);
  await bars.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tip).toBeVisible();
});

test('明確不做的分點資料在明細下方說明原因', async ({ page }) => {
  await gotoStock(page, '#/stock/2330');
  await expect(page.getByText(/分點券商前 15 名、主力動向與籌碼集中度需要分點進出資料，官方查詢頁有驗證碼/)).toBeVisible();
  await expect(page.getByText(/八大行庫/)).toHaveCount(0);
});
