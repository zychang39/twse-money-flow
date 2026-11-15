import { expect, test, type Page } from '@playwright/test';

// v3 M5（docs/V3_NOTES.md）：10 年股價。個股檔只有最近約 4.5 年，5Y／10Y／ALL 載入長歷史檔；10Y、ALL 週線取樣。
// 示範資料只有 320 個交易日：攔截 meta.json 與 stocks/2330.hist.json，合成往前延伸到 10 年以上的長歷史。

// service worker 接手後的請求不經過 page.route：這裡攔截的是之後才載入的長歷史檔，所以停用 service worker
test.use({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });

function weekdaysBack(from: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

async function withLongHistory(page: Page) {
  let histRequests = 0;
  await page.route('**/data/meta.json', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    j.long_history = { files: 12, first_date: '2014-01-02' };
    await route.fulfill({ response: res, json: j });
  });
  await page.route('**/data/stocks/2330.hist.json', async (route) => {
    histRequests++;
    const main = await (await page.request.get(route.request().url().replace('.hist.json', '.json'))).json();
    const older = weekdaysBack(main.d[0], 2900);
    const c0 = main.c.find((v: number | null) => v !== null) as number;
    const oldC = older.map((_, i) => Math.round((c0 * (0.3 + (0.7 * i) / older.length)) * 100) / 100);
    await route.fulfill({ json: { code: '2330', d: [...older, ...main.d], c: [...oldC, ...main.c], af: [...older.map(() => main.af[0]), ...main.af] } });
  });
  return () => histRequests;
}

