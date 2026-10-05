import { expect, test } from '@playwright/test';
import { gotoDaily, gotoStockSeg } from './helpers';

// v3 M2（docs/V3_NOTES.md）：每日籌碼表（Apple HIG）、信用與空方拆分、籌碼結構。

test.use({ viewport: { width: 393, height: 852 } });

test.describe('M2-1 每日籌碼表', () => {
  test('沒有每格比例條；法人柱狀圖移到籌碼分頁（子頁只有信用、借券當沖）；同一欄同一種格式；列高約 52pt；區間合計有底色', async ({ page }) => {
    await gotoDaily(page);
    const daily = page.locator('section.chip-daily');
    await daily.scrollIntoViewIfNeeded();
    const table = daily.locator('.cd-table');
    await expect(table).toBeVisible();
    await expect(daily.locator('.cd-bar')).toHaveCount(0);
    // 2026-10-06：法人（含柱狀圖）移到個股籌碼分頁的法人區塊，子頁不再有
    await expect(daily.getByRole('img', { name: /^三大法人近 \d+ 日每日買賣超柱狀圖/ })).toHaveCount(0);

    // 同一欄同一種格式（#6）：每一欄的小數位數一致（—、0 除外；信用檢視的券資比是 1 位小數 %，其餘張為整數）
    const cols = await table.evaluate((t) => {
      const rows = [...t.querySelectorAll('tbody tr')];
      const n = rows[0].querySelectorAll('td').length;
      return Array.from({ length: n }, (_, i) => rows.map((r) => r.querySelectorAll('td')[i].querySelector('.cd-t')?.textContent ?? ''));
    });
    for (const col of cols) {
      const nums = col.map((t) => t.replace(/[▲▼%]/g, '')).filter((t) => t !== '—' && t !== '0' && !t.endsWith('張'));
      const decimals = new Set(nums.map((t) => (t.includes('.') ? t.split('.')[1].length : 0)));
      expect(decimals.size, col.join(' | ')).toBeLessThanOrEqual(1);
    }
    // 數字靠右、等寬數字；▲▼ 縮小
    const style = await table.locator('tbody tr.day td.cd-v').first().evaluate((el) => ({ align: getComputedStyle(el).textAlign, num: getComputedStyle(el).fontVariantNumeric }));
    expect(style.align).toBe('right');
    expect(style.num).toContain('tabular-nums');
    const arrow = table.locator('.cd-arrow').first();
    if (await arrow.count()) {
      const [a, v] = await arrow.evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), parseFloat(getComputedStyle(el.closest('td')!).fontSize)]);
      expect(a).toBeLessThan(v);
    }
    // 列高約 52–64pt（M3：日期下方收盤與漲跌分兩行）；日期 15pt、日期下方 12pt
    const row = table.locator('tbody tr.day').first();
    const h = (await row.boundingBox())!.height;
    expect(h).toBeGreaterThanOrEqual(50);
    expect(h).toBeLessThanOrEqual(68);
    expect(await row.locator('.cd-date').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px');
    expect(await row.locator('.cd-sub').evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px'); // 最小字級 13（2026-10 恢復環境光改版）
    const totalBg = await table.locator('tr.total td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const dayBg = await row.locator('td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(totalBg).not.toBe(dayBg);
    // 連續天數：法人區塊的標題（籌碼分頁）
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    await expect(page.getByTestId('insti-concl')).toHaveText(/^外資(連[買賣] \d+\+? 日|無連續)・投信/);
  });
});

test.describe('M2-2 信用交易（2026-10 改版）', () => {
  test('融資餘額圖＋每日原始資料表；使用率、券資比、融券最後回補日；不下敘事結論', async ({ page }) => {
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    const block = page.getByTestId('sec-credit');
    await block.scrollIntoViewIfNeeded();
    // M3：融資餘額圖下方是每日原始資料表（融資、融券的餘額與當日增減、借券賣出、當沖率）
    await expect(block.getByTestId('credit-daily').locator('thead th')).toHaveText(['日期', '融資', '融券', '借券賣出', '當沖率']);
    for (const t of ['融資使用率', '券資比', '融券最後回補日']) await expect(block.getByText(t, { exact: true })).toBeVisible();
    await expect(block).not.toContainText(/買進|建議|(?<!借券)賣出|價漲資增|價跌資增|軋空/);
    await block.getByRole('button', { name: '信用與借券當沖的說明' }).click();
    await expect(page.getByRole('dialog')).toContainText('券資比＝融券餘額 ÷ 融資餘額');
  });

  test('外資持股比與 20 日變化（百分點）在籌碼分段', async ({ page }) => {
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    // M3：外資持股比是摘要卡，推入詳情頁（走勢圖）
    const sec = page.getByTestId('sec-qfii');
    await expect(sec).toContainText('%');
    await expect(sec).toContainText(/個百分點|資料累積中|%/);
    await sec.click();
    await expect(page).toHaveURL(/#\/stock\/2330\/c\/qfii$/);
    await expect(page.getByTestId('qfii-detail')).toBeVisible();
  });

  test('券資比照實顯示數值（35%）', async ({ page }) => {
    await page.route('**/data/stocks/2330.json', async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      const n = j.sb.length;
      j.mb[n - 1] = j.mb[n - 1] ?? 1000;
      j.sb[n - 1] = Math.round(j.mb[n - 1] * 0.35);
      await route.fulfill({ response: res, json: j });
    });
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    await expect(page.getByTestId('sec-credit').locator('.ui-row', { hasText: '券資比' })).toContainText(/3[45]\.\d{2}%/);
  });
});

test.describe('M2-3 股權分散', () => {
  test('股權分散摘要卡（M3）：千張大戶比例、連續週數、資料日；點進趨勢與 15 級分布頁', async ({ page }) => {
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    const card = page.getByTestId('sec-holders');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText(/千張大戶/);
    await expect(card).toContainText(/連 \d+ 週(增加|減少)|週持平/);
    await expect(card).toContainText(/資料日 \d+\/\d+/);
    await card.click();
    await expect(page).toHaveURL(/#\/stock\/2330\/holders$/);
  });

  test('全站沒有「超過 100 張」等不一致的大戶定義', async ({ page }) => {
    for (const hash of ['#/stock/2330', '#/stock/2330/holders']) {
      await page.goto(hash);
      await expect(page.locator('main')).toBeVisible();
      await page.waitForTimeout(300);
      await expect(page.getByText(/超過 100 張|百張大戶|10 張以下/)).toHaveCount(0);
    }
  });
});
