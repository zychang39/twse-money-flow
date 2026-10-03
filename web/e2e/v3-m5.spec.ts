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

test('期間選項 1D～ALL 一律顯示（D3；沒有 10Y）；5Y／ALL 載入長歷史，ALL 週線取樣；1Y 以內不載入', async ({ page }) => {
  const count = await withLongHistory(page);
  await page.goto('#/stock/2330');
  const group = page.getByTestId('stock-periods').first();
  await expect(group.getByRole('button')).toHaveText(['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL']);
  const chart = page.locator('.chart-wrap').first();
  await expect(chart).toHaveAttribute('data-points', /\d+/);
  await page.waitForTimeout(300);
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
});

test('沒有長歷史檔的部署：5Y 用現有資料並說明資料累積中', async ({ page }) => {
  await page.goto('#/stock/2330');
  await page.getByTestId('stock-periods').first().getByRole('button', { name: '5Y', exact: true }).click();
  await expect(page.getByTestId('hero-coverage').first()).toContainText(/資料累積中：目前只有 \d+ 個交易日/);
});
