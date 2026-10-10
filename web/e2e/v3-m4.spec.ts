import { expect, test, type CDPSession, type Page } from '@playwright/test';

// v3 M4（docs/V3_NOTES.md）：兩指區間報酬（仿 Apple 股市）。多點觸控用 Chrome DevTools Protocol 的 Input.dispatchTouchEvent。

test.use({ viewport: { width: 393, height: 852 } });

type Pt = { x: number; y: number; id: number };

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
}

async function chartBox(page: Page, sel = '.chart-wrap') {
  const chart = page.locator(sel).first();
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1100); // 描繪動畫
  return (await chart.boundingBox())!;
}

test('兩指：兩條垂直標線＋標線下方兩個日期；漲跌、報酬率、交易日數寫在期間漲跌那一列（2026-10-10：不用浮框）；手指移動即時更新；放開保留約 2 秒再淡出', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const f1 = { x: b.x + b.width * 0.2, y, id: 1 };
  let f2 = { x: b.x + b.width * 0.6, y, id: 2 };
  await touch(cdp, 'touchStart', [f1]);
  await touch(cdp, 'touchStart', [f1, f2]);
  const tip = page.getByTestId('range-readout');
  await expect(tip).toBeVisible();
  await expect(page.locator('[data-testid="range-marks"] line')).toHaveCount(2);
  // 圖上沒有浮框；兩端日期在標線下方（取代起訖日期）
  await expect(page.locator('.range-tip')).toHaveCount(0);
  await expect(page.getByTestId('range-date')).toHaveCount(2);
  await expect(page.getByTestId('range-date').first()).toHaveText(/^\d{4}\/\d+\/\d+$/);
  // 個股頁：區間結果在主角數字下方第二列（原本的所選期間漲跌）
  await expect(page.getByTestId('hero-period-change')).toHaveCount(0);
  await expect(tip).toContainText(/區間 \d+ 個交易日/);
  await expect(tip).toContainText(/[▲▼]\s?[\d,.]+ \([\d.]+%\)/);
  const tipBox = (await tip.boundingBox())!;
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(b.y + 1); // 在圖表上方，不蓋住走勢線
  const dateBefore = await page.getByTestId('hero-change-date').first().textContent();
  const first = await tip.textContent();
  const days1 = Number(first!.match(/(\d+) 個交易日/)![1]);
  // 手指移動 → 即時更新
  for (let i = 1; i <= 6; i++) {
    f2 = { ...f2, x: b.x + b.width * (0.6 + i * 0.05) };
    await touch(cdp, 'touchMove', [f1, f2]);
  }
  await expect(tip).not.toHaveText(first!);
  const days2 = Number((await tip.textContent())!.match(/(\d+) 個交易日/)![1]);
  expect(days2).toBeGreaterThan(days1);
  // 主角數字不受影響（不是查價）：當日漲跌的日期不變
  await expect(page.getByTestId('hero-change-date').first()).toHaveText(dateBefore!);
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(1000);
  await expect(tip).toBeVisible(); // 放開後仍保留
  await expect(tip).toHaveCount(0, { timeout: 3000 }); // 約 2 秒後淡出
  await cdp.detach();
});

test('單指長按是查價（沒有區間；M3：折線長按 0.2 秒，主角數字與日期跟著變）', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const cdp = await page.context().newCDPSession(page);
  const p = { x: b.x + b.width * 0.4, y: b.y + b.height / 2, id: 1 };
  await touch(cdp, 'touchStart', [p]);
  await page.waitForTimeout(450);
  await touch(cdp, 'touchMove', [{ ...p, x: p.x + 3 }]);
  await page.waitForTimeout(80);
  await expect(page.getByTestId('hero-change').first()).toContainText(/\d{4}\/\d+\/\d+/);
  await expect(page.getByTestId('range-readout')).toHaveCount(0);
  await touch(cdp, 'touchEnd', []);
  await cdp.detach();
});

test('在可換股的清單中，兩指左右移動不會換股', async ({ page }) => {
  await page.goto('#/mine');
  await page.evaluate(() => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: ['2330', '2317', '2454'] })));
  await page.goto('#/stock/2317');
  await expect(page.locator('.pager-pane:not([inert]) [data-testid="stock-price"]')).toBeVisible();
  const b = await chartBox(page, '.pager-pane:not([inert]) .chart-wrap');
  const y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  let f1 = { x: b.x + b.width * 0.3, y, id: 1 };
  let f2 = { x: b.x + b.width * 0.5, y, id: 2 };
  await touch(cdp, 'touchStart', [f1]);
  await touch(cdp, 'touchStart', [f1, f2]);
  for (let i = 1; i <= 10; i++) {
    f1 = { ...f1, x: f1.x - 12 };
    f2 = { ...f2, x: f2.x + 12 };
    await touch(cdp, 'touchMove', [f1, f2]);
  }
  await expect(page.getByTestId('range-readout')).toBeVisible();
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/#\/stock\/2317$/);
  await cdp.detach();
});

test('桌機：按住拖曳選出區間；價格基準在 ⋯ 切換（記住；整張圖一起切換）', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, y, { steps: 6 });
  const tip = page.getByTestId('range-readout');
  await expect(tip).toBeVisible();
  await page.mouse.up();
  await expect(tip).toBeVisible();
  await page.getByTestId('stock-more').click();
  const basis = page.getByTestId('basis-seg');
  await expect(basis.getByRole('button', { name: '還原價' })).toHaveAttribute('aria-pressed', 'true');
  await basis.getByRole('button', { name: '原始價' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tmf-range-basis'))).toBe('raw');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('data-time')).toContainText('原始價');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const b2 = await chartBox(page);
  const y2 = b2.y + b2.height / 2;
  await page.mouse.move(b2.x + b2.width * 0.1, y2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width * 0.5, y2, { steps: 6 });
  await expect(tip).toBeVisible();
  await page.mouse.up();
});
