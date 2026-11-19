import { expect, test, type Page } from '@playwright/test';

// 加入自選股 › 從截圖加入（2026-11-14；DECISIONS #464）：選截圖或貼上文字 → 找出股票 → 勾選確認 → 加進群組。
// 截圖在瀏覽器裡辨識（tesseract.js，檔案自託管在 ./ocr/）。測試用畫布畫一張假的深色庫存畫面（只有英數，不依賴中文字型）。

async function openAdd(page: Page) {
  await page.goto('#/mine?seg=watch');
  await page.getByRole('button', { name: '加入自選股' }).first().click();
  await expect(page.getByTestId('watch-import')).toBeVisible();
}

/** 深色底、白字的假庫存畫面：代號在左邊同一欄，右邊是股數、現值、損益（含沒有千分位的「2330」） */
async function fakeScreenshot(page: Page, rows: [code: string, ...rest: string[]][]): Promise<Buffer> {
  const url = await page.evaluate((list) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 140 + list.length * 110;
    const g = c.getContext('2d')!;
    g.fillStyle = '#12161f'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#f2f2f2'; g.font = '44px Arial, Helvetica, sans-serif';
    g.fillText('TW 43675.12 +583.25', 40, 70);
    list.forEach((r, i) => {
      const y = 180 + i * 110;
      g.fillText(r[0], 40, y);
      r.slice(1).forEach((t, k) => g.fillText(t, 330 + k * 280, y));
    });
    return c.toDataURL('image/png');
  }, rows);
  return Buffer.from(url.split(',')[1], 'base64');
}

