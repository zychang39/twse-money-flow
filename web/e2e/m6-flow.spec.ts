/**
 * M6（2026-10 恢復環境光改版）：每日步驟自動判定、新手導覽只領一次、名詞讀過計入圖鑑、設定頁分區、每頁隨機抽 5 個名詞可點開。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seed } from './helpers';

test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

async function fixTime(page: Page, request: APIRequestContext) {
  const { date } = await (await request.get('data/summary.json')).json() as { date: string };
  await page.clock.setFixedTime(new Date(`${date}T20:00:00+08:00`));
}

const activities = (page: Page) => page.evaluate(() => new Promise<{ type: string; meta?: Record<string, unknown> }[]>((resolve) => {
  const req = indexedDB.open('twse-money-flow');
  req.onsuccess = () => {
    const all = req.result.transaction('activity', 'readonly').objectStore('activity').getAll();
    all.onsuccess = () => resolve(all.result);
  };
}));

test('第 3 步看自選異動：開過清單後，依步驟卡逐一開啟異動的個股直到完成；開個股只記一次', async ({ page, request }) => {
  await fixTime(page, request);
  await seed(page, { watchlist: [{ code: '2330', group: '預設', addedAt: '2026-01-01' }, { code: '2317', group: '預設', addedAt: '2026-01-01' }, { code: '2454', group: '預設', addedAt: '2026-01-01' }] });
  await page.goto('#/discipline');
  await expect(page.getByTestId('step-movers')).toContainText('待辦');
  await page.goto('#/mine?seg=watch');
  await expect(page.getByTestId('watch-basis')).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.goto('#/discipline');
    const card = page.getByTestId('step-movers');
    await expect(card).toBeVisible();
    if ((await card.textContent())?.includes('已完成')) break;
    await card.click();
    await expect(page).toHaveURL(/#\/stock\//);
    await page.waitForTimeout(300);
  }
  await page.goto('#/discipline');
  await expect(page.getByTestId('step-movers')).toContainText('已完成');
  // 同一檔再開一次不重複記
  await page.goto('#/stock/2330');
  await page.goto('#/stock/2330?seg=m');
  await page.waitForTimeout(300);
  const views = (await activities(page)).filter((a) => a.type === 'stock_viewed' && a.meta?.code === '2330');
  expect(views.length).toBeLessThanOrEqual(1);
});

test('新手導覽：看一個族群頁後該項完成，只記一次；名詞讀過計入圖鑑', async ({ page, request }) => {
  await fixTime(page, request);
  await page.goto('#/explore/sectors?layer=official');
  await page.getByTestId('group-list').locator('.grp-row').first().click();
  await expect(page).toHaveURL(/#\/explore\/sectors\/o-/);
  await page.waitForTimeout(300);
  await page.goto('#/explore/sectors?layer=fine');
  await page.getByTestId('group-list').locator('.grp-row').first().click();
  await page.waitForTimeout(300);
  // 名詞
  await page.goto('#/stock/2330');
  await page.locator('.term').first().click();
  await expect(page.getByTestId('help-sheet')).toBeVisible();
  await page.goto('#/discipline');
  await page.getByTestId('onboard-more').click();
  await expect(page.getByTestId('onboard-group_page')).toContainText('已完成');
  await expect(page.getByTestId('onboard-term')).toContainText('已完成');
  await expect(page.getByTestId('flow-glossary')).toContainText(/已讀 [1-9]\d*／/);
  const acts = await activities(page);
  expect(acts.filter((a) => a.type === 'onboard' && a.meta?.task === 'group_page')).toHaveLength(1);
});

test('設定頁：顯示｜風險｜門檻｜資料｜名詞表｜關於；預設圖表與異動門檻記住', async ({ page }) => {
  await page.goto('#/me/settings');
  for (const id of ['set-display', 'set-risk', 'set-thresholds', 'set-data', 'set-glossary']) await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId('chart-default').getByRole('button', { name: 'K 線' }).click();
  await page.getByTestId('mover-th').getByRole('button', { name: '5%' }).click();
  await page.reload();
  await expect(page.getByTestId('chart-default').getByRole('button', { name: 'K 線' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mover-th').getByRole('button', { name: '5%' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('tmf-stock-chart-v2'))).toBe('candle');
  expect(await page.evaluate(() => localStorage.getItem('tmf-mover-pct'))).toBe('5');
});

// 每頁隨機抽 5 個名詞（固定種子，結果可重現）都能點開說明；名詞少於 5 個的頁面全部點
const PAGES = ['#/?seg=market', '#/?seg=money', '#/mine', '#/stock/2330', '#/stock/2330?seg=c', '#/stock/2330?seg=f', '#/explore/sectors', '#/explore/screener',
  '#/explore/strategies', '#/explore/market', '#/explore/evidence', '#/explore/etf', '#/explore/disposition', '#/discipline', '#/discipline/stats', '#/me/settings'];
const SCREEN = readFileSync(new URL('./fixtures/screen.json', import.meta.url), 'utf8');
for (const hash of PAGES) {
  test(`名詞可點：${hash} 隨機 5 個`, async ({ page }) => {
    await page.route('**/data/screen.json', (r) => r.fulfill({ contentType: 'application/json', body: SCREEN }));
    if (hash === '#/mine') await seed(page, { watchlist: [{ code: '2330', group: '預設', addedAt: '2026-01-01' }, { code: '2317', group: '預設', addedAt: '2026-01-01' }] });
    await page.goto(hash);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    const n = await page.locator('.page .term').count();
    expect(n).toBeGreaterThan(0);
    let s = hash.length * 7919;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const pick = [...new Set(Array.from({ length: 5 }, () => Math.floor(rnd() * n)))];
    for (const i of pick) {
      const t = page.locator('.page .term').nth(i);
      await t.scrollIntoViewIfNeeded();
      await t.click();
      const sheet = page.getByTestId('help-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('.help-plain')).not.toBeEmpty();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
  });
}
