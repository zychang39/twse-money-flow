/**
 * 策略庫分級版（2026-10-02）驗收：
 * 1. 三個區塊（有效／觀察中／停用與未通過）帶數量；第三個預設收合、點擊展開；停用列只顯示一行理由。
 * 2. 排序選單六個選項（有效性排名預設），選擇後重新整理仍保留。
 * 3. 基準預設相對 0050 含息，說明文字固定；可切回等權。
 * 4. 波段策略頁：進場延後表、前瞻驗證卡（累積中文字）、三段固定日曆標籤、10 檔組合段落。
 * 5. 個股頁訊號面板只列分級為有效／觀察中的策略對應指標，並帶分級標籤。
 * 評估資料用 e2e/fixtures 再於測試中補上分級欄位（fixtures 為舊版資料，沒有 grade）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { revealAllSections } from './helpers';

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');

type Item = Record<string, unknown> & { id: string; test: string; label: string; subtitle: string; enabled: boolean; h?: Record<string, unknown> };

/** 把舊版 fixtures 補成分級版：前 3 套有效、接著 4 套觀察中、其餘停用；另加一套合成的波段策略。 */
function graded(): { strategies: Item[] } & Record<string, unknown> {
  const f = JSON.parse(fixture('strategies.json')) as { strategies: Item[] } & Record<string, unknown>;
  f.strategies.forEach((s, i) => {
    const grade = i < 3 ? '有效' : i < 7 ? '觀察中' : '停用';
    Object.assign(s, {
      grade,
      grade_label: grade === '有效' ? '有效・待前瞻驗證' : grade,
      grade_reason: grade === '有效' ? '' : grade === '觀察中' ? `逐年 ≥ 70% 為正：5/8` : `校正後 t 1.${i} < 2`,
      grade_checks: {},
      rank: grade === '停用' ? null : i + 1,
      t_corr: grade === '停用' ? 1 + i / 10 : 4.5 - i * 0.3,
      per_month: 20 - i,
      win: 50 + i,
      family: ['動能', '籌碼', '基本面', '組合'][i % 4],
      excess_h: { '40': 2 - i * 0.3, '20': 1 - i * 0.2 },
      mean_gross_excess: 2.5 - i * 0.3,
      enabled: grade !== '停用',
      split2022: { date: '2022-01-01', pre: { n: 100, mean_excess: 1.1, t: 2.1 }, post: { n: 120, mean_excess: 0.9, t: 1.9 } },
    });
  });
  const seg = (a: string, b: string, n: number) => ({ period: [a, b], n, mean_excess: 1.2, mean_gross_excess: 1.9, t: 2.4, t_corr: 2.2, win: 54, per_month: 12 });
  f.strategies.push({
    id: 'swing_demo', test: 'swing_demo', kind: 'swing', label: '合成波段', subtitle: '測試用・不是真的策略', verdict: '有效', enabled: true, reasons: [], env: null,
    grade: '觀察中', grade_label: '觀察中', grade_reason: '九項上線門檻 7/9', rank: 8, t_corr: 2.6, per_month: 12, win: 54, family: '動能',
    excess_h: { '40': 1.2, '20': 0.8 }, mean_excess: 1.2, t: 2.4, n: 300, definition: '合成', signal_start: '2017-01-03', signal_end: '2026-09-30',
    h: { '40': { n: 300, mean_excess: 1.2, mean_gross_excess: 1.9, t: 2.4 }, '20': { n: 310, mean_excess: 0.8, mean_gross_excess: 1.4, t: 1.8 } },
    health: { status: '正常', recent: 0.5, recent_n: 10, recent_t: 1.1, since: '2026-07-01', long: 1.2 },
    today: [], today_note: '沒有股票首次同時符合全部條件。',
    exit: { rule: 'fixed', param: '40', label: '固定 40 日', stats: {}, alternatives: [] },
    split2022: { date: '2022-01-01', pre: { n: 150, mean_excess: 1.3, t: 2.0 }, post: { n: 150, mean_excess: 1.1, t: 1.7 } },
    forward: { since: '2026-10-02', elapsed_days: 12, required_days: 60, ready: false, signals: 5, completed: 2, mean_excess: null, t: null, backtest_mean_excess: 1.2 },
    swing: {
      hold: 40, params: { k: 1 },
      segments: { dev: seg('2017-01-03', '2022-01-01', 120), val: seg('2022-01-01', '2024-11-01', 100), test: seg('2024-11-01', '2026-09-30', 80) },
      split: { dev: ['2017-01-03', '2022-01-01'], val: ['2022-01-01', '2024-11-01'], test: ['2024-11-01', '2026-09-30'] },
      gates: {
        checks: { net_40_20: true, t_corrected: false, segments: true, years: true, perturb: true, delays: true, per_month: true, win_payoff: false, portfolio: true },
        labels: { net_40_20: '40 與 20 日扣成本超額皆 > 0', t_corrected: '校正後 t ≥ 3', segments: '三段皆 > 0', years: '逐年 ≥ 70% 為正', perturb: '參數 ±20% 皆 > 0', delays: '延後 1、3 日 ≥ 原本 50%', per_month: '每月觸發 ≥ 10', win_payoff: '勝率與賺賠比', portfolio: '10 檔組合年化 > 等權' },
        passed: false,
      },
      perturb: [{ param: 'k', mult: 0.8, value: 0.8, mean_excess: 1.0, n: 290 }, { param: 'k', mult: 1.2, value: 1.2, mean_excess: 1.3, n: 310 }],
      delays: [{ delay: 1, n: 298, mean_excess: 0.9, t: 1.9 }, { delay: 3, n: 295, mean_excess: 0.7, t: 1.5 }],
      dist: { win: 54, avg_win: 6.1, avg_loss: -4.2, payoff: 1.45, loss_streak: { max: 6, p50: 2, p90: 4 }, mae_p50: -3.1, mae_p90: -8.2 },
      portfolio: { days: 2300, ann_return: 14.2, vol_ann: 18.1, sharpe: 0.78, mdd: -22.4, dd_days: 210, slots: 10, executed: 410, skipped_full: 35, skipped_rule: 60, turnover: 4.3, trades_per_year: 43, bench_ew: { ann_return: 9.8, mdd: -28.1 }, bench_0050: { ann_return: 12.1, mdd: -30.2 }, ann_vs_ew: 4.4, ann_vs_0050: 2.1, mdd_ratio_ew: 0.8 },
      full: { ...seg('2017-01-03', '2026-09-30', 300), t_corr_method: 'min', concentration: { dates: 250, ratio: 0.11, top5pct_share: 0.22 }, bench: { ew: { mean_excess: 1.2, t: 2.4, win: 54 }, '0050': { mean_excess: 0.6, t: 1.1, win: 51 } } },
      other: { hold: 20, ...seg('2017-01-03', '2026-09-30', 310) },
      forward: { since: '2026-10-02', elapsed_days: 12, required_days: 60, ready: false, signals: 5, completed: 2, mean_excess: null, t: null, backtest_mean_excess: 1.2 },
      test_note: '最終測試段 2024-11 起上一輪已查看兩次，非全新樣本',
    },
  } as Item);
  f.selection = { counts: { 有效: 3, 觀察中: 5, 停用: 6 } };
  return f;
}

