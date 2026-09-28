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

test('兩指：兩條垂直標線＋上方兩個日期、漲跌、報酬率、交易日數；手指移動即時更新；放開保留約 2 秒再淡出', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const f1 = { x: b.x + b.width * 0.2, y, id: 1 };
  let f2 = { x: b.x + b.width * 0.6, y, id: 2 };
  await touch(cdp, 'touchStart', [f1]);
  await touch(cdp, 'touchStart', [f1, f2]);
  const tip = page.getByTestId('range-tip');
  await expect(tip).toBeVisible();
  await expect(page.locator('[data-testid="range-marks"] line')).toHaveCount(2);
  await expect(tip).toContainText(/\d{4}\/\d+\/\d+ – \d{4}\/\d+\/\d+・\d+ 個交易日/);
  await expect(tip).toContainText(/[▲▼]?\s?[\d,.]+（[+−]?[\d.]+%）/);
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
  // 主角數字不受影響（不是單指查價）
  await expect(page.locator('.hero-change').first()).toContainText('今日');
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(1000);
  await expect(tip).toBeVisible(); // 放開後仍保留
  await expect(tip).toHaveCount(0, { timeout: 3000 }); // 約 2 秒後淡出
  await cdp.detach();
});

test('單指仍是查單點價格（沒有區間）', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const cdp = await page.context().newCDPSession(page);
  const p = { x: b.x + b.width * 0.4, y: b.y + b.height / 2, id: 1 };
  await touch(cdp, 'touchStart', [p]);
  await page.waitForTimeout(80);
  await touch(cdp, 'touchMove', [{ ...p, x: p.x + 3 }]);
  await page.waitForTimeout(80);
  await expect(page.locator('.hero-change .caption').first()).toHaveText(/\d{4}\/\d+\/\d+（.）/);
  await expect(page.getByTestId('range-tip')).toHaveCount(0);
  await touch(cdp, 'touchEnd', []);
  await cdp.detach();
});

test('在可換股的清單中，兩指左右移動不會換股', async ({ page }) => {
  await page.goto('#/mine');
  await page.evaluate(() => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: ['2330', '2317', '2454'] })));
  await page.goto('#/stock/2317');
  await expect(page.locator('.pager-pane:not([inert]) .hero')).toBeVisible();
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
  await expect(page.getByTestId('range-tip')).toBeVisible();
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(/#\/stock\/2317$/);
  await cdp.detach();
});

test('桌機：按住拖曳選出區間；報酬率預設還原價，可切換原始價（記住）', async ({ page }) => {
  await page.goto('#/stock/2330');
  const b = await chartBox(page);
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, y, { steps: 6 });
  const tip = page.getByTestId('range-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('還原價（含股利）');
  await page.mouse.up();
  await expect(tip).toBeVisible();
  const basis = page.getByTestId('range-basis');
  await expect(basis.getByRole('button', { name: '還原價' })).toHaveAttribute('aria-pressed', 'true');
  await basis.getByRole('button', { name: '原始價' }).click();
  expect(await page.evaluate(() => localStorage.getItem('tmf-range-basis'))).toBe('raw');
  await page.mouse.move(b.x + b.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, y, { steps: 6 });
  await expect(tip).toContainText('原始價');
  await page.mouse.up();
});
