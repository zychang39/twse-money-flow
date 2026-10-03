/**
 * 策略庫（2026-10-03 改版）驗收：
 * 1. 清單：上架一張卡（名稱｜副標條件｜單一分級標籤）；無效收在摺疊列，點擊展開。
 * 2. 策略頁版面順序：規則 → 判定 → 健康度 → 事件研究 → 組合回測 → 出場規則 → 樣本與成本 → 新觸發；
 *    判定卡兩格並排（(a) 機會成本・0050、(b) 訊號檢定・等權），只有一個 t 名稱（校正後 t）；不再出現 alpha 耗盡與舊出場字樣。
 * 3. 基準分段控制預設 0050、可切回等權並記住。
 * 4. 波段策略：上線門檻在 bottom sheet。
 * 5. 個股頁策略訊號：只列上架策略、每列一個分級標籤、副資訊兩個基準的超額與 t、右側觸發日或未觸發。
 * 評估資料用 e2e/fixtures 再於測試中補上 2026-10-03 的欄位（fixtures 為舊版資料）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { revealAllSections } from './helpers';

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');

type Item = Record<string, unknown> & { id: string; test: string; label: string; subtitle: string; enabled: boolean };
const GRADES = ['valid', 'sig_only', 'watch', 'watch', 'watch'] as const;
const LABEL: Record<string, string> = { valid: '有效', sig_only: '訊號顯著・未勝 0050', watch: '觀察中', invalid: '無效' };

/** 舊版 fixtures → 2026-10-03 欄位：前 5 套上架（有效 1、訊號顯著 1、觀察中 3），其餘無效；另加一套合成的波段策略。 */
function graded(): { strategies: Item[] } & Record<string, unknown> {
  const f = JSON.parse(fixture('strategies.json')) as { strategies: Item[] } & Record<string, unknown>;
  f.strategies.forEach((s, i) => {
    const g: string = GRADES[i] ?? 'invalid';
    Object.assign(s, {
      grade: { id: g, label: LABEL[g], notes: g === 'valid' ? ['待前瞻驗證'] : i === 4 ? ['樣本不足'] : [], reasons: g === 'valid' ? [] : [`相對 0050 t 1.${i}0（門檻 ≥ 2.0）`] },
      grade_label: LABEL[g],
      enabled: g !== 'invalid',
      today: i === 0 ? [] : s.today,
      judge: {
        horizon: 40, t_name: '校正後 t',
        sig: { bench: 'ew', excess: 1.68 - i * 0.1, t: 4 - i * 0.3, n: 6743 - i, dates: 113 },
        opp: { bench: '0050', excess: 1.24 - i * 0.1, t: 1.3, win: 42.05, n: 6700, slots: 5, period: ['2017-03-07', '2026-10-02'], port: { cagr: 16.4, sharpe: 0.59, mdd: -50.4 }, bench_port: { cagr: 25.8, sharpe: 1.22, mdd: -34 } },
      },
      health: { status: '與長期一致', recent: 3.311, recent_n: 442, recent_t: 1.7, since: '2026-05-11', long: { excess: 1.681 }, recent60: { excess: 3.311, n: 442 } },
      yearly: [{ year: '2025', port: 30.1, bench: 40.2, diff: -10.1 }, { year: '2026', port: 12.3, bench: 20, diff: -7.7 }],
      event: { horizon: 40, yearly: [{ year: '2025', excess: 3.59, n: 700 }, { year: '2026', excess: 1.83, n: 500 }] },
      exits: {
        train_end: '2021-12-31', oos_start: '2022-01-01', metric: '樣本內相對 0050 平均超額（扣成本）', min_events: 30, max_days: 60,
        rules: [
          { rule: 'fixed', param: '60', label: '固定 60 日', chosen: true, in_sample: { n: 2668, rel: { '0050': 2.35 } }, oos: { n: 3019, rel: { '0050': 0.66 } } },
          { rule: 'peak', param: '57', label: '峰值日固定出場（第 57 日）', chosen: false, in_sample: { n: 2600, rel: { '0050': 2.1 } }, oos: { n: 3000, rel: { '0050': 0.5 } } },
        ],
        chosen: { rule: 'fixed', param: '60', label: '固定 60 日', basis: 'in_sample' }, note: null,
      },
      selection: { rule_text: '依訊號日成交值由大到小填入', random: { n: 200, runs: 200, seed: 20261003, slots: 5, cagr: { p5: 9.7, p50: 21.5, p95: 36.8 }, mdd: { p5: -54.2, p50: -44, p95: -34.6 } }, spec: { cagr: 16.4, mdd: -50.4 } },
      sample: { includes_delisted: true, universe_text: '上市櫃普通股', delisted_stocks: 1, delisted_events: 0 },
      leverage: { slots: 5, window: 40, port_mdd: -50.4, port_max_adverse: -42.5, by_slots: { 1: { port_mdd: -90, port_max_adverse: -55 }, 3: { port_mdd: -50, port_max_adverse: -44 }, 5: { port_mdd: -50.4, port_max_adverse: -42.5 }, 10: { port_mdd: -45, port_max_adverse: -40 } } },
    });
  });
  f.strategies.push({
    id: 'swing_demo', test: 'swing_demo', kind: 'swing', label: '合成波段', subtitle: '測試用・不是真的策略', verdict: '有效', enabled: true, reasons: [], env: null,
    grade: { id: 'watch', label: '觀察中', notes: [], reasons: ['訊號檢定 t 2.60（門檻 ≥ 3.0）'] }, grade_label: '觀察中',
    judge: { horizon: 40, t_name: '校正後 t', sig: { bench: 'ew', excess: 1.2, t: 2.6, n: 300 }, opp: { bench: '0050', excess: 0.6, t: 1.1, win: 51, n: 300, slots: 5, period: null, port: { cagr: 14, sharpe: 0.8, mdd: -22 }, bench_port: { cagr: 12, sharpe: 0.9, mdd: -30 } } },
    today: [],
    swing: {
      hold: 40, params: { k: 1 }, segments: {}, split: {},
      gates: { checks: { net_40_20: true, t_corrected: false }, labels: { net_40_20: '40 與 20 日扣成本超額皆 > 0', t_corrected: '校正後 t ≥ 3' }, passed: false },
      delays: [{ delay: 1, n: 298, mean_excess: 0.9, t: 1.9 }],
      forward: { since: '2026-10-02', elapsed_days: 12, required_days: 60, ready: false, signals: 5, completed: 2, mean_excess: null, t: null, backtest_mean_excess: 1.2 },
    },
  } as Item);
  f.judge_meta = { horizon: 40, slots: 5, t_name: '校正後 t', t_text: '校正後 t＝三者取絕對值最小', bench_text: { ew: '相對同日等權', '0050': '相對 0050' }, grade_rule: '有效＝…', selection_rule: '…', random: { n: 200, seed: 20261003 }, exits_train_end: '2021-12-31', exit_note: '固定 40 日', trigger_window: 40, sample: { includes_delisted: true, universe_stocks: 1689, stopped_stocks: 77, official_delisted: 41, universe_text: '上市櫃普通股', revenue_timing: '次月 10 日' } };
  f.multi_test = { M: 238, parts: { indicators: 108, swing_trials: 11, horizons: 2 }, t_min: 3, expected_false_t2: 10.8, expected_false: 0.64, bonferroni_t: 3.71, reason: 't ≥ 3.0 對應雙尾 p ≈ 0.27%' };
  return f;
}

