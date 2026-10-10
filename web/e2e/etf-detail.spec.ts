/**
 * 主動式 ETF 詳細頁（2026-10-08）：持股占比、拉日期看加碼／減碼（權重變化發散橫條）。
 * 示範資料沒有 ETF 持股：以 golden（tests/fixtures/golden/etf_pair.json，pytest 與 vitest 共用）當 etf/{code}.json。
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' }); // 讓 page.route 攔得到資料檔

const golden = JSON.parse(readFileSync(new URL('../../tests/fixtures/golden/etf_pair.json', import.meta.url), 'utf8')) as { detail: unknown };

test.beforeEach(async ({ page }) => {
  await page.route('**/data/etf/00999A.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(golden.detail) }));
});

test('ETF 詳細頁：預設前一次揭露，拉起日看整段期間的加碼與減碼', async ({ page }) => {
  await page.goto('#/explore/etf/00999A');
  await expect(page.getByTestId('etf-detail-sub')).toHaveText('00999A・測試投信・持股 7 檔・持股日 10/6');
  // 預設：前一次揭露（10/5 → 10/6）沒有實際買賣（等比例申購）
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/5 → 10/6・1 次揭露');
  await expect(page.getByTestId('etf-no-change')).toBeVisible();
  // 拉起日到最左：10/1 → 10/6
  await page.getByTestId('etf-from').locator('input').fill('0');
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/1 → 10/6・3 次揭露');
  await expect(page.getByTestId('etf-quick').locator('[aria-pressed=true]')).toHaveText('全部');
  await expect(page.getByTestId('etf-kind-counts')).toContainText('新增 1・加碼 2・減碼 2・剔除 1');
  const rows = page.getByTestId('etf-change-row');
  await expect(rows).toHaveCount(6);
  // 權重增加最多在上（紅）、減少最多在下（綠）
  await expect(rows.first()).toContainText('2330');
  await expect(rows.first().locator('.sv.up')).toBeVisible();
  await expect(rows.last()).toContainText('2412');
  await expect(rows.last().locator('.sv.down')).toBeVisible();
  // 全部持股：含股數沒變、只因股價變動的持股
  await page.getByTestId('etf-filter').getByRole('button', { name: '全部持股' }).click();
  await expect(rows).toHaveCount(8);
  // 持股占比：迄日依權重排序
  await expect(page.getByTestId('etf-weight-row').first()).toContainText('2330');
  // 密集橫條列：每列 44pt 以上、沒有 › 欄；策略區塊（config/active_etf.yml）
  const box = await rows.first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('etf-strategy-tags')).toContainText('高息');
  await expect(page.getByTestId('etf-strategy-src')).toHaveAttribute('href', /twse\.com\.tw/);
  // 列進入個股頁
  await rows.first().click();
  await expect(page).toHaveURL(/#\/stock\/2330/);
});

