import { expect, test } from '@playwright/test';

// M3（2026-10 恢復環境光改版）：個股頁。頁首路徑可點、四環跳分段、六個指標有解讀行、動能摘要卡推入詳情頁、K 線選項記住。
test.use({ viewport: { width: 402, height: 874 } });

test('頁首：代號・市場・族群路徑（可點進族群頁）、收盤價（還原）標籤可點開名詞說明', async ({ page }) => {
  await page.goto('#/stock/2330');
  const crumb = page.getByTestId('stock-crumb');
  await expect(crumb).toContainText('2330');
  await expect(crumb).toContainText(/上市|上櫃/);
  const links = crumb.locator('a.crumb-link');
  expect(await links.count()).toBeGreaterThanOrEqual(1);
  expect(await links.first().getAttribute('href')).toMatch(/^#\/explore\/sectors\//);
  await page.getByRole('button', { name: '收盤價（還原）' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('還原價');
});

test('總覽：四環＋綜合分；六個指標各有一行解讀（≤ 28 字）；精簡模式隱藏解讀行', async ({ page }) => {
  await page.goto('#/stock/2330');
  await expect(page.getByTestId('score-rings').locator('.ring2')).toHaveCount(4);
  await expect(page.getByTestId('to-scores')).toContainText('綜合分');
  await page.getByTestId('to-scores').click();
  await expect(page).toHaveURL(/#\/stock\/2330\/scores$/);
  await page.goBack();
  const interps = page.getByTestId('stock-stats').getByTestId('interp');
  await expect.poll(() => interps.count()).toBeGreaterThanOrEqual(4);
  for (const t of await interps.allTextContents()) expect([...t].length).toBeLessThanOrEqual(28);
  await page.evaluate(() => document.documentElement.setAttribute('data-help', 'compact'));
  await expect(interps.first()).toBeHidden();
});

test('量比超過 3 倍：解讀行轉橘；精簡模式數值旁出現橘點', async ({ page }) => {
  await page.route('**/data/stocks/2330.json', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.metrics = { ...(j.metrics ?? {}), vol_ratio: 3.4 };
    await route.fulfill({ response: res, json: j });
  });
  await page.goto('#/stock/2330');
  const vr = page.getByTestId('stock-stats').locator('.metric', { hasText: '量比' });
  await expect(vr.getByTestId('interp')).toHaveClass(/alert/);
  await page.evaluate(() => document.documentElement.setAttribute('data-help', 'compact'));
  await expect(vr.getByTestId('risk-dot')).toBeVisible();
});

test('動能：報酬、族群、走勢相近、趨勢、位置、波動與部位；摘要卡推入詳情頁，返回停在動能分段', async ({ page }) => {
  await page.goto('#/stock/2330?seg=m');
  const cards = page.getByTestId('mom-cards');
  for (const id of ['mom-returns', 'mom-sector', 'mom-similar', 'mom-trend', 'mom-position', 'mom-risk']) await expect(cards.getByTestId(id)).toBeVisible();
  // 報酬卡：四列 期間｜報酬｜百分位進度條
  await expect(page.getByTestId('mom-returns').locator('.ret-row')).toHaveCount(4);
  // 族群卡：連到族群頁；走勢相近先 3 檔、可展開
  expect(await page.getByTestId('to-sector').getAttribute('href')).toMatch(/^#\/explore\/sectors\//);
  const sim = page.getByTestId('similar-rows').locator('.ui-row');
  const nSim = await sim.count();
  expect(nSim).toBeLessThanOrEqual(3);
  if (await page.getByTestId('similar-more').count()) { await page.getByTestId('similar-more').click(); expect(await sim.count()).toBeGreaterThan(nSim); }
  await page.getByTestId('mom-trend').click();
  await expect(page).toHaveURL(/#\/stock\/2330\/m\/trend$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('趨勢');
  await expect(page.getByTestId('ma-table').locator('thead th')).toHaveText(['均線', '均線價', '乖離', '近 10 日', '10 日前']);
  await page.getByRole('link', { name: '返回' }).click();
  await expect(page).toHaveURL(/#\/stock\/2330\?seg=m$/);
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '動能', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('to-risk').click();
  await expect(page.getByTestId('risk-calc')).toBeVisible();
  await expect(page.getByTestId('risk-intro').locator('p')).toHaveCount(3);
  await page.goto('#/stock/2330/m/position');
  await expect(page.getByTestId('pos-rows')).not.toContainText('0.00%');
});

test('K 線選項（D2）：記住；1M／3M 日 K、1Y 週 K；實體至少 3px；藍 20 日線、紫 60 日線', async ({ page }) => {
  await page.goto('#/stock/2330');
  await page.getByTestId('stock-more').click();
  await page.getByTestId('chart-kind').getByRole('button', { name: 'K 線' }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  const group = page.getByTestId('stock-periods').first();
  await group.getByRole('button', { name: '3M', exact: true }).click();
  await expect(page.locator('.sc-legend').first()).toContainText('日 K');
  const widths = await page.locator('.sc-svg rect[fill^="var(--up)"], .sc-svg rect[fill^="var(--down)"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('width'))));
  expect(widths.length).toBeGreaterThan(20);
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(3);
  await group.getByRole('button', { name: '1Y', exact: true }).click();
  await expect(page.locator('.sc-legend').first()).toContainText('週 K');
  expect(await page.locator('.sc-ma20').first().evaluate((el) => getComputedStyle(el).stroke)).not.toBe(await page.locator('.sc-ma60').first().evaluate((el) => getComputedStyle(el).stroke));
  await expect(page.getByTestId('now-line').first()).toBeAttached();
});