async function useFixtures(page: Page, today?: Record<string, unknown>) {
  const files = ['evidence.json', ...readdirSync(new URL('evidence/', FIX)).map((f) => `evidence/${f}`)];
  for (const f of files) await page.route(`**/data/${f}`, (route) => route.fulfill({ contentType: 'application/json', body: fixture(f) }));
  const t = today ?? JSON.parse(fixture('evidence_today.json'));
  await page.route('**/data/evidence_today.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(t) }));
  const body = JSON.stringify(graded());
  await page.route('**/data/strategies.json', (route) => route.fulfill({ contentType: 'application/json', body }));
}

test.describe('策略庫（2026-10-03）', () => {
  test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

  test('清單：上架一張卡、每列一個分級標籤；無效預設收合', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies');
    const listed = page.getByTestId('st-sec-listed-list');
    await expect(listed.locator('.ui-row')).toHaveCount(6); // 5 套＋合成波段
    await expect(listed.getByTestId('grade-tag').first()).toHaveText('有效');
    await expect(listed.getByTestId('grade-tag').nth(1)).toHaveText('訊號顯著・未勝 0050');
    for (const row of await listed.locator('.ui-row').all()) await expect(row.getByTestId('grade-tag')).toHaveCount(1);
    const off = page.getByTestId('st-sec-off-list');
    await expect(off.getByTestId('grade-tag')).toHaveCount(0);
    await page.getByTestId('st-fold').click();
    await expect(off.getByTestId('grade-tag')).toHaveCount(8);
    await expect(off.getByTestId('grade-tag').first()).toHaveText('無效');
  });

  test('策略頁：版面順序、判定卡兩格、單一 t 名稱、健康度一列、沒有舊字樣', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies/near_high');
    await expect(page.getByTestId('st-today')).toBeVisible();
    const titles = (await page.locator('.ui-sec-title').allTextContents()).map((s) => s.trim());
    expect(titles).toEqual(['規則', '判定', '健康度', '事件研究', '組合回測', '出場規則', '樣本與成本', '新觸發']);
    await expect(page.getByTestId('grade-tag')).toHaveCount(1);
    const grid = page.getByTestId('st-judge-grid');
    await expect(grid).toContainText('(a) 機會成本・0050');
    await expect(grid).toContainText('(b) 訊號檢定・等權');
    await expect(page.getByTestId('judge-opp')).toContainText('+1.24');
    await expect(page.getByTestId('judge-sig')).toContainText('+1.68');
    await expect(page.getByTestId('st-health')).toContainText('近 60 日');
    await expect(page.getByTestId('st-health')).toContainText('(442 筆)｜長期');
    await expect(page.getByTestId('st-yearly')).toContainText('差額');
    await expect(page.getByTestId('st-random')).toContainText('中位數');
    await expect(page.getByTestId('st-exits')).toContainText('樣本外');
    await expect(page.getByTestId('st-delisted')).toContainText('是');
    await expect(page.getByTestId('today-empty')).toHaveText('9/29 無新觸發');
    const body = await page.locator('.page').innerText();
    for (const old of ['alpha 耗盡', '峰值日固定出場', '今天沒有新觸發', 'METHODOLOGY', '日曆時間法 t']) expect(body).not.toContain(old);
    // t 只叫「校正後 t」
    expect(body.match(/(?<!校正後 )\bt\b(?= ?[0-9−-])/g) ?? []).toEqual([]);
  });

  test('基準預設 0050，可切回等權並記住', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies/near_high');
    const bar = page.getByTestId('bench-switch');
    await expect(bar.getByRole('button', { name: '0050' })).toHaveAttribute('aria-pressed', 'true');
    await bar.getByRole('button', { name: '等權' }).click();
    await expect(bar.getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('st-event')).toContainText('累積超額・相對等權');
    await page.reload();
    await expect(page.getByTestId('bench-switch').getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('波段策略：上線門檻在 bottom sheet', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies/swing_demo');
    await expect(page.getByRole('heading', { name: '合成波段' })).toBeVisible();
    await page.getByTestId('st-gates').click();
    await expect(page.getByRole('dialog', { name: '上線門檻' })).toBeVisible();
  });

  test('示範資料（pipeline 實際輸出）：清單與每一套策略頁沒有 JS 錯誤', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./#/explore/strategies');
    await expect(page.getByTestId('st-sec-listed')).toBeVisible();
    const file = (await (await page.request.get('./data/strategies.json')).json()) as { strategies: { id: string }[] };
    for (const s of file.strategies.slice(0, 4)) {
      await page.goto(`./#/explore/strategies/${s.id}`);
      await expect(page.locator('.ui-large')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('個股頁策略訊號：只列上架策略、一個分級標籤、兩個基準、觸發日', async ({ page }) => {
    const t = JSON.parse(fixture('evidence_today.json'));
    t.window = 40;
    t.strategies = { near_high: { window: 40, t: { 2330: '2026-09-10' } } };
    await useFixtures(page, t);
    await page.goto('./#/stock/2330');
    await revealAllSections(page);
    const panel = page.getByTestId('signal-panel');
    await expect(panel).toBeVisible();
    const rows = panel.locator('.ui-row');
    await expect(rows).toHaveCount(6);
    await expect(panel.getByTestId('grade-tag')).toHaveCount(6);
    await expect(panel.getByTestId('signal-near_high')).toContainText('觸發 9/10');
    await expect(panel.getByTestId('signal-near_high')).toContainText('0050 +1.24%(t 1.30)｜等權 +1.68%(t 4.00)');
    await expect(panel.getByTestId('signal-top_decile')).toContainText('未觸發');
    await expect(panel).not.toContainText('指標判定');
  });
});
