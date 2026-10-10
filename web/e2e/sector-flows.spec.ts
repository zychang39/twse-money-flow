import { expect, test } from '@playwright/test';

// 2026-10-10：族群輪動 › 大戶流向（持股市值 ≥ 5,000 萬的集保戶每週淨增減，億元）。手機一頁看完、不用往下滑；放不下的切分頁或收進「全部」。

test.use({ viewport: { width: 393, height: 852 } });

test('大戶流向：分頁切換、一頁看完（清單與「全部」按鈕都在底部切換列上方）、流入／流出分頁', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('#/explore/sectors');
  await page.getByTestId('sectors-view').getByRole('button', { name: '大戶流向' }).click();
  await expect(page).toHaveURL(/view=flow/);
  const sec = page.getByTestId('flow-sec');
  await expect(sec).toBeVisible();
  await expect(sec.locator('.ui-sec-aside')).toContainText(/集保 \d+\/\d+ → \d+\/\d+/);
  const rows = page.getByTestId('flow-list').getByTestId('flow-row');
  await expect(rows.first()).toBeVisible();
  // 流入分頁：數值都是正的（紅）；每列橫條軌道一樣長（數值欄固定寬）
  const values = await rows.locator('.fl-v').allTextContents();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) expect(v).toMatch(/^\+[\d,.]+ 億$/);
  const widths = await rows.locator('.fl-bar .pbar').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(new Set(widths).size).toBe(1);
  // 一頁看完：最後一列（或「全部」按鈕）在底部切換列上方，不必捲動
  const dockTop = (await page.locator('.tabbar').boundingBox())!.y;
  const more = page.getByTestId('flow-all');
  const lastBox = (await ((await more.count()) ? more : rows.last()).boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(dockTop + 1);
  // 流出分頁
  await page.getByTestId('flow-dir').getByRole('button', { name: /流出/ }).click();
  const outs = await page.getByTestId('flow-list').getByTestId('flow-row').locator('.fl-v').allTextContents();
  for (const v of outs) expect(v).toMatch(/^−[\d,.]+ 億$/);
  // 4 週：比較區間跟著變
  const before = await sec.locator('.ui-sec-aside').textContent();
  await page.getByTestId('flow-period').getByRole('button', { name: '4 週' }).click();
  await expect(sec.locator('.ui-sec-aside')).not.toHaveText(before!);
  expect(errors).toEqual([]);
});

test('大戶流向：點族群開面板（近幾週流向、流入／流出最多的個股），個股連到籌碼結構', async ({ page }) => {
  await page.goto('#/explore/sectors?view=flow&flayer=official');
  const first = page.getByTestId('flow-list').getByTestId('flow-row').first();
  await expect(first).toBeVisible();
  const name = (await first.locator('.fl-name').textContent())!;
  await first.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(name);
  const detail = sheet.getByTestId('flow-detail');
  await expect(detail).toContainText(/大戶 1 週淨(流入|流出|持平)/);
  await expect(detail.getByRole('img', { name: /大戶每週流向/ })).toBeVisible();
  await expect(detail.getByTestId('flow-stock').first()).toHaveAttribute('href', /#\/stock\/\d{4}\/holders/);
  await expect(detail.getByTestId('flow-group-link')).toHaveAttribute('href', /#\/explore\/sectors\/o-/);
});

test('大戶流向：預設仍是報酬名次；切換會記住', async ({ page }) => {
  await page.goto('#/explore/sectors');
  await expect(page.getByTestId('layer-seg')).toBeVisible();
  await expect(page.getByTestId('flow-sec')).toHaveCount(0);
  await page.getByTestId('sectors-view').getByRole('button', { name: '大戶流向' }).click();
  await expect(page.getByTestId('flow-sec')).toBeVisible();
  await page.goto('#/explore');
  await page.goto('#/explore/sectors');
  await expect(page.getByTestId('flow-sec')).toBeVisible();
});
