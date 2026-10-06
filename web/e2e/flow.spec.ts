import { expect, test } from '@playwright/test';
import { seed } from './helpers';

const CK = { market: '中性', trend: '多頭（年線、季線之上）', revenue: '成長', valuation: '合理', reason: '投信連買' };

test.describe('流程頁（§8）', () => {
  test('今日流程：已完成 n/m、進度環（連續、等級、經驗值）、新手導覽、每日 6 步、每週、名詞圖鑑、工具列表', async ({ page }) => {
    await page.goto('#/discipline');
    await expect(page.getByRole('heading', { level: 1, name: '今日流程' })).toBeVisible();
    await expect(page.locator('.ui-head-sub')).toContainText(/已完成 \d+\/\d+/);
    await expect(page.getByTestId('flow-ring')).toBeVisible();
    for (const id of ['market', 'holdings', 'movers', 'screener', 'entry', 'review']) await expect(page.getByTestId(`step-${id}`)).toBeVisible();
    await expect(page.getByTestId('step-entry')).toContainText('今日不適用');
    await expect(page.getByTestId('step-screener')).toContainText('選做');
    await expect(page.getByTestId('flow-streak')).toContainText(/連續 \d+ 日・最佳 \d+ 日・本月寬限剩 \d/);
    await expect(page.getByTestId('flow-xp')).toContainText(/\d+ \/ \d+/);
    await expect(page.getByTestId('flow-onboard')).toBeVisible();
    await expect(page.getByTestId('step-weekly')).toBeVisible();
    await expect(page.getByTestId('flow-glossary')).toContainText(/已讀 \d+／\d+/);
    for (const name of ['日誌', '新增持倉前檢查表', '個人統計', '成就', '週報', '訊號追蹤']) {
      await expect(page.getByTestId('flow-entries').getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByText(/紀律等級|XP|今晚的紀律/)).toHaveCount(0);
  });

  test('無停損的新持倉：第 5 步待辦，個人統計記「無停損」', async ({ page, request }) => {
    const { date } = await (await request.get('data/summary.json')).json() as { date: string };
    await page.clock.setFixedTime(new Date(`${date}T20:00:00+08:00`));
    await seed(page, { trades: [{ id: 'ns', code: '2330', name: '台積電', status: 'open', openedAt: date, entry: 100, shares: 1000, stop: 0, target: 120, reasonType: '籌碼', checklist: CK }] });
    await page.goto('#/discipline');
    await expect(page.getByTestId('step-entry')).toContainText('待辦');
    await page.goto('#/discipline/stats');
    const v = page.getByTestId('stats-violations');
    await expect(v.getByText('無停損')).toBeVisible();
    await expect(v).toContainText(/無停損\s*1\s*次/);
  });

  test('成就 8 個，每個有條件與進度 n/N', async ({ page }) => {
    await page.goto('#/discipline/badges');
    const rows = page.getByTestId('badges').locator('.ui-row');
    await expect(rows).toHaveCount(8);
    await expect(page.getByTestId('badge-streak_5')).toContainText(/\d+\/5/);
  });

  test('週報：本週流程完成率、違規標籤次數；完成週檢討只記一次', async ({ page }) => {
    await page.goto('#/discipline/weekly');
    await expect(page.getByTestId('weekly-completion')).toBeVisible();
    await expect(page.getByTestId('weekly-violations')).toContainText(/\d+\s*次/);
    await page.getByTestId('weekly-review').click();
    await expect(page.getByTestId('weekly-review-done')).toContainText('已完成');
  });

  test('檢查表帶入：個股頁風險試算的參考價、停損價、股數', async ({ page }) => {
    await page.goto('#/discipline/checklist?code=2330&price=123.5&stop=110&shares=150');
    await page.waitForLoadState('networkidle'); // 資料與延後載入的元件都到齊後再操作
    // 資金環境保守時先出現事實頁（2026-10-06 起不需勾選，「繼續填寫檢查表」直接可按），否則直接是檢查表
    const cont = page.getByRole('button', { name: '繼續填寫檢查表' });
    const shares = page.getByLabel('實際股數');
    await expect(cont.or(shares)).toBeVisible();
    if (await cont.isVisible()) await cont.click();
    await expect(page.getByLabel('進場價')).toHaveValue('123.5');
    await expect(page.getByLabel('6. 停損價（選填）', { exact: true })).toHaveValue('110');
    await expect(shares).toHaveValue('150');
  });
});
