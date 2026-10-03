import { expect, test, type Page } from '@playwright/test';

// v3 M1（docs/V3_NOTES.md）：圖表資料不足、返回保持捲動位置、移除八大行庫、深淺色、個股頁期間。

test.use({ viewport: { width: 393, height: 852 } });

const ALL = ['2330', '2317', '2454', '2412', '2882', '1101', '0050', '3105', '5347', '6182', '6488', '8069'];

async function addWatch(page: Page, codes: string[]) {
  await page.goto('#/mine?seg=watch');
  await page.getByRole('button', { name: '加入自選股' }).first().click();
  for (const code of codes) {
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).click();
  }
  await page.getByRole('button', { name: '關閉' }).click();
}

/** 把個股檔的集保資料截成最後 n 週（模擬正式站只累積 1 週的情況）。 */
async function trimHolders(page: Page, weeks: number) {
  await page.route('**/data/stocks/2330.json', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    const h = j.holders;
    const cut = (a: unknown[]) => a.slice(-weeks);
    j.holders = { ...h, d: cut(h.d), n: h.n.map(cut), p: h.p.map(cut), ts: cut(h.ts), th: cut(h.th) };
    await route.fulfill({ response: res, json: j });
  });
}

test.describe('M1-1 圖表資料不足', () => {
  test('大戶與散戶：只有 1 週、選 6 個月 → 標題寫所選期間、畫單點標記並說明資料累積中', async ({ page }) => {
    await trimHolders(page, 1);
    await page.goto('#/stock/2330/holders');
    await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '6 個月' }).click();
    await expect(page.getByRole('heading', { name: '走勢・6 個月' })).toBeVisible();
    await expect(page.getByTestId('hd-coverage')).toContainText(/資料累積中：目前只有 1 週（自 \d{4}\/\d+\/\d+ 起），所選期間超過可用資料；歷史回補中/);
    // 每個折線面板都有單點標記（舊版只有座標軸）
    expect(await page.getByTestId('sc-point').count()).toBeGreaterThanOrEqual(3);
  });

  test('大戶與散戶：資料足夠時沒有「資料累積中」', async ({ page }) => {
    await page.goto('#/stock/2330/holders');
    await page.getByRole('group', { name: '期間' }).getByRole('button', { name: '3 個月' }).click();
    await expect(page.getByRole('heading', { name: '走勢・3 個月' })).toBeVisible();
    await expect(page.getByTestId('hd-coverage')).toHaveCount(0);
    await expect(page.locator('.stacked path.sc-line').first()).toBeVisible();
  });

  test('個股主角走勢只有 1 個交易日 → 單點標記＋說明（不是空白）', async ({ page }) => {
    await page.route('**/data/stocks/2330.json', async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      for (const k of ['d', 'o', 'h', 'l', 'c', 'v', 'val', 'af']) if (Array.isArray(j[k])) j[k] = j[k].slice(-1);
      await route.fulfill({ response: res, json: j });
    });
    await page.goto('#/stock/2330');
    const chart = page.locator('.chart-wrap').first();
    await expect(chart.locator('svg rect').first()).toBeVisible();
    await expect(page.getByTestId('hero-coverage').first()).toContainText('資料累積中：目前只有 1 個交易日');
  });
});

test.describe('M1-2 返回保持捲動位置與狀態', () => {
  test.setTimeout(90_000);

  async function setupList(page: Page) {
    await addWatch(page, ALL);
    await page.goto('#/mine');
    await page.getByRole('combobox', { name: '排序' }).selectOption('pct');
    await expect(page.locator('.srow')).toHaveCount(ALL.length);
    await page.waitForTimeout(400);
    const y = await page.evaluate(() => {
      const target = Math.round((document.documentElement.scrollHeight - innerHeight) / 2);
      window.scrollTo(0, target);
      return target;
    });
    expect(y).toBeGreaterThan(100);
    await page.waitForTimeout(300);
    return await page.evaluate(() => window.scrollY);
  }

  async function openVisibleRow(page: Page) {
    const idx = await page.locator('.srow').evaluateAll((els) => els.findIndex((e) => { const r = e.getBoundingClientRect(); return r.top > 200 && r.bottom < innerHeight - 150; }));
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.locator('.srow').nth(idx).click();
    await expect(page).toHaveURL(/#\/stock\//);
    await expect(page.getByTestId('stock-price').first()).toBeVisible();
    await page.waitForTimeout(400);
  }

  test('清單中段 → 個股 → 左上角返回：位置誤差 ≤ 8px，排序保留', async ({ page }) => {
    const y = await setupList(page);
    await openVisibleRow(page);
    await page.getByRole('link', { name: '返回' }).click();
    await expect(page).toHaveURL(/#\/mine$/);
    await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('pct');
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(y - 9);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(8);
  });

  test('瀏覽器返回（等同螢幕左緣右滑）也還原；個股之間換股不影響清單位置', async ({ page }) => {
    const y = await setupList(page);
    await openVisibleRow(page);
    // 個股之間切換（取代目前紀錄）
    const next = page.getByRole('button', { name: '下一檔' });
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(700);
    } else {
      await page.getByRole('button', { name: '上一檔' }).click();
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.goBack();
    await expect(page).toHaveURL(/#\/mine$/);
    await expect(page.getByRole('combobox', { name: '排序' })).toHaveValue('pct');
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - y), { timeout: 5000 }).toBeLessThanOrEqual(8);
  });

  test('直接開啟個股網址時，返回鍵前往清單（沒有上一筆紀錄）', async ({ page }) => {
    await page.goto('#/stock/2330');
    await page.getByRole('link', { name: '返回' }).click();
    await expect(page).toHaveURL(/#\/mine$/);
  });
});

test.describe('M1-4 只做深色（2026-10 恢復環境光改版）', () => {
  test('系統為淺色時仍是深色；舊的 tmf-theme 設定值一律視為深色；theme-color 為黑', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('#/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.locator('meta[name="theme-color"]').evaluateAll((ms) => ms.map((m) => (m as HTMLMetaElement).content))).toEqual(['#000000']);
    await page.evaluate(() => localStorage.setItem('tmf-theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('group', { name: '深淺色' })).toHaveCount(0);
  });

  test('第一次繪製前就套用（inline script，DOMContentLoaded 時已有 data-theme）', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as unknown as { __themeAtDcl: string | null }).__themeAtDcl = document.documentElement.getAttribute('data-theme');
      });
    });
    await page.goto('#/');
    expect(await page.evaluate(() => (window as unknown as { __themeAtDcl: string | null }).__themeAtDcl)).toBe('dark');
  });
});

test.describe('M1-5 個股頁期間', () => {
  test('沒有分 K 檔時沒有 1D／1W、沒有 10Y；預設 1Y；主角數字下方有「當日漲跌＋資料日」與「所選期間」兩行', async ({ page }) => {
    await page.goto('#/stock/2330');
    const group = page.getByRole('group', { name: '股價走勢期間' }).first();
    await expect(group.getByRole('button', { name: /^1D/ })).toHaveCount(0);
    await expect(group.getByRole('button', { name: /^1Y/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: /^1W/ })).toHaveCount(0);
    await expect(group.getByRole('button', { name: /^10Y/ })).toHaveCount(0);
    const hero = page.locator('.sc').first();
    await expect(hero.getByTestId('hero-change-date').first()).toHaveText(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
    await expect(hero.getByTestId('hero-period-change')).toContainText(/^1Y/);
    await group.getByRole('button', { name: /^3M/ }).click();
    await expect(hero.getByTestId('hero-period-change')).toContainText(/^3M/);
  });
});