test('期間選項 1D～ALL 一律顯示（D3；2026-11-16 起 11 個）；5Y／10Y／ALL 載入長歷史，10Y、ALL 週線取樣；2Y 以內不載入', async ({ page }) => {
  const count = await withLongHistory(page);
  await page.goto('#/stock/2330');
  const group = page.getByTestId('stock-periods').first();
  await expect(group.getByRole('button')).toHaveText(['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'ALL']);
  const chart = page.locator('.chart-wrap').first();
  await expect(chart).toHaveAttribute('data-points', /\d+/);
  await page.waitForTimeout(300);
  expect(count()).toBe(0);
  // 2Y：只用個股檔（超過 300 個交易日 → 週線；示範資料約 320 個交易日 ≈ 66 週），不載入長歷史
  await group.getByRole('button', { name: '2Y', exact: true }).click();
  await expect(page.getByTestId('hero-period-change').first()).toContainText('近 2 年');
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeLessThan(115);
  expect(Number(await chart.getAttribute('data-points'))).toBeGreaterThan(50);
  expect(count()).toBe(0);
  // 5Y：長歷史收盤（約 5 × 245 點），從 5 年前開始
  await group.getByRole('button', { name: '5Y', exact: true }).click();
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeGreaterThan(1100);
  expect(count()).toBe(1);
  const from5 = (await chart.getAttribute('data-from'))!;
  expect(Number(from5.slice(0, 4))).toBeLessThanOrEqual(2021);
  await expect(page.getByTestId('hero-coverage')).toHaveCount(0);
  await expect(page.getByTestId('data-time')).toContainText('收盤折線');
  // ALL：週線取樣
  await group.getByRole('button', { name: 'ALL', exact: true }).click();
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeLessThan(700);
  expect(Number((await chart.getAttribute('data-from'))!.slice(0, 4))).toBeLessThanOrEqual(2016);
  expect(count()).toBe(1); // 快取：只載入一次
  // 10Y：同樣是長歷史、週線取樣
  await group.getByRole('button', { name: '10Y', exact: true }).click();
  await expect(group.getByRole('button', { name: '10Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeLessThan(700);
  expect(count()).toBe(1);
});

test('沒有長歷史檔的部署：5Y 用現有資料並說明資料累積中', async ({ page }) => {
  await page.goto('#/stock/2330');
  await page.getByTestId('stock-periods').first().getByRole('button', { name: '5Y', exact: true }).click();
  await expect(page.getByTestId('hero-coverage').first()).toContainText(/資料累積中：目前只有 \d+ 個交易日/);
});

test('期間列（2026-11-16）：11 個期間放不下 → 可以左右拖動；選到的滑到正中間；邊緣淡出；每個至少 44pt', async ({ page }) => {
  await page.goto('#/stock/2330');
  const group = page.getByTestId('stock-periods').first();
  await expect(group).toHaveClass(/scroll/);
  const m = () => group.evaluate((el) => {
    const b = el.querySelector('button[aria-pressed="true"]') as HTMLElement;
    const r = el.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { sl: el.scrollLeft, max: el.scrollWidth - el.clientWidth, off: Math.abs((br.left + br.width / 2) - (r.left + r.width / 2)), moreL: el.hasAttribute('data-more-l'), moreR: el.hasAttribute('data-more-r'), pressed: b.textContent };
  });
  // 內容比容器寬（可以拖動）；整頁不會因此左右捲動
  expect((await m()).max).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const b of await group.getByRole('button').all()) {
    const box = await b.evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    expect(box.w).toBeGreaterThanOrEqual(44);
    expect(box.h).toBeGreaterThanOrEqual(44);
  }
  // 預設 1Y：一進來就在正中間（不播動畫），兩側都還有期間 → 兩邊淡出
  await expect.poll(async () => (await m()).off).toBeLessThanOrEqual(2);
  expect(await m()).toMatchObject({ pressed: '1Y', moreL: true, moreR: true });
  // 點 3M：滑到正中間
  await group.getByRole('button', { name: '3M', exact: true }).click();
  await expect.poll(async () => (await m()).off).toBeLessThanOrEqual(2);
  // 最後一個（ALL）靠右、捲到底；右邊沒有內容了就不淡出
  await group.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await group.getByRole('button', { name: 'ALL', exact: true }).click();
  await expect.poll(async () => { const x = await m(); return x.max - x.sl; }).toBeLessThanOrEqual(1);
  expect(await m()).toMatchObject({ pressed: 'ALL', moreL: true, moreR: false });
  // 第一個（1D）靠左
  await group.evaluate((el) => { el.scrollLeft = 0; });
  await group.getByRole('button', { name: '1D', exact: true }).click();
  await expect.poll(async () => (await m()).sl).toBeLessThanOrEqual(1);
  expect(await m()).toMatchObject({ pressed: '1D', moreL: false, moreR: true });
  // 重新整理：記得選的期間，而且一進來就捲到看得到
  await group.getByRole('button', { name: '10Y', exact: true }).scrollIntoViewIfNeeded();
  await group.getByRole('button', { name: '10Y', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '10Y', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stock-periods').first().getByRole('button', { name: '10Y', exact: true })).toBeInViewport({ ratio: 1 });
});

test('期間列：滑鼠按住拖曳可以捲動，拖過不算點擊；期間不多的圖（今晚頁的加權指數）維持平分整列、不捲動', async ({ page }) => {
  await page.goto('#/stock/2330');
  const group = page.getByTestId('stock-periods').first();
  await expect(group).toHaveClass(/scroll/);
  await expect.poll(() => group.evaluate((el) => el.hasAttribute('data-more-r'))).toBe(true);
  const before = await group.evaluate((el) => el.scrollLeft);
  const box = (await group.boundingBox())!;
  expect(before).toBeGreaterThan(120); // 1Y 在中間，左邊已經捲過一段
  // 按住往右拖半個寬度 → 內容跟著往右（看到前面的期間）
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await group.evaluate((el) => el.scrollLeft)).toBeLessThan(before - 100);
  await expect(group.getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'true'); // 沒有因為拖曳換期間
  await page.goto('#/');
  const tonight = page.getByRole('group', { name: '加權指數走勢期間' });
  await expect(tonight).toBeVisible();
  await expect(tonight).not.toHaveClass(/scroll/);
  expect(await tonight.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
