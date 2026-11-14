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
    await expect(page.locator('.page').first()).toContainText('自選 4 檔'); // 清單只列有顯著變化的，其餘收在「未達門檻」
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
    // 再貼一次：已加入的兩檔標「已在自選」，只剩鴻海可以加
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-summary')).toContainText('其中 2 檔已在自選');
    await expect(page.getByTestId('import-2330')).toContainText('已在自選');
    await expect(page.getByTestId('import-2330').locator('input')).toBeDisabled();
    await expect(page.getByTestId('import-add')).toHaveText('加入 1 檔到「預設」');
  });
});
