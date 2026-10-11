import { expect, test } from '@playwright/test';

// 2026-10-10：主動式 ETF 首屏＝完整的資金流向圖（加碼在上、減碼在下），期間 1 日｜1 週｜2 週｜1 個月｜1 季；明細與清單往下滑。

test.use({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });

const item = (code: string, name: string, v: number, same = 1) => ({
  code, name, dir: v > 0 ? 'add' : 'reduce', kind: v > 0 ? 'add' : 'reduce', value_yi: v, pct_avg20: v / 2, pct_mcap: 0.01, etfs_same_dir: same, etfs: [],
});
const DAY = [...Array.from({ length: 14 }, (_, i) => item(`${2300 + i}`, `加碼${i}`, 14 - i)), ...Array.from({ length: 12 }, (_, i) => item(`${2400 + i}`, `減碼${i}`, -(12 - i)))];
const QUARTER = [item('3017', '奇鋐', 198, 18), item('3653', '健策', 63.2, 14), item('2303', '聯電', -96.2, 9), item('3711', '日月光投控', -99.8, 11)];
const FLOWS = {
  date: '2026-10-08',
  periods: {
    '1d': { from: null, to: '2026-10-08', days: 1, add_yi: 120.5, reduce_yi: -80.25, n_add: 40, n_reduce: 30, etfs: 26, items: DAY },
    '1q': { from: '2026-07-15', to: '2026-10-08', days: 60, add_yi: 1075, reduce_yi: -1167, n_add: 156, n_reduce: 160, etfs: 25, items: QUARTER },
  },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/data/market.json', async (route) => {
    const res = await route.fetch();
    const json = { ...(await res.json()), etf_ranking: { date: '2026-10-08', add: [], reduce: [], items: DAY, sort_default: 'value', coverage: { covered: 26, total: 32, holdings_date: '2026-10-08', issuers: 14 } } };
    await route.fulfill({ response: res, json });
  });
  await page.route('**/data/etf_flows.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(FLOWS) }));
});

test('首屏就是完整的資金流向圖：加碼在上、減碼在下，整張圖在底部切換列上方；明細在圖的下方', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('#/explore/etf');
  const sec = page.getByTestId('etf-flow');
  await expect(sec.getByTestId('etf-flow-period').locator('[aria-pressed=true]')).toHaveText('1 日');
  await expect(sec.locator('.ui-sec-aside')).toHaveText('持股日 10/8');
  await expect(sec.getByTestId('etf-flow-summary')).toHaveText('加碼 +121 億（40 檔）・減碼 −80.3 億（30 檔）');
  const chart = sec.getByTestId('etf-flow-chart');
  const bars = chart.getByTestId('etf-flow-bar');
  await expect(bars.first()).toContainText('加碼0');
  await expect(bars.last()).toContainText('減碼0'); // 流出最多的在最底
  const n = await bars.count();
  expect(n).toBeGreaterThanOrEqual(8);
  expect(n).toBe(Number(await chart.getAttribute('data-slots')));
  // 一眼看完：整張圖在底部切換列上方；明細區塊在圖的下方
  const box = (await chart.boundingBox())!;
  const dock = (await page.locator('.tabbar').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  expect((await page.getByTestId('etf-moves').boundingBox())!.y).toBeGreaterThan(box.y + box.height);
  // 數字標在中線另一側：加碼列的數字在左半、減碼列在右半
  await expect(bars.first().locator('.fc-neg .fc-val.up')).toHaveText('+14.0');
  await expect(bars.last().locator('.fc-pos .fc-val.down')).toHaveText('−12.0');
  await expect(chart).toHaveAttribute('aria-label', /加碼最多 加碼0 14\.0 億/);
  expect(errors).toEqual([]);
});

test('期間切到 1 季：圖、合計、期間與明細一起換，並記住選擇；沒有資料的期間寫原因', async ({ page }) => {
  await page.goto('#/explore/etf');
  const sec = page.getByTestId('etf-flow');
  await sec.getByTestId('etf-flow-period').getByRole('button', { name: '1 季' }).click();
  await expect(page).toHaveURL(/fp=1q/);
  await expect(sec.locator('.ui-sec-aside')).toHaveText('7/15–10/8');
  await expect(sec.getByTestId('etf-flow-summary')).toHaveText('加碼 +1,075 億（156 檔）・減碼 −1,167 億（160 檔）');
  const bars = sec.getByTestId('etf-flow-bar');
  await expect(bars).toHaveCount(4);
  await expect(bars.first()).toContainText('奇鋐');
  await expect(bars.last()).toContainText('日月光投控');
  await expect(page.getByTestId('etf-moves-summary')).toHaveText(/^1 季・加碼 2 檔・減碼 2 檔/);
  await page.goto('#/explore');
  await page.goto('#/explore/etf');
  await expect(page.getByTestId('etf-flow-period').locator('[aria-pressed=true]')).toHaveText('1 季');
  await page.getByTestId('etf-flow-period').getByRole('button', { name: '2 週' }).click();
  await expect(sec).toContainText('2 週資金流向資料累積中');
});
