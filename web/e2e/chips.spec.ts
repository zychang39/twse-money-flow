import { expect, test, type Page } from '@playwright/test';
import { gotoDaily, gotoStockSeg } from './helpers';

// 個股籌碼：區間統計卡、每日籌碼（預設展開、一排控制列、三種檢視、不需左右滑動、底部面板、收合偏好、卡片版面、⋯ 選單）、法人柱狀圖。

test('法人區塊（2026-10-06）：區間 5／10／20／60 日與法人分段同時驅動摘要、圖表、表格；舊摘要表與「顯示全部 20 日」舊表已移除', async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('insti-reset')) { localStorage.removeItem('tmf-insti'); sessionStorage.setItem('insti-reset', '1'); } } catch { /* 無痕 */ } });
  await gotoStockSeg(page, '#/stock/2330', '籌碼');
  const sec = page.getByTestId('sec-insti');
  const table = page.getByTestId('insti-daily');
  await expect(table).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('insti-table')).toHaveCount(0); // 舊摘要表（法人／買賣超／佔量／連續）已刪除
  await expect(page.getByTestId('insti-period').getByRole('button')).toHaveText(['5 日', '10 日', '20 日', '60 日']);
  await expect(page.getByTestId('insti-period').getByRole('button', { name: '20 日' })).toHaveAttribute('aria-pressed', 'true'); // 預設 20 日
  await expect(page.getByTestId('insti-party').getByRole('button')).toHaveText(['外資', '投信', '自營商', '合計']);
  await expect(page.getByTestId('insti-concl')).toHaveText(/^外資(連[買賣] \d+\+? 日|無連續)・投信(連[買賣] \d+\+? 日|無連續)$/);
  await expect(sec.getByText(/^法人 20 日/)).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['日期', '外資', '投信', /^自營商/, '合計']);
  await expect(table.locator('tbody tr').first()).toContainText('區間合計');
  await expect(table.locator('tbody tr').first()).toContainText(/佔 [\d.]+%/);
  // 20 日：預設 10 列，就地展開
  await expect(table.locator('tbody tr.day:not(.folded)')).toHaveCount(10);
  await page.getByTestId('insti-daily-more').click();
  await expect(table.locator('tbody tr.day:not(.folded)')).toHaveCount(20);
  // 5／10 日全部列出、沒有展開按鈕；摘要的 N 跟著區間
  await page.getByTestId('insti-period').getByRole('button', { name: '10 日' }).click();
  await expect(table.locator('tbody tr.day')).toHaveCount(10);
  await expect(page.getByTestId('insti-daily-more')).toHaveCount(0);
  await expect(sec.getByText(/^法人 10 日/)).toBeVisible();
  // 60 日
  await page.getByTestId('insti-period').getByRole('button', { name: '60 日' }).click();
  await expect(table.locator('tbody tr.day')).toHaveCount(60);
  await expect(table.locator('tbody tr.day:not(.folded)')).toHaveCount(10);
  // 法人分段：強調欄跟著改
  await page.getByTestId('insti-party').getByRole('button', { name: '合計' }).click();
  await expect(table.locator('thead th.em')).toHaveText('合計');
  await expect(sec).not.toContainText(/買進|賣出|建議/);
  await expect(sec).not.toContainText('萬');
  // 區間合計列 → 區間明細（佔股本、估計成本…）
  await table.getByTestId('insti-total').getByRole('button').click();
  const detail = page.getByTestId('insti-detail');
  await expect(detail).toBeVisible();
  for (const label of ['佔股本', '估計成本', '現價比成本', '近 20 日買超的 1 年百分位']) await expect(detail).toContainText(label);
});