test.describe('從截圖加入自選', () => {
  test('選截圖：在裝置上辨識代號 → 確認清單 → 加進新群組；不在清單的代號會說明；金額不會被當成代號', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const outside: string[] = [];
    // blob:／data: 是頁面自己記憶體裡的資料（worker 的程式），不是連線
    page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://localhost')) outside.push(r.url()); });
    await page.setViewportSize({ width: 375, height: 812 });
    await openAdd(page);
    await page.getByPlaceholder('預設').fill('券商庫存');
    const png = await fakeScreenshot(page, [
      ['2330', '1,000', '2,535'], ['2317', '5,000', '511,258'], ['2454', '2,000', '-1101'], ['0050', '3,000', '2412'], ['9999', '1,000', '84,724'],
    ]);
    await page.getByTestId('import-file').setInputFiles({ name: 'holdings.png', mimeType: 'image/png', buffer: png });
    const list = page.getByTestId('import-list');
    await expect(list).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('import-busy')).toHaveCount(0, { timeout: 90_000 });
    for (const code of ['2330', '2317', '2454', '0050']) await expect(page.getByTestId(`import-${code}`).locator('input')).toBeChecked();
    await expect(page.getByTestId('import-2330')).toContainText('台積電'); // 名稱來自股票清單，不是辨識出來的字
    // 「-1101」是損益（帶負號）不列；「2412」不在代號那一欄 → 列出但不勾，並說明
    await expect(page.getByTestId('import-1101')).toHaveCount(0);
    await expect(page.getByTestId('import-2412').locator('input')).not.toBeChecked();
    await expect(page.getByTestId('import-2412')).toContainText('可能是金額');
    await expect(page.getByTestId('import-unknown')).toContainText('9999');
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 4 檔到「券商庫存」');
    await page.getByRole('button', { name: '關閉' }).click();
    await page.getByRole('group', { name: '群組' }).getByRole('button', { name: '券商庫存' }).click();
    await expect(page.locator('.page').first()).toContainText('自選 4 檔');
    expect(outside).toEqual([]); // 辨識工具自託管：不向任何外部網址取檔
    expect(errors).toEqual([]);
  });

  test('貼上文字：相簿拷貝出來的文字（代號＋名稱）；已在自選的標示並略過', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAdd(page);
    await page.evaluate(() => navigator.clipboard.writeText('台股庫存\n台積電 現股 1,000 2,535\n2330 511,258 0.50%\n鴻海 現股 2,000 -3,581\n2317 268,806 -1.31%\n聯發科 5,000'));
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-summary')).toHaveText('找到 3 檔；1 檔請再看一眼'); // 聯發科只有名稱
    await expect(page.getByTestId('import-2454')).toContainText('只對到名稱');
    await page.getByTestId('import-2317').locator('input').uncheck();
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「預設」');
    // 再貼一次（現在正在看「預設」這個群組）：已加入的兩檔標「已在『預設』」，只剩鴻海可以加
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-summary')).toContainText('其中 2 檔已在「預設」');
    await expect(page.getByTestId('import-2330')).toContainText('已在「預設」');
    await expect(page.getByTestId('import-2330').locator('input')).toBeDisabled();
    await expect(page.getByTestId('import-add')).toHaveText('加入 1 檔到「預設」');
  });

  test('指定新群組：已在別的群組的股票也加進來（原本的群組不動），群組不存在就建立；同一個輸入框可以一次打好幾檔', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAdd(page);
    // 第一欄是群組（大輸入框），加入股票的方式在下面；沒有另外的大文字框
    const groupBox = await page.getByTestId('add-group-name').boundingBox();
    const pickBox = await page.getByTestId('import-pick').boundingBox();
    expect(groupBox!.height).toBeGreaterThanOrEqual(56);
    expect(groupBox!.y).toBeLessThan(pickBox!.y);
    await expect(page.getByRole('dialog').locator('textarea')).toHaveCount(0);
    await page.evaluate(() => navigator.clipboard.writeText('2330 台積電\n2317 鴻海'));
    await page.getByTestId('import-paste').click();
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「預設」');
    // 打一個還不存在的群組：兩檔已在「預設」→ 照樣可以勾選加進來；聯發科是新的
    await page.getByPlaceholder('預設').fill('Latest');
    await expect(page.getByTestId('add-group-new')).toContainText('「Latest」是新群組');
    await page.evaluate(() => navigator.clipboard.writeText('2330 台積電\n2317 鴻海\n2454 聯發科'));
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-summary')).toHaveText('找到 3 檔');
    await expect(page.getByTestId('import-2330')).toContainText('也在「預設」');
    await expect(page.getByTestId('import-2330').locator('input')).toBeChecked();
    await page.getByTestId('import-2317').locator('input').uncheck();
    await expect(page.getByTestId('import-add')).toHaveText('加入 2 檔到「Latest」');
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「Latest」');
    // 搜尋加入也一樣：已在「預設」的鴻海 → 也加進 Latest
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2317');
    await page.getByRole('option', { name: /2317/ }).click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 鴻海 到「Latest」');
    // 同一個輸入框打好幾個代號 → 列出來勾選
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2412, 0050');
    await page.getByTestId('search-multi').click();
    await expect(page.getByTestId('import-add')).toHaveText('加入 2 檔到「Latest」');
    await page.getByTestId('import-add').click();
    await page.getByRole('button', { name: '關閉' }).click();
    const chips = page.getByRole('group', { name: '群組' });
    await chips.getByRole('button', { name: 'Latest' }).click(); // 群組自動建立
    await expect(page.locator('.page').first()).toContainText('5 檔・左滑可移除');
    await chips.getByRole('button', { name: '預設' }).click(); // 原本的群組不動
    await expect(page.locator('.page').first()).toContainText('2 檔・左滑可移除');
    await expect(page.locator('.page').first()).toContainText('自選 5 檔'); // 同一檔在兩個群組只算一檔
  });

  test('選取多檔：圓圈勾選、按住圓圈往下滑連續選取、一次移除並可復原；只離開這個群組；清單最後可以繼續加入', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAdd(page);
    await page.evaluate(() => navigator.clipboard.writeText('2330 台積電\n2317 鴻海\n2454 聯發科\n2412 中華電'));
    await page.getByTestId('import-paste').click();
    await page.getByTestId('import-add').click();
    await page.getByPlaceholder('預設').fill('Latest');
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
    await page.getByRole('option', { name: /2330/ }).click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 台積電 到「Latest」');
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
    const chips = page.getByRole('group', { name: '群組' });
    await chips.getByRole('button', { name: '預設' }).click();
    const row = (code: string) => page.locator(`.srow-wrap[data-code="${code}"] .srow`);

    // 「選取」與排序在同一列、垂直置中對齊
    const mids = await page.locator('.list-head > *').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }));
    expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(2);
    await page.getByTestId('select-start').click();
    await expect(page.getByTestId('select-bar')).toBeVisible();
    await expect(page.locator('.dock')).toHaveCSS('opacity', '0'); // 選取期間導覽列收起來，動作列在同一個位置
    await row('2330').click(); // 點一下＝勾選，不開個股頁
    await expect(row('2330')).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/#\/mine/);
    // 按住圓圈往下滑：經過的都勾起來
    const from = await row('2317').locator('.srow-check').boundingBox();
    const to = await row('2412').locator('.srow-check').boundingBox();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + from!.width / 2, (from!.y + to!.y) / 2 + to!.height / 2, { steps: 6 });
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('select-count')).toHaveText('已選 4 檔');
    // 上方管選取（全選｜已選 N 檔｜完成，同一列對齊），下方只有兩個動作
    const heads = await page.getByTestId('select-head').locator('> *').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }));
    expect(Math.max(...heads) - Math.min(...heads)).toBeLessThan(2);
    await expect(page.getByTestId('select-bar').getByRole('button')).toHaveText(['加到群組', '移除 4 檔']);
    await expect(page.getByTestId('select-all')).toHaveText('取消全選');
    await page.waitForTimeout(350);
    await row('2412').click(); // 取消一檔
    await expect(page.getByTestId('select-count')).toHaveText('已選 3 檔');
    await expect(page.getByTestId('select-remove')).toHaveText('移除 3 檔');
    await page.getByTestId('select-remove').click();
    await expect(page.getByTestId('select-bar')).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('已從「預設」移除 3 檔');
    await expect(page.locator('.page').first()).toContainText('1 檔・左滑可移除');
    await expect(page.locator('.page').first()).toContainText('自選 2 檔'); // 台積電還在 Latest
    await page.getByTestId('undo-toast').getByRole('button', { name: '復原' }).click();
    await expect(page.locator('.page').first()).toContainText('4 檔・左滑可移除');
    // 清單最後：繼續加進這個群組
    await page.getByTestId('add-more').getByRole('button', { name: '加入股票' }).click();
    await expect(page.getByTestId('add-group-name')).toHaveAttribute('placeholder', '預設');
  });

  test('新增持倉前檢查表：不用打字，從股票池（自選群組、最近搜尋）點一檔；環境、個股、計畫在同一頁', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAdd(page);
    await page.getByPlaceholder('預設').fill('觀察');
    await page.evaluate(() => navigator.clipboard.writeText('2330 台積電\n2317 鴻海'));
    await page.getByTestId('import-paste').click();
    await page.getByTestId('import-add').click();
    await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「觀察」');
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
    await page.goto('#/mine?seg=hold');
    await page.getByTestId('holdings-empty-row').click();
    const pick = page.getByTestId('ck-pick');
    await expect(pick.getByRole('group', { name: '股票池' }).getByRole('button', { name: '觀察' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('searchbox', { name: '搜尋股票' })).not.toBeFocused(); // 不自動叫出鍵盤
    // 輸入框不貼在螢幕最上面
    const box = await page.getByRole('searchbox', { name: '搜尋股票' }).boundingBox();
    expect(box!.y).toBeGreaterThan(page.viewportSize()!.height * 0.2);
    await page.getByTestId('ck-pool-list').getByRole('button', { name: /鴻海/ }).click();
    const form = page.getByTestId('checklist-form');
    await expect(form).toBeVisible();
    const tops = await form.evaluate((el) => ['[data-testid="ck-env"]', '[data-testid="ck-items"]', '#ck-entry'].map((q) => el.querySelector(q)!.getBoundingClientRect().top));
    expect(tops[0]).toBeLessThan(tops[1]); // 環境 → 個股 → 計畫
    expect(tops[1]).toBeLessThan(tops[2]);
  });
});
