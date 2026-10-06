/**
 * 2026-10-06 新增持倉前檢查表重做的驗收：
 * a. 資料完整的股票：1–5 全部已帶出，不需任何選擇即可填股數送出（停損未填 → 持股列表「未設停損」）。
 * b. 事實頁與檢查表每一列都能點進說明頁，四段內容齊全；門檻數字與設定檔一致。
 * c. iPhone 18 Pro 寬度（402pt）與 375pt：各列數值右對齊、基線一致、名稱不換行。
 * d. 資料落後、資料不足、無本益比三種情境。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' }); // 讓 page.route 攔得到資料檔（service worker 會繞過攔截）

const thresholds = readFileSync(new URL('../../config/thresholds.yml', import.meta.url), 'utf8');
const cfgNum = (key: string) => Number(thresholds.match(new RegExp(`${key}:\\s*(-?[\\d.]+)`))![1]);

async function openChecklist(page: Page, code = '2330') {
  await page.goto(`#/discipline/checklist?code=${code}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('calm-card').or(page.getByTestId('checklist-form'))).toBeVisible();
}
async function toForm(page: Page) {
  const cont = page.getByRole('button', { name: '繼續填寫檢查表' });
  if (await cont.isVisible()) await cont.click();
  await expect(page.getByTestId('checklist-form')).toBeVisible();
}
const back = (page: Page) => page.getByTestId('sheet-back').click();

/** 改寫 summary.json 裡某一檔的欄位（summary 是 columns＋rows 的表格格式） */
async function patchSummary(page: Page, code: string, patch: Record<string, unknown>) {
  await page.route('**/data/summary.json', async (route) => {
    const res = await route.fetch();
    const s = await res.json() as { columns: string[]; rows: unknown[][] };
    const ci = s.columns.indexOf('code');
    for (const r of s.rows) if (r[ci] === code) for (const [k, v] of Object.entries(patch)) r[s.columns.indexOf(k)] = v;
    await route.fulfill({ response: res, json: s });
  });
}

test('a. 資料完整的股票：1–5 已帶出，不選任何項目即可填股數送出；快照存 auto；未設停損標籤', async ({ page }) => {
  await openChecklist(page);
  await toForm(page);
  const list = page.getByTestId('ck-items');
  for (const k of ['market', 'trend', 'revenue', 'valuation', 'reasonType']) await expect(page.getByTestId(`ck-row-${k}`)).toBeVisible();
  await expect(list).not.toContainText('資料不足');
  await expect(list.locator('select')).toHaveCount(0);
  // 理由草稿已帶入（只寫事實）
  const draft = await page.getByLabel('理由（選填，建議填寫供復盤）').inputValue();
  expect(draft.length).toBeGreaterThan(0);
  expect(draft).not.toMatch(/買進|賣出|推薦|建議/);
  await page.getByLabel('實際股數').fill('1000');
  const submit = page.getByTestId('checklist-submit');
  await expect(submit).toHaveText('加入持倉');
  await submit.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const trade = await page.evaluate(() => new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = indexedDB.open('twse-money-flow');
    req.onsuccess = () => {
      const g = req.result.transaction('trades').objectStore('trades').getAll();
      g.onsuccess = () => resolve(g.result[0]);
      g.onerror = () => reject(g.error);
    };
  }));
  expect(trade).toMatchObject({ code: '2330', shares: 1000, stop: 0, target: 0, checklistDone: true });
  const snap = trade.checklistSnapshot as { items: Record<string, { source: string; result: string | null; date: string | null }> };
  for (const k of ['market', 'trend', 'revenue', 'valuation', 'reasonType']) {
    expect(snap.items[k].source, k).toBe('auto');
    expect(snap.items[k].result, k).toBeTruthy();
  }
  await page.goto('#/mine?seg=hold');
  await expect(page.getByTestId('no-stop-tag').first()).toHaveText('未設停損');
});

