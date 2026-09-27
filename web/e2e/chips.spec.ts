import { expect, test } from '@playwright/test';

// 個股籌碼：區間統計卡、每日明細表（展開、單位切換、橫向捲動、點開官方來源、複製 CSV）、法人柱狀圖的單位與提示框。

test('區間統計：天數切換後結論與數字跟著變，且只用規則式的中性字眼', async ({ page }) => {
  await page.goto('#/stock/2330');
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

test('每日明細：預設收合，展開後預設 10 日＋區間合計與連續天數；切換單位時欄位標題跟著變', async ({ page }) => {
  await page.goto('#/stock/2330');
  const toggle = page.getByRole('button', { name: /查看明細/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: /每日籌碼明細/ })).toHaveCount(0);
  await toggle.click();
  const region = page.getByRole('region', { name: /每日籌碼明細/ });
  await expect(region).toBeVisible();
  const rows = region.locator('tbody tr.day');
  await expect(rows).toHaveCount(10);
  await expect(region.locator('tbody tr').first()).toContainText('區間合計');
  await expect(region.locator('tbody tr').last()).toContainText('目前連續');
  await expect(region.getByRole('columnheader', { name: '外資（張）' })).toBeVisible();
  await expect(region.getByRole('columnheader', { name: '自營商（避險）（張）' })).toBeAttached();

  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '20 日' }).click();
  await expect(rows).toHaveCount(20);

  await page.getByRole('group', { name: '單位' }).getByRole('button', { name: '金額' }).click();
  await expect(region.getByRole('columnheader', { name: '外資（億元・估）' })).toBeVisible();
  await page.getByRole('group', { name: '單位' }).getByRole('button', { name: '佔成交量' }).click();
  await expect(region.getByRole('columnheader', { name: '外資（佔量 %）' })).toBeVisible();
  await page.getByRole('group', { name: '單位' }).getByRole('button', { name: '張' }).click();
  // 張數不帶小數、有千分位或為整數
  const cell = rows.first().locator('td').nth(2);
  const shown = (await cell.locator('[aria-hidden="true"]').count()) ? await cell.locator('[aria-hidden="true"]').innerText() : await cell.innerText();
  expect(shown).toMatch(/^(—|[▲▼]?[\d,]+)$/);
});

test('每日明細：手機寬度可橫向捲動，日期欄固定不動；點日期可看到官方資料來源', async ({ page }) => {
  await page.goto('#/stock/2330');
  await page.getByRole('button', { name: /查看明細/ }).click();
  const region = page.getByRole('region', { name: /每日籌碼明細/ });
  const dims = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(dims.sw).toBeGreaterThan(dims.cw);
  // 展開寬表格後整頁不可被撐寬（手機不會被縮小顯示）
  const page_ = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth, iw: innerWidth }));
  expect(page_.docW).toBeLessThanOrEqual(page_.vw);
  expect(page_.iw).toBe(page_.vw);
  const dateCell = region.locator('tbody tr.day').first().locator('th');
  const before = (await dateCell.boundingBox())!;
  const firstNum = region.locator('tbody tr.day').first().locator('td').first();
  const numBefore = (await firstNum.boundingBox())!;
  await region.evaluate((el) => el.scrollTo({ left: 320 }));
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  const after = (await dateCell.boundingBox())!;
  const numAfter = (await firstNum.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(1); // sticky 日期欄
  expect(numAfter.x).toBeLessThan(numBefore.x - 100); // 其他欄位跟著捲動

  const dateBtn = dateCell.getByRole('button');
  await dateBtn.click();
  await expect(dateBtn).toHaveAttribute('aria-expanded', 'true');
  const link = region.getByRole('link', { name: '證交所・三大法人買賣超' });
  await expect(link).toHaveAttribute('href', /twse\.com\.tw\/rwd\/zh\/fund\/T86\?date=\d{8}&selectType=ALLBUT0999&response=html/);
  await expect(link).toHaveAttribute('target', '_blank');
});

test('每日明細：複製為 CSV（標題帶單位、含區間合計）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('#/stock/2330');
  await page.getByRole('button', { name: /查看明細/ }).click();
  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '5 日' }).click();
  await page.getByRole('button', { name: '複製為 CSV' }).click();
  await expect(page.getByRole('button', { name: '已複製 CSV' })).toBeVisible();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  const lines = csv.trim().split('\n');
  expect(lines[0]).toContain('2330');
  expect(lines[1]).toBe('日期,收盤,漲跌(%),外資(張),投信(張),自營商（自行買賣）(張),自營商（避險）(張),三大法人合計(張),融資增減(張),融券增減(張),借券賣出(張),當沖比率(%)');
  expect(lines[2]).toMatch(/^區間合計\(5日\),/);
  expect(lines).toHaveLength(8); // 說明、標題、合計、5 日
  expect(lines[3]).toMatch(/^\d{4}-\d{2}-\d{2},[\d.]+,/);
});

test('法人柱狀圖：座標軸帶單位（張），拖曳或 hover 時顯示日期、數值與單位；圖例說明紅綠', async ({ page }) => {
  await page.goto('#/stock/2330');
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
  await page.goto('#/stock/2330');
  await expect(page.getByText(/八大行庫、分點券商前 15 名、主力動向與籌碼集中度需要分點進出資料，官方查詢頁有驗證碼/)).toBeVisible();
});