test('法人區塊：圖上選某日 → 表格對應列高亮（折疊範圍外自動展開）；點列 → 圖上柱子高亮並開當天完整資料；記住區間與法人', async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('insti-reset')) { localStorage.removeItem('tmf-insti'); sessionStorage.setItem('insti-reset', '1'); } } catch { /* 無痕 */ } });
  await gotoStockSeg(page, '#/stock/2330', '籌碼');
  const table = page.getByTestId('insti-daily');
  await expect(table).toBeVisible({ timeout: 15_000 });
  const plot = page.getByTestId('insti-bars').locator('.ib-plot');
  await plot.scrollIntoViewIfNeeded();
  const pw = (await plot.boundingBox())!.width - 44;
  // 最舊的一天（第 20 列，在折疊範圍外）：用鍵盤選，避免點到柱身外
  await plot.focus();
  await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 19; i++) await page.keyboard.press('ArrowLeft');
  const info = page.getByTestId('ib-info');
  await expect(info).toContainText(/\d{2}\/\d{2} 外資/);
  await expect(table.locator('tbody tr.day.sel')).toHaveCount(1);
  await expect(table.locator('tbody tr.day').last()).toHaveClass(/sel/);
  await expect(table.locator('tbody tr.day:not(.folded)')).toHaveCount(20); // 自動展開
  // 點圖表空白處（刻度欄）取消（表格展開、捲動後重新量位置）
  await plot.scrollIntoViewIfNeeded();
  const box2 = (await plot.boundingBox())!;
  await page.mouse.click(box2.x + pw + 20, box2.y + 10);
  await expect(table.locator('tbody tr.day.sel')).toHaveCount(0);
  await expect(info).toContainText('最大');
  // 點表格第 3 列 → 對應柱子高亮、開底部面板
  await table.locator('tbody tr.day').nth(2).click();
  await expect(page.getByRole('dialog', { name: /籌碼/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('insti-bars').locator('.ib-bar.on, .ib-pending.on')).toHaveCount(1);
  // 記住區間與法人（localStorage tmf-insti，全站共用）
  await page.getByTestId('insti-period').getByRole('button', { name: '60 日' }).click();
  await page.getByTestId('insti-party').getByRole('button', { name: '投信' }).click();
  await page.reload();
  await page.getByRole('group', { name: '個股分段' }).getByRole('button', { name: '籌碼', exact: true }).click();
  await expect(page.getByTestId('insti-period').getByRole('button', { name: '60 日' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('insti-party').getByRole('button', { name: '投信' })).toHaveAttribute('aria-pressed', 'true');
});

test('法人區塊：最長的值在 375／402pt 不換行、不截斷、不超出卡片；數字 tabular-nums 靠右，區間合計列與資料列欄位對齊', async ({ page }) => {
  for (const width of [375, 402]) {
    await page.setViewportSize({ width, height: 852 });
    await gotoStockSeg(page, '#/stock/2330', '籌碼');
    await page.getByTestId('insti-period').getByRole('button', { name: '60 日' }).click();
    const table = page.getByTestId('insti-daily');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const bad = await table.evaluate((t) => {
      const card = t.closest('.if-card')!.getBoundingClientRect();
      const out: string[] = [];
      for (const el of t.querySelectorAll<HTMLElement>('.cd-t, .if-pct, .cd-date, .cd-sub')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > card.right + 0.5 || r.left < card.left - 0.5) out.push(`超出：${el.textContent}`);
        const lines = new Set([...el.getClientRects()].map((x) => Math.round(x.top)));
        if (lines.size > 1) out.push(`換行：${el.textContent}`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') out.push(`截斷：${el.textContent}`);
      }
      const heads = [...t.querySelectorAll('thead th')].map((x) => x.getBoundingClientRect().right);
      const tot = [...t.querySelectorAll('tbody tr.total > *')].map((x) => x.getBoundingClientRect().right);
      const day = [...t.querySelectorAll('tbody tr.day')[0].children].map((x) => x.getBoundingClientRect().right);
      if (heads.some((v, i) => Math.abs(v - tot[i]) > 0.5 || Math.abs(v - day[i]) > 0.5)) out.push('欄位沒對齊');
      const v = t.querySelector('td.cd-v')!;
      if (getComputedStyle(v).fontVariantNumeric !== 'tabular-nums' || getComputedStyle(v).textAlign !== 'right') out.push('數字沒有 tabular-nums 靠右');
      return out;
    });
    expect(bad, `${width}pt`).toEqual([]);
    const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(doc).toBeLessThanOrEqual(0);
  }
});

// ---------------------------------------------------------------- 每日籌碼（HIG 改版）
const daily = (page: Page) => page.locator('section.chip-daily');
const table = (page: Page) => daily(page).locator('.cd-wrap, .cd-cards').first();

for (const width of [375, 393]) {
  test(`每日籌碼：${width}pt 寬度預設展開、表格不需要左右滑動（信用、借券當沖兩種檢視、兩種期間；M3 只有張）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await gotoDaily(page);
    const toggle = daily(page).getByRole('button', { name: '每日籌碼' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(table(page)).toHaveAttribute('data-mode', 'table');
    const noScroll = async () => {
      const d = await table(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(d.sw).toBeLessThanOrEqual(d.cw);
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(doc.sw).toBeLessThanOrEqual(doc.cw);
    };
    await expect(page.getByRole('combobox', { name: '單位' })).toHaveCount(0); // M3：移除單位切換
    for (const view of ['信用', '借券當沖']) {
      await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: view }).click();
      for (const n of ['5 日', '60 日']) {
        await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: n }).click();
        await expect(table(page)).toHaveAttribute('data-mode', 'table');
        await noScroll();
      }
    }
  });
}

test('每日籌碼（子頁）：法人分段已移到籌碼分頁；信用檢視固定 4 欄＋日期（MM/DD），收盤與漲跌在日期下方；區間合計在最上方；單位只在右上角', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await gotoDaily(page);
  await expect(page.getByRole('combobox', { name: '單位' })).toHaveCount(0);
  const views = page.getByRole('group', { name: '檢視' }).getByRole('button');
  await expect(views).toHaveText(['信用', '借券當沖']);
  await expect(views.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('insti-footnote')).toHaveCount(0);

  const region = page.getByRole('region', { name: '每日籌碼明細・信用' });
  const heads = region.locator('thead th');
  await expect(heads).toHaveCount(5);
  await expect(region.locator('thead th .cd-h')).toHaveText(['融資增減', '融券增減', '融資餘額', '券資比']);
  await expect(region.locator('tbody tr').first()).toContainText('區間合計');
  await expect(region.locator('tbody tr.day')).toHaveCount(10);
  await expect(region.locator('tbody tr.day').first().locator('th .cd-sub')).toHaveText(/^[\d,.]+[▲▼－][\d.]+%$/); // 收盤與漲跌分兩行
  await expect(region.locator('tbody tr.day').first().locator('th .cd-date')).toHaveText(/^\d{2}\/\d{2}$/); // MM/DD
  await expect(daily(page).locator('.cd-unit-label')).toHaveText('單位：張');
  await expect(heads.nth(1).locator('.cd-h')).not.toContainText('張');
  const dateStyle = await region.locator('tbody tr.day').first().locator('.cd-date').evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(dateStyle).toBe('none');
  await page.getByRole('group', { name: '檢視' }).getByRole('button', { name: '借券當沖' }).click();
  await expect(page.getByRole('region', { name: '每日籌碼明細・借券當沖' }).locator('thead th .cd-h')).toHaveText(['借券賣出', '借券賣出餘額', '當沖比率', '當沖量']);
  await expect(daily(page).locator('.cd-unit-label')).toHaveText('單位：張');
  await expect(daily(page)).not.toContainText('萬');
});

test('每日籌碼：M3 一律完整千分位整數張（不縮寫、不帶小數、0 不帶箭頭）；正負同時用紅綠與 ▲▼；每列至少 44pt；VoiceOver 唸完整句子', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 852 });
  await gotoDaily(page);
  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '60 日' }).click();
  const region = page.getByRole('region', { name: /每日籌碼明細/ });
  const texts = await region.locator('tbody td .cd-t').allInnerTexts();
  for (const t of texts) expect(t).toMatch(/^(—|[▲▼]?\d{1,3}(,\d{3})*|[\d.]+%)$/); // 張：千分位整數；比率：%
  for (const t of texts) expect(t).not.toMatch(/^[▲▼]0$/); // 0 不帶箭頭
  for (const t of texts) expect(t).not.toMatch(/萬|千|K|M/);
  await expect(page.getByTestId('chip-unit-label')).toHaveText('單位：張');
  const cell = region.locator('tbody tr.day td.cd-v.up, tbody tr.day td.cd-v.down').first();
  const [cls, txt] = await cell.evaluate((el) => [el.className, el.textContent]);
  expect(txt).toMatch(cls.includes('up') ? /▲/ : /▼/);
  const h = await region.locator('tbody tr.day').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  const btn = region.locator('tbody tr.day').first().getByRole('button');
  await expect(btn).toHaveAttribute('aria-label', /^\d+ 月 \d+ 日，(融資(增加|減少|持平)( [\d,]+ 張)?|融資增減沒有資料)，.+券資比.+/);
});

test('每日籌碼：點一列從底部拉出當天完整資料（含自營商避險、成交量、官方來源、複製這天資料）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoDaily(page);
  await page.getByRole('region', { name: /每日籌碼明細/ }).locator('tbody tr.day').first().click();
  const sheet = page.getByRole('dialog', { name: /月 \d+ 日（.）籌碼/ });
  await expect(sheet).toBeVisible();
  for (const label of ['收盤', '漲跌', '成交量', '外資', '投信', '自營商（自行買賣）', '自營商（避險）', '三大法人合計', '融資增減', '融券增減', '借券賣出', '當沖比率']) {
    await expect(sheet.locator('dt', { hasText: new RegExp(`^${label.replace(/[（）]/g, '.')}`) }).first()).toBeVisible();
  }
  const link = sheet.getByRole('link', { name: '證交所・三大法人買賣超' });
  await expect(link).toHaveAttribute('href', /twse\.com\.tw\/rwd\/zh\/fund\/T86\?date=\d{8}&selectType=ALLBUT0999&response=html/);
  await expect(link).toHaveAttribute('target', '_blank');
  await sheet.getByRole('button', { name: '複製這天資料' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^台積電 2330 \d{4}-\d{2}-\d{2}\n收盤\t/);
  expect(text).toContain('自營商（避險）(張)\t');
});

test('每日籌碼：收合後記住偏好（IndexedDB）', async ({ page }) => {
  await gotoDaily(page);
  const toggle = daily(page).getByRole('button', { name: '每日籌碼' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#chip-daily-body')).toHaveCount(0);
  await page.reload();
  await expect(daily(page).getByRole('button', { name: '每日籌碼' })).toHaveAttribute('aria-expanded', 'false');
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('twse-money-flow');
    r.onsuccess = () => { const g = r.result.transaction('settings').objectStore('settings').get('chipDailyOpen'); g.onsuccess = () => res(g.result?.value); };
  }));
  expect(stored).toBe(false);
  await daily(page).getByRole('button', { name: '每日籌碼' }).click();
  await page.reload();
  await expect(daily(page).getByRole('button', { name: '每日籌碼' })).toHaveAttribute('aria-expanded', 'true');
});

test('每日籌碼：放大字級（約 Dynamic Type +2）時寬度不夠自動改為卡片（2×2）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 852 });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '125%'; }));
  await gotoDaily(page);
  const cards = daily(page).locator('.cd-cards');
  await expect(cards).toHaveAttribute('data-mode', 'cards');
  const first = cards.locator('li.cd-card.day').first();
  await expect(first.locator('.cd-cell')).toHaveCount(4);
  const boxes = await first.locator('.cd-cell').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  expect(new Set(boxes.map((b) => b[0])).size).toBe(2); // 兩欄
  expect(new Set(boxes.map((b) => b[1])).size).toBe(2); // 兩列
  const d = await cards.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(d.sw).toBeLessThanOrEqual(d.cw);
  await expect(first.getByRole('button')).toHaveAttribute('aria-label', /^\d+ 月 \d+ 日，融資/);
  await first.click();
  await expect(page.getByRole('dialog', { name: /籌碼/ })).toBeVisible();
});

test('每日籌碼：橫向寬度同時顯示全部欄位，不需要切換檢視', async ({ page }) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await gotoDaily(page);
  const region = page.getByRole('region', { name: '每日籌碼明細・全部欄位' });
  await expect(region).toHaveAttribute('data-mode', 'all');
  await expect(page.getByRole('group', { name: '檢視' })).toHaveCount(0);
  await expect(region.locator('thead tr:last-child th')).toHaveCount(9);
  await expect(region.locator('thead th[scope="colgroup"]')).toHaveText(['信用', '借券當沖']);
  const d = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(d.sw).toBeLessThanOrEqual(d.cw);
  expect(d.right).toBeLessThanOrEqual(852);
});

test('每日籌碼：「⋯」選單的複製為 CSV（標題帶單位、含區間合計）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoDaily(page);
  await page.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '5 日' }).click();
  await daily(page).getByRole('button', { name: '更多動作' }).click();
  await page.getByRole('menuitem', { name: '複製為 CSV' }).click();
  await expect(daily(page).locator('.cd-status')).toHaveText(/已複製 CSV（5 日，單位：張）/);
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  const lines = csv.trim().split('\n');
  expect(lines[0]).toContain('2330');
  expect(lines[1]).toBe('日期,收盤,漲跌(%),外資(張),投信(張),自營商（自行買賣）(張),自營商（避險）(張),三大法人合計(張),融資增減(張),融券增減(張),借券賣出(張),當沖比率(%)');
  expect(lines[2]).toMatch(/^區間合計\(5日\),/);
  expect(lines).toHaveLength(8); // 說明、標題、合計、5 日
});

test('單位名稱沒有「估成交量」錯字（全站）', async ({ page }) => {
  for (const hash of ['#/stock/2330', '#/me/methodology']) {
    await page.goto(hash);
    await expect(page.locator('body')).not.toContainText('估成交量');
  }
});

test('法人柱狀圖（2026-10-06）：Y 軸帶單位（張），點長條時上方固定資訊列顯示日期、法人、數值與收盤漲跌；圖例一行；左右鍵逐日', async ({ page }) => {
  await gotoStockSeg(page, '#/stock/2330', '籌碼');
  const fig = page.getByTestId('insti-bars');
  await expect(fig).toBeVisible({ timeout: 15_000 });
  await expect(fig.locator('.ib-grid')).toContainText(/張/);
  await expect(page.getByTestId('sec-insti').locator('.if-legend')).toHaveText('紅色＝淨買超・綠色＝淨賣超');
  await expect(fig.getByTestId('ib-info')).toContainText(/最大 [\d,]+ 張/);
  const plot = fig.locator('.ib-plot');
  await plot.scrollIntoViewIfNeeded();
  await plot.focus();
  await page.keyboard.press('ArrowLeft');
  const info = fig.getByTestId('ib-info');
  await expect(info).toContainText(/\d{2}\/\d{2} 外資 ([▲▼]?[\d,]+ 張|尚未公布|尚未更新)/);
  await expect(info).toContainText(/收盤/);
  await expect(fig.locator('.sc2-readout')).toHaveCount(0); // 不再用浮在圖上的卡片
  await page.keyboard.press('Escape');
  await expect(info).toContainText('最大');
});

test('明確不做的分點資料：說明收在法人區塊的 ⓘ（2026-10 改版：說明進 ⓘ）', async ({ page }) => {
  await gotoStockSeg(page, '#/stock/2330', '籌碼');
  await page.getByTestId('sec-insti').getByRole('button', { name: '法人的說明' }).click();
  await expect(page.getByRole('dialog')).toContainText('券商分點資料不提供（官方查詢頁有驗證碼）');
  await expect(page.getByText(/八大行庫/)).toHaveCount(0);
});