test('b. 事實頁與檢查表每一列都能點進說明頁，四段齊全；門檻與設定檔一致；手動調整可一鍵還原', async ({ page }) => {
  await openChecklist(page);
  // 示範資料的資金環境為保守 → 事實頁；沒有勾選框
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const factRows = page.getByTestId('fact-env').locator('.ui-row');
  const n = await factRows.count();
  expect(n).toBe(5);
  for (let i = 0; i < n; i++) {
    await factRows.nth(i).click();
    const doc = page.getByTestId('fact-doc');
    await expect(doc).toBeVisible();
    for (const t of ['這是什麼', '為什麼進場前要看', '目前數值與判定門檻', '近期走勢']) await expect(doc.getByRole('heading', { name: t })).toBeVisible();
    await expect(doc.getByTestId('doc-source')).toContainText('資料來源：');
    await back(page);
    await expect(page.getByTestId('fact-doc')).toHaveCount(0);
  }
  await page.getByTestId('fact-futures').click();
  await expect(page.getByTestId('ck-rules')).toContainText(`≥ ${cfgNum('bullish_above')} 口：偏多`);
  await expect(page.getByTestId('ck-rules')).toContainText(`≤ −${Math.abs(cfgNum('bearish_below')).toLocaleString('en-US')} 口：偏空`);
  // 有歷史資料：小圖下方直接列出原始數值
  await expect(page.getByTestId('doc-mini')).toBeVisible();
  await expect(page.getByTestId('doc-table').locator('tbody tr')).toHaveCount(20);
  await back(page);
  await page.getByTestId('fact-ma240').click();
  await expect(page.getByTestId('ck-rules')).toContainText(`乖離 > +${cfgNum('neutral_band')}%：偏多`);
  await back(page);

  await toForm(page);
  for (const k of ['market', 'trend', 'revenue', 'valuation', 'reasonType']) {
    await page.getByTestId(`ck-row-${k}`).click();
    const doc = page.getByTestId('item-doc');
    await expect(doc).toBeVisible();
    for (const t of ['這是什麼', '為什麼看', '判定規則與現值', '資料來源', '手動調整']) await expect(doc.getByRole('heading', { name: t })).toBeVisible();
    await back(page);
  }
  // 手動調整 → 列上顯示「手動」→ 一鍵還原
  await page.getByTestId('ck-row-trend').click();
  await page.getByRole('radio', { name: '多頭（年線、季線之上）' }).click();
  await back(page);
  await expect(page.getByTestId('ck-item-trend').getByTestId('ck-manual')).toHaveText('手動');
  await page.getByTestId('ck-restore-trend').click();
  await expect(page.getByTestId('ck-item-trend').getByTestId('ck-manual')).toHaveCount(0);
});

for (const [w, h] of [[402, 874], [375, 812]] as const) {
  test(`c. ${w}pt：各列數值右對齊、與名稱同基線、名稱不換行`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openChecklist(page);
    const check = async (testid: string) => {
      const rows = await page.getByTestId(testid).evaluate((list) => [...list.querySelectorAll<HTMLElement>('.ui-row')].map((r) => {
        const label = r.querySelector<HTMLElement>('.ui-row-label')!.getBoundingClientRect();
        const v = r.querySelector<HTMLElement>('.ui-row-value')!.getBoundingClientRect();
        const ui = r.querySelector<HTMLElement>('.ui-v')?.getBoundingClientRect() ?? null;
        const lh = parseFloat(getComputedStyle(r.querySelector('.ui-row-label')!).lineHeight);
        return { right: v.right, labelH: label.height, lh, labelBottom: label.bottom, vBottom: ui?.bottom ?? null };
      }));
      const rights = rows.map((r) => r.right);
      expect(Math.max(...rights) - Math.min(...rights), `${testid} 右緣`).toBeLessThan(1);
      for (const r of rows) {
        expect(r.labelH, `${testid} 名稱一行`).toBeLessThan(r.lh * 1.5);
        if (r.vBottom !== null) expect(Math.abs(r.vBottom - r.labelBottom), `${testid} 基線`).toBeLessThan(2);
      }
    };
    await check('fact-env');
    await toForm(page);
    await check('ck-items');
    // 沒有左右捲動
    expect(await page.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test('d1. 資料落後：資金指標資料日早於最新交易日 → 列上標「資料落後」', async ({ page }) => {
  await page.route('**/data/market.json', async (route) => {
    const res = await route.fetch();
    const m = await res.json() as { env: { lights: { id: string; date?: string; state: string }[] } };
    const f = m.env.lights.find((l) => l.id === 'futures')!;
    f.date = '2026-09-01';
    f.state = 'red'; // 確保出現事實頁
    await route.fulfill({ response: res, json: m });
  });
  await openChecklist(page);
  await expect(page.getByTestId('fact-futures').getByTestId('ck-stale')).toHaveText('資料落後');
  await expect(page.getByTestId('fact-fx').getByTestId('ck-stale')).toHaveCount(0);
  await page.getByTestId('fact-futures').click();
  await expect(page.getByTestId('doc-source')).toContainText('資料落後');
});

test('d2. 資料不足：算不出年線 → 該列「資料不足」並退回手動選單，仍可送出', async ({ page }) => {
  await patchSummary(page, '2330', { ma240_gap: null });
  await openChecklist(page);
  await toForm(page);
  const item = page.getByTestId('ck-item-trend');
  await expect(item).toContainText('資料不足');
  const sel = item.locator('select');
  await expect(sel).toBeVisible();
  await expect(sel).toHaveValue('');
  await page.getByLabel('實際股數').fill('1000');
  await expect(page.getByTestId('checklist-submit')).toBeEnabled();
  await sel.selectOption('年線之下');
  await expect(item.getByTestId('ck-manual')).toHaveText('手動');
});

test('d3. 無本益比（虧損）：估值列「不適用」，說明頁寫出原因', async ({ page }) => {
  await patchSummary(page, '2330', { pe: null, pe_percentile: null });
  await openChecklist(page);
  await toForm(page);
  const row = page.getByTestId('ck-row-valuation');
  await expect(row).toContainText('不適用');
  await expect(row).toContainText('虧損或沒有本益比');
  await row.click();
  await expect(page.getByTestId('item-doc')).toContainText('虧損或沒有本益比，不計算位置');
});
