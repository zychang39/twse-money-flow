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

test('#9 「資料累積中」：5Y、10Y（週線取樣）的交易日數相同，日期帶年份；ALL 不顯示', async ({ page }) => {
  await page.goto('#/stock/2330');
  const group = page.getByRole('group', { name: '股價走勢期間' }).first();
  const notes: string[] = [];
  for (const p of ['5Y', '10Y']) {
    await group.getByRole('button', { name: new RegExp(`^${p}`) }).click();
    const note = page.getByTestId('hero-coverage').first();
    await expect(note).toContainText(/資料累積中：目前只有 \d+ 個交易日（自 \d{4}\/\d{1,2}\/\d{1,2} 起）/);
    notes.push((await note.textContent())!.match(/目前只有 (\d+) 個交易日/)![1]);
  }
  expect(new Set(notes).size).toBe(1);
  await group.getByRole('button', { name: /^ALL/ }).click();
  await expect(page.getByTestId('hero-coverage')).toHaveCount(0);
});

test.describe('#10 新增持倉前檢查表', () => {
  async function open(page: import('@playwright/test').Page, code: string) {
    await page.goto('#/discipline/checklist');
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).first().click();
    const ack = page.getByText('我已看過以上事實');
    if (await ack.count()) { await ack.click(); await page.getByRole('button', { name: '繼續填寫檢查表' }).click(); }
  }

  test('每個欄位都有對應題目的名稱（label for）；停損、目標是空的時不計算', async ({ page }) => {
    await open(page, '0050');
    for (const name of ['1. 市場燈號', '2. 趨勢', '3. 營收', '4. 估值', '5. 理由類型']) await expect(page.getByRole('combobox', { name: new RegExp(`^${name.replace('.', '\\.')}`) })).toBeVisible();
    await expect(page.getByLabel('6. 停損價', { exact: true })).toBeVisible();
    await expect(page.getByLabel('7. 目標價', { exact: true })).toBeVisible();
    await expect(page.getByLabel('進場價', { exact: true })).not.toHaveValue('');
    // 每個欄位的 id 與 label[for] 一一對應
    const pairs = await page.getByRole('dialog').evaluate((d) => [...d.querySelectorAll('select, input.input, textarea')].map((el) => !!d.querySelector(`label[for="${el.id}"]`)));
    expect(pairs.every(Boolean)).toBe(true);
    await expect(page.getByTestId('checklist-rr')).toHaveText('—（填入停損與目標後計算）');
    await expect(page.getByTestId('checklist-size')).toHaveText('建議部位：—（填入停損後計算）');
    await expect(page.getByTestId('checklist-calc')).not.toContainText('-1.00');
  });

  test('按鈕寫出實際卡住的條件：缺理由 → 價格順序 → 股數為 0', async ({ page }) => {
    await open(page, '2330');
    await page.getByLabel('1. 市場燈號').selectOption('中性');
    for (const label of ['2. 趨勢', '3. 營收', '4. 估值']) {
      const sel = page.getByLabel(label);
      if (!(await sel.inputValue())) await sel.selectOption({ index: 1 });
    }
    const submit = page.getByTestId('checklist-submit');
    await expect(submit).toHaveText('請填寫理由');
    await page.getByLabel('理由（必填）').fill('投信連買');
    await page.getByLabel('進場價', { exact: true }).fill('190');
    await page.getByLabel('6. 停損價', { exact: true }).fill('195');
    await page.getByLabel('7. 目標價', { exact: true }).fill('250');
    await expect(submit).toHaveText('停損價要低於進場價');
    await page.getByLabel('6. 停損價', { exact: true }).fill('170');
    // 100 萬 × 1% ÷ 20 = 500 股 → 0 張
    await expect(submit).toHaveText(/^股數為 0/);
    await expect(submit).toBeDisabled();
    await page.getByLabel('實際股數（預設為建議部位）').fill('500');
    await expect(submit).toHaveText('加入持倉');
    await expect(submit).toBeEnabled();
  });
});

test('#11 選股：刪掉內建組合的條件後改稱「自訂條件」，回測不出現兩個同名標籤', async ({ page }) => {
  await page.goto('#/explore/screener');
  const presets = page.getByRole('group', { name: '內建組合' });
  const first = presets.getByRole('button').first();
  const presetName = (await first.textContent())!.trim();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${presetName}：`);
  // 內建組合原樣帶到回測：直接看預先計算的全市場結果
  await expect(page.getByRole('link', { name: '一鍵回測' })).toHaveAttribute('href', /#\/explore\/backtest\?preset=/);
  // 刪除兩個條件
  await page.getByRole('button', { name: /^刪除條件/ }).nth(1).click();
  await page.getByRole('button', { name: /^刪除條件/ }).nth(1).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/^自訂條件：\d+ 檔符合/);
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('screen-desc')).toContainText(`由「${presetName}」修改`);
  const link = page.getByRole('link', { name: '一鍵回測' });
  await expect(link).toHaveAttribute('href', /name=%E8%87%AA%E8%A8%82/); // 自訂
  await link.click();
  const chips = page.getByRole('group', { name: '回測對象' }).getByRole('button');
  const labels = (await chips.allTextContents()).map((t) => t.replace(/（.*）$/, ''));
  expect(new Set(labels).size).toBe(labels.length);
  await expect(chips.first()).toHaveText('自訂條件');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  // 舊網址：name 和內建組合同名但條件不同 →「（已修改）」
  const c = encodeURIComponent(JSON.stringify([{ field: 'trust_streak', op: '>=', value: 3 }]));
  await page.goto(`#/explore/backtest?c=${c}&name=${encodeURIComponent(presetName)}`);
  await expect(page.getByRole('group', { name: '回測對象' }).getByRole('button').first()).toHaveText(`${presetName}（已修改）`);
});

test('#12 從清單底部進入個股頁時在頂端；按返回回到清單原本的位置', async ({ page }) => {
  const CHECK = { market: '', trend: '', revenue: '', valuation: '', reason: '' };
  const codes = ['0050', '2330', '2317', '2454', '2412', '2882', '1101', '3105', '5347', '6182', '6488', '8069'];
  await seed(page, { trades: codes.map((code, i) => ({ id: `t${i}`, code, name: code, status: 'open', openedAt: '2026-08-03', entry: 100, shares: 1000, stop: 1, target: 2000, reasonType: '', checklist: CHECK })) });
  await page.goto('#/mine');
  await page.getByRole('button', { name: /^持股/ }).click();
  const rows = page.locator('.srow');
  await expect(rows.last()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(6);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const listY = await page.evaluate(() => Math.round(window.scrollY));
  expect(listY).toBeGreaterThan(300);
  // 點清單底部（畫面上看得到、不需要再捲動）的一列
  await rows.last().click();
  await expect(page).toHaveURL(/#\/stock\//);
  await expect(page.locator('.stock-lower')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/mine/);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 5000 }).toBeGreaterThan(listY - 5);
});
