import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gotoStock, seed } from './helpers';

// 可用性測試修正（第 2 輪）：每一項的回歸測試。
// 視窗 390×844（使用者測試環境）；個別測試另指定 375／393。
test.use({ viewport: { width: 390, height: 844 } });

test.describe('#1 版本字串與 service worker 更新', () => {
  test('設定頁與資料健康頁顯示同一個版本字串（commit 短碼・建置日期）', async ({ page }) => {
    await page.goto('#/me/settings');
    const v = page.getByTestId('app-version-string');
    await expect(v).toHaveText(/^[0-9a-z]{4,}・\d{4}-\d{2}-\d{2}$/);
    const text = await v.textContent();
    await expect(page.getByRole('button', { name: '檢查更新' })).toBeVisible();
    await page.goto('#/me/health');
    await expect(page.getByTestId('app-version-string')).toHaveText(text!);
  });

  test('service worker 安裝成功（index.html 版本驗證通過）並控制頁面；檢查更新回報已是最新版本', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
    const keys = await page.evaluate(() => caches.keys());
    expect(keys.some((k) => k.startsWith('app-'))).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto('#/me/settings');
    await page.getByRole('button', { name: '檢查更新' }).click();
    await expect(page.getByText('已是最新版本')).toBeVisible();
  });
});

test('#3 個股頁頁首的「今日」漲跌：切換任何期間（含週線取樣的 10Y、ALL）都不變', async ({ page }) => {
  await page.goto('#/stock/2330');
  const group = page.getByRole('group', { name: '股價走勢期間' }).first();
  const today = page.locator('.hero-change:not(.second)').first();
  await expect(today).toContainText('今日');
  const base = await today.textContent();
  for (const p of ['1W', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL']) {
    await group.getByRole('button', { name: new RegExp(`^${p}`) }).click();
    await page.waitForTimeout(150);
    await expect(today, p).toHaveText(base!);
  }
});

test.describe('#4／#5 個股頁區塊樣式', () => {
  test('build 後：使用 .sx-*／.cr-* 的分塊自己帶到含這些規則的 CSS（不依賴工具頁先載入）', () => {
    type Chunk = { file: string; css?: string[]; imports?: string[] };
    const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8')) as Record<string, Chunk>;
    const cssOf = (key: string, seen = new Set<string>()): string => {
      if (seen.has(key) || !manifest[key]) return '';
      seen.add(key);
      const c = manifest[key];
      return (c.css ?? []).map((f) => readFileSync(`dist/${f}`, 'utf8')).join('\n') + (c.imports ?? []).map((k) => cssOf(k, seen)).join('\n');
    };
    const sections = cssOf('src/components/StockSections.tsx');
    expect(sections).toContain('.sx-facts');
    expect(sections).toContain('.sx-ma');
    const credit = cssOf('src/components/Credit.tsx');
    expect(credit).toContain('.cr-row');
    expect(credit).toContain('.cr-inline');
  });

  test('直接開啟個股頁：動能事實沒有瀏覽器預設的縮排，均線列沒有項目符號，標籤與數值有間距', async ({ page }) => {
    await gotoStock(page, '#/stock/2330');
    const facts = page.getByTestId('momentum-facts');
    await facts.scrollIntoViewIfNeeded();
    expect(await facts.evaluate((el) => getComputedStyle(el).marginLeft)).toBe('0px');
    expect(await facts.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
    expect(await facts.locator('dd').first().evaluate((el) => getComputedStyle(el).marginLeft)).toBe('0px');
    const ma = page.locator('ul.sx-ma');
    expect(await ma.evaluate((el) => getComputedStyle(el).listStyleType)).toBe('none');
    const li = ma.locator('li').first();
    const [label, value] = await Promise.all([li.locator('span').nth(0).boundingBox(), li.locator('span').nth(1).boundingBox()]);
    expect(value!.x - (label!.x + label!.width)).toBeGreaterThanOrEqual(8);
  });

  test('外資持股比：標籤左、數值右，變化與數值同一行並留間距', async ({ page }) => {
    await gotoStock(page, '#/stock/2330');
    const row = page.getByTestId('foreign-hold');
    await row.scrollIntoViewIfNeeded();
    expect(await row.locator('.cr-row').evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    expect(await row.locator('dd').evaluate((el) => getComputedStyle(el).marginLeft)).toBe('0px');
    const chg = row.getByTestId('foreign-hold-change');
    await expect(chg).toHaveText(/^(▲|▼)\d+\.\d{2} 百分點$|^持平$|^變化：資料累積中$/);
    const val = row.locator('dd > span').first();
    const [a, b] = [await val.boundingBox(), await chg.boundingBox()];
    expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(8);
    const dt = await row.locator('dt').boundingBox();
    expect(dt!.x).toBeLessThan(a!.x);
  });
});

test.describe('#8 清單列的說明不截斷', () => {
  for (const width of [375, 393]) {
    test(`${width}pt：自選列的說明完整顯示（不超出、沒有省略號）`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await seed(page, { watchlist: ['2317', '2330', '2454', '6488', '5347', '3105'].map((code, i) => ({ code, group: '預設', addedAt: '2026-09-01', order: i, origin: 'user' })) });
      await page.goto('#/mine');
      const subs = page.locator('.srow .sub');
      await expect(subs.first()).toBeVisible();
      const n = await subs.count();
      expect(n).toBeGreaterThan(3);
      for (let i = 0; i < n; i++) {
        const m = await subs.nth(i).evaluate((el) => ({ text: el.textContent ?? '', sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, clamp: getComputedStyle(el).webkitLineClamp, to: getComputedStyle(el).textOverflow }));
        expect(m.sw, m.text).toBeLessThanOrEqual(m.cw);
        expect(m.sh, m.text).toBeLessThanOrEqual(m.ch + 1);
        expect(m.text).not.toContain('…');
        expect(m.text).not.toContain('萬 張');
        expect(m.clamp).toBe('none');
        expect(m.to).not.toBe('ellipsis');
      }
    });
  }
});