test('ETF 詳細頁：拖迄日時起日跟著往前；375 寬不需要左右滑動', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('#/explore/etf/00999A');
  await page.getByTestId('etf-to').locator('input').fill('0');
  await expect(page.getByTestId('etf-range').locator('.ui-sec-aside')).toHaveText('10/1 → 10/2・1 次揭露');
  await expect(page.getByTestId('etf-quick').locator('[aria-pressed=true]')).toHaveText('自訂');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  // 滑桿點擊區域至少 44pt
  const box = await page.getByTestId('etf-to').locator('input').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('沒有持股檔的 ETF 說明原因（清單上的 holdings_note）並連到個股頁', async ({ page }) => {
  await page.goto('#/explore/etf/00981A');
  await expect(page.getByTestId('etf-detail-missing')).toContainText('持股資料累積中');
  await expect(page.getByTestId('etf-strategy-tags')).toContainText('大型股');
  await expect(page.getByRole('link', { name: /股價與成交/ })).toHaveAttribute('href', '#/stock/00981A');
});

/** 示範資料沒有主動式 ETF：在 market.json 補幾列（含沒有持股、上市未滿期間的 ETF）。 */
const LIST = [
  { code: '00981A', name: '主動統一台股增長', close: 32.24, change_pct: -0.06, value_million_20d: 4613, mcap_yi: 2910, ret: { '1d': -0.06, '5d': 1.2, '20d': 3.2, '60d': 8.4, ytd: 25.1, '1y': null }, listed: '2025-05-27', has_holdings: true, holdings_n: 50, holdings_foreign: 0 },
  { code: '00400A', name: '主動國泰動能高息', close: 16.15, change_pct: -1.94, value_million_20d: 514, mcap_yi: null, ret: { '1d': -1.94, '5d': -2.1, '20d': -4.1, '60d': 1.1, ytd: 3.5, '1y': null }, listed: '2025-11-10', has_holdings: false, holdings_note: '國泰投信官網擋本工具的自動抓取，沒有持股資料' },
  { code: '00989A', name: '主動摩根美國科技', close: 11.5, change_pct: 0.8, value_million_20d: 120, mcap_yi: 11.7, ret: { '1d': 0.8, '5d': 0.3, '20d': null, '60d': null, ytd: null, '1y': null }, listed: '2026-09-25', has_holdings: true, holdings_n: 67, holdings_foreign: 67 },
];

test('ETF 清單（2026-10-09）：依成交值／市值／績效排序，切期間；每列一條橫條；不寫「無持股資料」', async ({ page }) => {
  await page.route('**/data/market.json', async (route) => {
    const res = await route.fetch();
    const json = { ...(await res.json()), active_etfs: LIST };
    await route.fulfill({ response: res, json });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('#/explore/etf');
  const list = page.getByTestId('etf-list');
  const rows = list.getByTestId('etf-list-row');
  await expect(rows.first()).toBeVisible();
  await expect(list).not.toContainText('無持股資料');
  await expect(rows.first().locator('.etf-tag').first()).toHaveText('大型股'); // 策略標籤
  await expect(rows.first().locator('.pbar')).toBeVisible(); // 預設成交值：長條
  await list.getByTestId('etf-list-sort').getByRole('button', { name: '績效' }).click();
  await expect(rows.first().locator('.dbar')).toBeVisible(); // 績效：以 0 為中心的發散橫條
  await list.getByTestId('etf-period').getByRole('button', { name: '1 日' }).click();
  await expect(list.getByTestId('etf-period-summary')).toContainText('1 日：');
  // 依 1 日報酬由大到小
  const vals = await rows.evaluateAll((els) => els.map((el) => {
    const t = el.querySelector('.el-v')?.textContent ?? '';
    const n = Number(t.replace(/[^\d.]/g, ''));
    return t.includes('▼') ? -n : t.includes('—') ? null : n;
  }));
  const nums = vals.filter((v): v is number => v !== null);
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
  // 切期間時排序自動改為績效；選擇記住（重新整理後仍在）
  await list.getByTestId('etf-list-sort').getByRole('button', { name: '市值' }).click();
  await list.getByTestId('etf-period').getByRole('button', { name: '20 日' }).click();
  await expect(list.getByTestId('etf-list-sort').locator('[aria-pressed=true]')).toHaveText('績效');
  await page.reload();
  await expect(page.getByTestId('etf-list').getByTestId('etf-period').locator('[aria-pressed=true]')).toHaveText('20 日');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(list.getByTestId('etf-period-summary')).toHaveText('20 日：上漲 1 檔・下跌 1 檔・中位數 −0.45%（1 檔上市未滿期間）');
  await expect(rows.last()).toContainText('上市未滿 20 個交易日（9/25 上市）');
  await expect(list).toContainText('國泰投信官網擋本工具的自動抓取');
  await rows.first().click();
  await expect(page).toHaveURL(/#\/explore\/etf\/00981A/);
});

/** 持股變動（2026-10-09）：一張圖，加碼在上、減碼在下；預設各前 10 檔。 */
const MOVES = [
  ...Array.from({ length: 12 }, (_, i) => ({ code: `${2300 + i}`, name: `加碼股${i}`, dir: 'add', kind: i === 0 ? 'new' : 'add', value_yi: 12 - i, pct_avg20: 12 - i, pct_mcap: 0.1, etfs_same_dir: 1, etfs: [] })),
  ...[5, 3, 1].map((v, i) => ({ code: `${2400 + i}`, name: `減碼股${i}`, dir: 'reduce', kind: 'reduce', value_yi: -v, pct_avg20: -v, pct_mcap: -0.1, etfs_same_dir: 2, etfs: [] })),
];

test('ETF 總覽持股變動：加碼在上、減碼在下的發散橫條，預設各前 10 檔、顯示全部展開', async ({ page }) => {
  await page.route('**/data/market.json', async (route) => {
    const res = await route.fetch();
    const json = { ...(await res.json()), active_etfs: LIST, etf_ranking: { date: '2026-10-08', add: [], reduce: [], items: MOVES, sort_default: 'value', coverage: { covered: 30, total: 32, holdings_date: '2026-10-08', issuers: 14 } } };
    await route.fulfill({ response: res, json });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('#/explore/etf');
  const sec = page.getByTestId('etf-moves');
  await expect(sec.getByTestId('etf-moves-summary')).toHaveText('1 日・加碼 12 檔・減碼 3 檔（橫條＝金額）'); // 2026-10-10：明細跟著資金流向圖的期間
  const rows = sec.getByTestId('etf-item');
  await expect(rows).toHaveCount(13); // 加碼前 10 ＋ 減碼 3
  await expect(rows.first()).toContainText('加碼股0');
  await expect(rows.first().locator('.sv.up')).toBeVisible();
  await expect(rows.first()).toContainText('新增');
  await expect(rows.nth(1)).toContainText('佔均額 11.0%');
  await expect(rows.last()).toContainText('減碼股0'); // 最大的減碼在最底
  await expect(rows.last().locator('.sv.down')).toBeVisible();
  await expect(sec.locator('.ui-row-chev')).toHaveCount(0);
  const more = sec.getByTestId('etf-moves-more');
  await expect(more).toHaveText('顯示全部 15 檔（加碼 12・減碼 3）');
  await more.click();
  await expect(rows).toHaveCount(15);
  await expect(more).toHaveText('只看加碼、減碼各前 10 檔');
  // 口徑切到佔均額：數值下方改列金額
  await sec.getByTestId('etf-sort').getByRole('button', { name: '佔均額' }).click();
  await expect(rows.nth(1)).toContainText('11.00 億');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await rows.first().click();
  await expect(page).toHaveURL(/#\/stock\/2300/);
});