async function useFixtures(page: Page) {
  const files = ['evidence.json', 'evidence_today.json', ...readdirSync(new URL('evidence/', FIX)).map((f) => `evidence/${f}`)];
  for (const f of files) await page.route(`**/data/${f}`, (route) => route.fulfill({ contentType: 'application/json', body: fixture(f) }));
  const body = JSON.stringify(graded());
  await page.route('**/data/strategies.json', (route) => route.fulfill({ contentType: 'application/json', body }));
}

test.describe('策略庫分級版', () => {
  test.use({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });

  test('三個區塊帶數量；停用與未通過預設收合、點擊展開；停用列只顯示理由', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies');
    await expect(page.getByRole('heading', { name: '有效（3）' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '觀察中（5）' })).toBeVisible();
    const fold = page.getByRole('button', { name: '停用與未通過（6）' });
    await expect(fold).toBeVisible();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('st-sec-停用-list')).toHaveCount(0);
    const box = (await fold.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // 有效區塊：分級標籤與一行數字
    const valid = page.getByTestId('st-sec-有效-list');
    await expect(valid.locator('.ev-row')).toHaveCount(3);
    await expect(valid.getByTestId('grade-tag').first()).toHaveText('有效・待前瞻驗證');
    // 2026-10-02 健檢：卡片改成 2×2 指標格；判定（等權）兩格固定、相對基準一格隨切換
    const grid = valid.getByTestId('st-metrics').first();
    await expect(grid).toContainText('校正後 t（判定・等權）');
    await expect(grid).toContainText('40 日扣成本超額（判定・等權）');
    await expect(grid).toContainText('40 日超額（相對 0050 含息）');
    await expect(grid).toContainText(/超額勝率 \d+\.\d{2}%/);
    await expect(grid).toContainText('每月觸發');
    // 展開第三區塊
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    const off = page.getByTestId('st-sec-停用-list');
    await expect(off.locator('.ev-row')).toHaveCount(6);
    await expect(off.locator('.ev-row').first().locator('.ev-sub')).toHaveCount(2);
    await expect(off.locator('.ev-row').first().locator('.ev-sub').nth(1)).toContainText('校正後 t 1.');
    await expect(off.getByTestId('st-metrics')).toHaveCount(0);
    await expect(off.getByTestId('grade-tag').first()).toHaveText('停用');
    await expect(off.getByTestId('grade-tag').first()).toHaveClass(/muted/);
    await expect(page.getByTestId('cost-note')).toHaveText('回測成本：牌告手續費 0.1425%×2、證交稅 0.3%、滑價 0.1%×2；個人試算用你在設定的券商折扣。');
  });

  test('排序選單六個選項、預設有效性排名，選擇後重新整理仍保留', async ({ page }) => {
    await useFixtures(page);
    // 用等權（判定基準）比較：fixtures 的 40 日扣成本超額隨索引遞減，與排名順序相同
    await page.addInitScript(() => { try { localStorage.setItem('tmf-bench', 'ew'); } catch { /* 私密瀏覽 */ } });
    await page.goto('./#/explore/strategies');
    await expect(page.getByTestId('sort-now-strategies')).toHaveText('排序：有效性排名・排名前的在前');
    const valid = page.getByTestId('st-sec-有效-list');
    await expect(valid.locator('.ev-label').first()).toBeVisible();
    const names = (await valid.locator('.ev-label').allTextContents()).map((s) => s.trim());
    const btn = page.getByRole('button', { name: '排序', exact: true });
    await btn.click();
    const menu = page.getByRole('menu', { name: '排序方式' });
    await expect(menu).toBeVisible();
    const items = menu.locator('[role="menuitemradio"]');
    const labels = (await items.allTextContents()).map((s) => s.replace(' ✓', '').trim());
    expect(labels.slice(0, 6)).toEqual(['有效性排名（預設）', '校正後 t', '40 日扣成本超額', '勝率', '每月觸發數', '類別']);
    await menu.getByRole('menuitemradio', { name: '40 日扣成本超額' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('sort-now-strategies')).toHaveText('排序：40 日扣成本超額・由高到低');
    // 三個區塊共用同一個排序：有效區塊的順序依 40 日超額由高到低（fixtures 的超額隨索引遞減 → 與排名順序相同）
    expect((await valid.locator('.ev-label').allTextContents()).map((s) => s.trim())).toEqual(names);
    await btn.click();
    await page.getByRole('menuitemradio', { name: '由低到高' }).click();
    expect((await valid.locator('.ev-label').allTextContents()).map((s) => s.trim())).toEqual([...names].reverse());
    await page.reload();
    await expect(page.getByTestId('sort-now-strategies')).toHaveText('排序：40 日扣成本超額・由低到高');
    expect((await valid.locator('.ev-label').allTextContents()).map((s) => s.trim())).toEqual([...names].reverse());
    // 類別：筆畫順序
    await btn.click();
    await page.getByRole('menuitemradio', { name: '類別' }).click();
    await expect(page.getByTestId('sort-now-strategies')).toHaveText('排序：類別・筆畫少到多');
  });

  test('基準預設相對 0050 含息，說明固定；可切回等權', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies');
    const bar = page.getByTestId('bench-switch');
    await expect(bar.getByRole('button', { name: '0050' })).toHaveAttribute('aria-pressed', 'true');
    // 判定天數＝strategies.json 的主要持有天數（fixtures 為 10、真實資料為 40）
    await expect(page.locator('.bench-note')).toContainText(`判定一律用同日等權（${graded().horizon} 日、扣成本），不隨切換改變`);
    await expect(page.locator('.bench-note')).toContainText('目前：0050 含息持有不動');
    await bar.getByRole('button', { name: '等權' }).click();
    await expect(bar.getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('st-sec-有效-list').getByTestId('st-metrics').first()).not.toContainText('相對 0050');
    await expect(page.getByTestId('st-sec-有效-list').getByTestId('st-metrics').first()).toContainText('超額勝率（相對等權）');
    await expect(page.getByTestId('st-sec-有效-list').getByTestId('st-metrics').first()).toContainText('絕對勝率');
    await page.reload();
    await expect(bar.getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('波段策略頁：三段固定日曆、進場延後、前瞻驗證、10 檔組合、分級理由與 2022 前後', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies/swing_demo');
    await expect(page.getByRole('heading', { name: '合成波段' })).toBeVisible();
    await expect(page.getByTestId('grade-tag').first()).toHaveText('觀察中');
    await expect(page.getByTestId('grade-reason')).toHaveText('九項上線門檻 7/9'); // fixtures 的字串原樣顯示（實際資料由 pipeline 寫成「未達：…」）
    await expect(page.getByTestId('split2022')).toContainText('2022 前 +1.30%（t 2.00、150 筆）／後 +1.10%（t 1.70、150 筆）');
    const seg = page.getByRole('table', { name: '開發、驗證、最終測試三段的超額報酬' });
    // 2026-10-02 健檢：段名一行、日期第二行小字
    await expect(seg.locator('tbody tr').nth(0).locator('.seg-name')).toHaveText('開發');
    await expect(seg.locator('tbody tr').nth(0).locator('.th-unit')).toHaveText('2017-01～2021-12');
    await expect(seg.locator('tbody tr').nth(1).locator('.th-unit')).toHaveText('2022-01～2024-10');
    await expect(seg.locator('tbody tr').nth(2).locator('.th-unit')).toHaveText('2024-11 起');
    await expect(seg.locator('tbody tr').nth(3).locator('.th-unit')).toHaveText('40 日');
    await expect(seg.locator('tbody tr').nth(4).locator('.th-unit')).toHaveText('20 日');
    await expect(seg.locator('thead')).toContainText('毛超額');
    await expect(seg.locator('thead')).toContainText('扣成本超額');
    await expect(page.getByRole('heading', { name: '上線門檻（7／9 項通過）' })).toBeVisible();
    // 只列未達的 2 項；展開才看全部 9 項
    await expect(page.getByTestId('swing-gates').locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: '看全部 9 項門檻' }).click();
    await expect(page.getByTestId('swing-gates-all').locator('li')).toHaveCount(9);
    await expect(page.getByRole('heading', { name: '進場延後' })).toBeVisible();
    const delays = page.getByTestId('swing-delays');
    await expect(delays.locator('tbody tr')).toHaveCount(3);
    await expect(delays.locator('tbody tr').nth(0)).toContainText('0 日');
    await expect(delays.locator('tbody tr').nth(0)).toContainText('+1.20%');
    await expect(delays.locator('tbody tr').nth(2)).toContainText('3 日');
    await expect(page.getByRole('heading', { name: /^前瞻驗證/ })).toBeVisible();
    await expect(page.getByTestId('swing-forward')).toContainText('資料累積中：合併後第 12／60 個交易日（5 個訊號、2 筆已出場）');
    // 2026-10-02 健檢：10 檔組合摘要改成指標格（百分比 2 位）
    const port = page.getByTestId('swing-portfolio');
    await expect(port).toContainText('年化報酬');
    await expect(port).toContainText('+14.20%');
    await expect(port).toContainText('等權基準 +9.80%・0050 含息 +12.10%');
    await expect(port).toContainText('最大回撤');
    await expect(port).toContainText('−22.40%');
    await expect(port).toContainText('比值 0.80');
    await expect(port).toContainText('210 日');
    await expect(port).toContainText('410 筆');
    await expect(port).toContainText('每槽 4.3 次／年');
    await expect(page.getByText('最終測試段 2024-11 起上一輪已查看兩次，非全新樣本')).toBeVisible();
    await expect(page.getByTestId('cost-note')).toBeVisible();
  });

  test('示範資料（pipeline 實際輸出）：三個區塊、波段策略頁沒有 JS 錯誤且有進場延後與前瞻驗證', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./#/explore/strategies');
    await expect(page.getByRole('heading', { name: /^有效（\d+）$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^觀察中（\d+）$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^停用與未通過（\d+）$/ })).toHaveAttribute('aria-expanded', 'false');
    const file = (await (await page.request.get('./data/strategies.json')).json()) as { strategies: { id: string; kind?: string; swing?: unknown }[] };
    const sw = file.strategies.find((x) => x.kind === 'swing' && x.swing);
    expect(sw, '示範資料應有至少一套波段策略').toBeTruthy();
    await page.goto(`./#/explore/strategies/${sw!.id}`);
    await expect(page.getByRole('heading', { name: '進場延後' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^前瞻驗證/ })).toBeVisible();
    await expect(page.getByTestId('swing-forward')).toContainText(/資料累積中|前瞻扣成本超額/);
    await page.getByRole('button', { name: /看全部 \d+ 項門檻/ }).click();
    await expect(page.getByTestId('swing-gates-all').locator('li')).toHaveCount(9);
    expect(errors).toEqual([]);
  });

  test('個股頁訊號面板只列有效／觀察中的策略對應指標，並帶分級標籤', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/stock/2330');
    await revealAllSections(page);
    const panel = page.getByTestId('signal-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.ev-label').first()).toBeVisible();
    const g = graded();
    const allowed = new Set(g.strategies.filter((s) => s.grade !== '停用').map((s) => s.test));
    const ev = JSON.parse(fixture('evidence.json')) as { rows: { id: string; label: string; kind: string }[] };
    // 2026-10-02 健檢：有策略的指標顯示策略名（全站名稱表）
    const byTest = new Map(g.strategies.map((s) => [s.test, s.label]));
    const expected = ev.rows.filter((r) => r.kind === 'event' && allowed.has(r.id)).map((r) => byTest.get(r.id) ?? r.label).sort();
    const shown = (await panel.locator('.ev-label').allTextContents()).map((s) => s.trim()).sort();
    expect(shown).toEqual(expected);
    expect(shown.length).toBeGreaterThan(0);
    await expect(panel.getByTestId('grade-tag')).toHaveCount(shown.length);
    // 標籤前綴「策略分級」是給 VoiceOver 分辨「指標判定」與「策略分級」用的（2026-10-02 健檢 M1-2）
    const tags = (await panel.getByTestId('grade-tag').allTextContents()).map((s) => s.trim().replace(/^策略分級\s*/, ''));
    for (const t of tags) expect(['有效・待前瞻驗證', '觀察中']).toContain(t);
  });
});
