/**
 * 探索 › 動能流程（2026-10-09）：資料來自 data 分支（raw.githubusercontent.com），用真實輸出裁切的 fixtures 攔截；
 * 入口卡片、四個分頁、漏斗明細、清單明細、組合試算、持股條件、回測與濾網效度、錯誤狀態、用語限制。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seed } from './helpers';

test.use({ serviceWorkers: 'block' }); // 讓 page.route 攔得到資料檔

const fx = (name: string) => readFileSync(new URL(`./fixtures/momentum/${name}.json`, import.meta.url), 'utf8');
const isMomentum = (u: URL) => u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/momentum_flow/web/');

async function mock(page: Page, fail = false): Promise<void> {
  await page.route(isMomentum, (route) => {
    if (fail) return route.fulfill({ status: 500, body: 'x' });
    const name = new URL(route.request().url()).pathname.split('/').pop()!.replace('.json', '');
    return route.fulfill({ contentType: 'application/json', body: fx(name) });
  });
}

const FORBIDDEN = /買進|賣出|推薦|建議/;

test('探索入口卡片：摘要一行；點進去頁首有資料基準日', async ({ page }) => {
  await mock(page);
  await page.goto('#/explore');
  const tile = page.getByTestId('ex-momentum');
  await expect(tile).toContainText('狀態 1・曝險 100%・篩出 16 檔');
  await tile.click();
  await expect(page).toHaveURL(/#\/explore\/momentum\/market/);
  await expect(page.getByTestId('mf-basis')).toContainText('資料基準日 2026/10/8');
  await expect(page.getByTestId('mf-state-concl')).toHaveText('狀態 1・曝險上限 100%');
  await expect(page.getByTestId('mf-chart')).toBeVisible();
  // 圖的正下方直接列每日原始數據：預設最近 20 日，可顯示全部 250 日
  await expect(page.getByTestId('mf-state-table').locator('tbody tr')).toHaveCount(20);
  await page.getByTestId('mf-state-more').click();
  await expect(page.getByTestId('mf-state-table').locator('tbody tr')).toHaveCount(250);
  await expect(page.locator('.page')).not.toContainText(FORBIDDEN);
});

test('候選：漏斗可點看被濾掉的股票；三個清單；點開一列看 K1–K6 明細', async ({ page }) => {
  await mock(page);
  await page.goto('#/explore/momentum/candidates');
  await expect(page.getByTestId('mf-funnel-concl')).toHaveText('候選 319 檔 → 全通過 16 檔');
  await page.getByTestId('mf-funnel-K3').click();
  const detail = page.getByTestId('mf-funnel-K3-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.mf-chip', { hasText: '2221' })).toHaveCount(1);
  await expect(detail.locator('.mf-chip').first()).toHaveAttribute('href', /#\/stock\//);
  // 篩出 16 檔，第一列 A 級晶豪科 6／6
  const list = page.getByTestId('mf-list');
  await expect(list.locator('.ui-row')).toHaveCount(16);
  const first = page.getByTestId('mf-cand-3006');
  await expect(first).toContainText('晶豪科');
  await expect(first).toContainText('6／6');
  await first.locator('.ui-row').click();
  await expect(first.locator('tbody tr')).toHaveCount(6);
  await expect(first).toContainText('符合');
  await expect(first.getByRole('link', { name: /個股頁/ })).toHaveAttribute('href', '#/stock/3006');
  // 差一項：標示是哪一項
  await page.getByTestId('mf-list-seg').getByRole('button', { name: /差一項/ }).click();
  await expect(page.getByTestId('mf-cand-3189')).toContainText('差 K1');
  await page.getByTestId('mf-list-seg').getByRole('button', { name: /新觸發/ }).click();
  await expect(list.locator('.ui-row')).toHaveCount(6);
  await expect(page.locator('.page')).not.toContainText(FORBIDDEN);
});

test('組合試算：總資金存 localStorage、名額 8／9／10、族群上限、現金列', async ({ page }) => {
  await mock(page);
  await page.goto('#/explore/momentum/candidates');
  const plan = page.getByTestId('mf-plan');
  await expect(plan).toContainText('可用 10／10 名額');
  await expect(page.getByTestId('mf-plan-table').locator('tbody tr')).toHaveCount(10);
  await page.getByTestId('mf-fund').fill('2000000');
  await page.getByTestId('mf-fund').press('Enter'); // change 事件才寫入（輸入中不重算）
  await expect(plan).toContainText('每名額 200,000 元');
  await page.getByTestId('mf-slots').getByRole('button', { name: '8 名額' }).click();
  await expect(plan).toContainText('可用 8／8 名額');
  await expect(page.getByTestId('mf-plan-table').locator('tbody tr')).toHaveCount(8);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tmf-momentum-fund') ?? '{}'))).toEqual({ total: 2000000, slots: 8 });
  await page.reload();
  await expect(page.getByTestId('mf-plan')).toContainText('可用 8／8 名額');
});

test('持股：沒有持股顯示說明；有持股顯示 D1／D2／M1／M2／M3 與檢查日', async ({ page }) => {
  await mock(page);
  await page.goto('#/explore/momentum/holdings');
  await expect(page.getByTestId('mf-review')).toContainText('本期檢查日 9/10・下一個 10/10');
  await expect(page.getByTestId('mf-holdings-state')).toContainText('沒有持股');
  await seed(page, { trades: [{ id: 'mf', code: '2330', name: '台積電', status: 'open', openedAt: '2026-08-03', entry: 500, shares: 1000, stop: 0, target: 0, reasonType: '', checklist: {} }] });
  await page.goto('#/explore/momentum/holdings');
  const card = page.getByTestId('mf-hold-2330');
  await expect(card).toBeVisible();
  for (const c of ['D1', 'D2', 'M1', 'M2', 'M3']) await expect(page.getByTestId(`mf-cond-2330-${c}`)).toBeVisible();
  await expect(page.getByTestId('mf-cond-2330-D2')).toContainText('未觸發'); // 現價 547.96 > 0.85 × 500
  await expect(page.getByTestId('mf-cond-2330-D2')).toContainText('+9.6%');
  await expect(page.getByTestId('mf-cond-2330-M1')).toContainText('R 日 88・今日 84');
  await expect(card).toContainText('權重 100.0%・超過 20%');
  await expect(page.locator('.page')).not.toContainText(FORBIDDEN);
});

test('紀錄：回測摘要、累加／逐年、年份篩選、濾網效度（樣本不足標示）', async ({ page }) => {
  await mock(page);
  await page.goto('#/explore/momentum/records');
  await expect(page.getByTestId('mf-bt-concl')).toHaveText('2023–2026 年化 +35.34%・相對 0050 −24.87%');
  await expect(page.getByTestId('mf-bt-chart')).toBeVisible();
  await page.getByTestId('mf-bt-view').getByRole('button', { name: '逐年' }).click();
  await expect(page.getByTestId('mf-bt-yearly').locator('tbody tr')).toHaveCount(4);
  await page.getByTestId('mf-bt-year').getByRole('button', { name: '2025' }).click();
  await expect(page.getByTestId('mf-bt-yearly').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByTestId('mf-bt-yearly')).toContainText('+20.8%');
  const filters = page.getByTestId('mf-filters-table');
  await expect(filters.locator('tbody tr')).toHaveCount(6);
  await expect(filters.locator('tbody tr').nth(1)).toContainText('樣本不足'); // K2 只有 27 期
  await expect(filters.locator('tbody tr').nth(4)).toContainText('−2.58%'); // K5 濾掉的股票次月反而較強（只報告）
  await expect(page.locator('.page')).not.toContainText(FORBIDDEN);
});

test('資料讀取失敗：只影響本頁（錯誤狀態可重試）；入口卡片顯示「—」', async ({ page }) => {
  await mock(page, true);
  await page.goto('#/explore');
  await expect(page.getByTestId('ex-momentum')).toContainText('—');
  await expect(page.getByTestId('ex-screener')).not.toContainText('讀取失敗');
  await page.goto('#/explore/momentum/market');
  await expect(page.getByTestId('mf-state-root')).toContainText('動能流程資料暫時無法取得');
  await expect(page.getByTestId('mf-basis')).toContainText('資料基準日 —');
});
