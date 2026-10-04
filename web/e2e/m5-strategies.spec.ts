/**
 * M5（2026-10 恢復環境光改版）策略庫與策略詳情驗收。資料：e2e/fixtures 的真實輸出裁切（strategies-m5.json、screen.json、
 * strategy/rev_confirm.json 只留 7 個期間、逐筆只留超額欄）。
 * - 清單：分級標籤、兩個基準的超額與 t、近 3 年迷你折線、今日新觸發檔數。
 * - 詳情：一行結論、四個分段（預設標的，股票在第一個螢幕）、篩選列（期間、基準、樣本不足）。
 * - 切換序列與基準時軸刻度文字完全不變；切換期間後樣本數同步、分級標籤不變；年度表合計列＝判定卡；
 *   「全部」數值＝strategies.json 判定；只看某年的組合報酬＝年度表該年。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');
const PACK = JSON.parse(fixture('strategy/rev_confirm.json')) as { periods: Record<string, { card: { n: number; '0050': { excess: number } }; port: { total: number } }>; years: { year: string; port: number }[] };
const LIB = JSON.parse(fixture('strategies-m5.json')) as { strategies: { id: string; judge?: { opp: { excess: number; t: number }; sig: { excess: number; t: number; n: number } } }[] };

test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

async function useData(page: Page) {
  const map: Record<string, string> = {
    'strategies.json': 'strategies-m5.json',
    'screen.json': 'screen.json',
    'strategy/rev_confirm.json': 'strategy/rev_confirm.json',
    'strategy/rev_confirm-signals.json': 'strategy/rev_confirm-signals.json',
  };
  for (const [url, file] of Object.entries(map)) {
    await page.route(`**/data/${url}`, (r) => r.fulfill({ contentType: 'application/json', body: fixture(file) }));
  }
}

const sgn = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const ticks = (page: Page, testid: string) => page.getByTestId(testid).locator('[data-testid="sc2-ticks"] text').allTextContents();

test('策略庫：每列分級標籤、0050 與等權的超額與 t、迷你折線、今日新觸發；無效收合', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies');
  const list = page.getByTestId('st-sec-listed-list');
  await expect(list.locator('.stl-row')).toHaveCount(5);
  const row = page.getByTestId('st-row-rev_confirm');
  await expect(row.getByTestId('grade-tag')).toHaveText('有效');
  await expect(row.locator('.sig-blk')).toHaveText(['0050 +4.19%・t 2.45', '等權 +5.07%・t 3.24']);
  await expect(row.locator('.stl-spark svg path').first()).toBeAttached();
  await expect(page.getByTestId('st-row-leader_trust')).toContainText('新觸發 3');
  await expect(page.getByTestId('st-sec-off-list')).toHaveCount(0);
  await page.getByTestId('st-fold').click();
  await expect(page.getByTestId('st-sec-off-list').locator('.stl-row')).toHaveCount(2);
  await row.click();
  await expect(page).toHaveURL(/#\/explore\/strategies\/rev_confirm$/);
});

test('策略詳情：一行結論、四個分段預設標的；今日無新觸發時預設篩出、第一個螢幕就有股票', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm');
  await expect(page.getByTestId('st-concl')).toHaveText('0050 +4.19%・t 2.45｜等權 +5.07%・t 3.24｜708 筆');
  await expect(page.getByTestId('st-rule').locator('.term')).not.toHaveCount(0);
  const seg = page.getByTestId('st-seg');
  await expect(seg.getByRole('button')).toHaveText(['標的', '績效', '事件研究', '規則']);
  await expect(seg.getByRole('button', { name: '標的' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('screen-view').getByRole('button', { name: '篩出 25' })).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('.scr-row');
  await expect(rows.first()).toBeVisible();
  const inView = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().top < innerHeight).length);
  expect(inView).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('st-track')).toBeVisible();
  await expect(page.getByTestId('st-leverage')).toBeVisible();
  await expect(page.locator('.page')).not.toContainText(/買進|賣出|(?<!非)推薦/);
});

test('績效：「全部」數值＝策略庫判定；年度表合計列＝判定卡', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=p');
  const j = LIB.strategies.find((s) => s.id === 'rev_confirm')!.judge!;
  await expect(page.getByTestId('judge-opp-excess_vs')).toHaveText(sgn(j.opp.excess));
  await expect(page.getByTestId('judge-sig-excess_vs')).toHaveText(sgn(j.sig.excess));
  await expect(page.getByTestId('judge-opp-adjusted_t')).toContainText(j.opp.t.toFixed(2));
  await expect(page.getByTestId('year-total-n')).toHaveText(j.sig.n.toLocaleString('en-US'));
  await expect(page.getByTestId('year-total-ex')).toHaveText(sgn(j.opp.excess).replace('%', ''));
  await expect(page.getByTestId('period-note')).toHaveCount(0);
});

test('績效：切換序列與基準時軸刻度文字不變；改期間才更新', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=p');
  await expect(page.getByTestId('st-equity')).toBeVisible();
  const eq0 = await ticks(page, 'st-equity');
  const roll0 = await ticks(page, 'st-rolling-chart');
  expect(eq0.length).toBeGreaterThan(1);
  for (const id of ['chip-0050', 'chip-tr', 'chip-port']) {
    await page.getByTestId('st-equity').getByTestId(id).click();
    expect(await ticks(page, 'st-equity')).toEqual(eq0);
  }
  for (const b of ['等權', '加權報酬', '00631L', '0050']) {
    await page.getByTestId('bench-switch').getByRole('button', { name: b }).click();
    await page.waitForTimeout(450);
    expect(await ticks(page, 'st-equity')).toEqual(eq0);
    expect(await ticks(page, 'st-rolling-chart')).toEqual(roll0);
  }
  await page.getByTestId('log-toggle').click();
  await page.waitForTimeout(500);
  expect(await ticks(page, 'st-equity')).not.toEqual(eq0);
});

test('績效：只看某年→樣本數同步、樣本不足、分級不變；組合報酬＝年度表該年；網址重新整理保留', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=p');
  const allPort2024 = await page.getByTestId('year-port-2024').textContent();
  await page.getByTestId('period-year').click();
  await page.getByTestId('year-only').getByRole('button', { name: '2024 年' }).click();
  await expect(page).toHaveURL(/p=year%3A2024|p=year:2024/);
  const n = PACK.periods['year:2024'].card.n;
  await expect(page.getByTestId('period-note')).toContainText(`檢視 2024 年・${n}／708 筆・分級以全期間為準`);
  await expect(page.getByTestId('small-sample')).toBeVisible();
  await expect(page.getByTestId('year-total-n')).toHaveText(String(n));
  await expect(page.getByTestId('year-total-port')).toHaveText(allPort2024!);
  await expect(page.getByTestId('grade-tag')).toHaveText('有效');
  await page.getByTestId('bench-switch').getByRole('button', { name: '等權' }).click();
  await page.reload();
  await expect(page.getByTestId('period-note')).toContainText('2024 年');
  await expect(page.getByTestId('bench-switch').getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('st-seg').getByRole('button', { name: '績效' })).toHaveAttribute('aria-pressed', 'true');
});

test('績效逐年：四個統計格、年度長條；點一年＝只看該年並回到累積', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=p&pv=year');
  await expect(page.getByTestId('st-year-stats')).toContainText('勝過 0050 年數');
  await page.getByTestId('st-year-bars').getByRole('button', { name: /^2025：/ }).click();
  await expect(page).toHaveURL(/p=year/);
  await expect(page.getByTestId('perf-view').getByRole('button', { name: '累積' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('period-note')).toContainText('2025 年');
  await expect(page.getByTestId('st-held')).toContainText('當週持股');
});

test('事件研究：合併曲線切換基準軸不變；逐年疊圖；多期間、分布、最大最小 10 筆、出場規則', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=e');
  await expect(page.getByTestId('event-curve')).toBeVisible();
  const t0 = await ticks(page, 'event-curve');
  for (const b of ['等權', '加權報酬', '00631L']) {
    await page.getByTestId('bench-switch').getByRole('button', { name: b }).click();
    await page.waitForTimeout(450);
    expect(await ticks(page, 'event-curve')).toEqual(t0);
  }
  await expect(page.getByTestId('multi-table').locator('tbody tr')).toHaveCount(6);
  await expect(page.getByTestId('st-hist')).toContainText('中位數');
  await expect(page.getByTestId('st-top').locator('.ui-row')).toHaveCount(10);
  await expect(page.getByTestId('st-bottom').locator('.ui-row')).toHaveCount(10);
  await expect(page.getByTestId('st-exits')).toContainText('2021 年底前選');
  await page.getByTestId('event-view').getByRole('button', { name: '逐年' }).click();
  await expect(page.getByTestId('event-years-chart')).toBeVisible();
  await page.getByTestId('event-years').getByRole('button', { name: '2023' }).click();
  await expect(page.getByTestId('event-years-chart').locator('.sc2-end')).toContainText(['2023']);
});

test('規則：參數、含下市、股票池、門檻點開列出每一項', async ({ page }) => {
  await useData(page);
  await page.goto('#/explore/strategies/rev_confirm?seg=r');
  await expect(page.getByTestId('st-params')).toContainText('RS');
  await expect(page.getByTestId('st-delisted')).toContainText('是');
  await page.getByTestId('st-gates').click();
  await expect(page.getByTestId('gate-list').locator('.ui-row')).toHaveCount(5);
});
