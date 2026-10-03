import { expect, test, type Page } from '@playwright/test';

// 新互動：主角數字拖曳／hover、鍵盤查看、期間切換、個股左右切換、底部面板、長按預覽、左滑動作、三環、減少動態效果。

async function addWatch(page: Page, codes: string[]) {
  await page.goto('#/mine?seg=watch');
  await page.getByRole('button', { name: '加入自選股' }).first().click();
  for (const code of codes) {
    await page.getByRole('searchbox', { name: '搜尋股票' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).click();
  }
  await page.getByRole('button', { name: '關閉' }).click();
}

test('主角數字：hover／拖曳時數字與日期即時變動，離開後恢復最新值；鍵盤左右鍵也可查看', async ({ page }) => {
  await page.goto('#/stock/2330');
  // 2026-10 改版：個股頁主角價格（Title2）在 StockChart；hover＝十字線讀值
  const hero = page.getByTestId('stock-price').first();
  const chart = page.getByRole('img', { name: /走勢/ }).first();
  await expect(chart).toBeVisible();
  await page.waitForTimeout(1200); // 等數字滾動與描繪完成
  const latest = await hero.textContent();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await expect(page.getByTestId('crosshair-tip')).toContainText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  const scrubbed = await hero.textContent();
  expect(scrubbed).not.toBe(latest);
  await page.mouse.move(box.x + box.width * 0.2, box.y - 200);
  await expect(hero).toHaveText(latest!);
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('hero-change').first()).toContainText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  await expect(hero).not.toHaveText(latest!);
  await page.keyboard.press('Escape');
  await expect(hero).toHaveText(latest!);
});

test('期間選擇器：選中者為實心格，選擇會被記住；所選區間漲跌一行（「1Y +12.34%」）', async ({ page }) => {
  await page.goto('#/stock/2330');
  const btn = page.getByRole('group', { name: '股價走勢期間' }).getByRole('button', { name: /^1Y/ });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hero-period-change').first()).toContainText(/^1Y\s*[^\d]*[+−]?[\d.]+%|^1Y/);
  await page.reload();
  await expect(page.getByRole('group', { name: '股價走勢期間' }).getByRole('button', { name: /^1Y/ })).toHaveAttribute('aria-pressed', 'true');
});

test('個股頁：同一清單左右切換（按鈕與拖曳手勢）', async ({ page }) => {
  await addWatch(page, ['2330', '2317', '0050']);
  await page.goto('#/mine?seg=watch');
  const quiet = page.getByRole('button', { name: /未達門檻|都沒有顯著變化|低於門檻/ });
  if (await quiet.count() && (await quiet.getAttribute('aria-expanded')) === 'false') await quiet.click();
  await page.locator('.srow').first().click();
  await expect(page.getByTestId('list-position')).toHaveText(/自選\S* 1\/3/);
  // 主角區是「前一檔｜目前｜後一檔」的軌道：只看目前這一檔的標題（相鄰的兩檔 aria-hidden）
  const title = page.getByRole('heading', { level: 1 });
  const first = await title.textContent();
  await page.getByRole('button', { name: '下一檔' }).click();
  await expect(page.getByTestId('list-position')).toHaveText(/自選\S* 2\/3/);
  await expect(title).not.toHaveText(first!);
  // 在名稱附近往右拖曳 → 上一檔（等滑動動畫結束）
  await page.waitForTimeout(600);
  const h = (await title.boundingBox())!;
  const y = h.y + h.height / 2;
  await page.mouse.move(h.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, y, { steps: 3 });
  await page.mouse.move(h.x + 200, y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('list-position')).toHaveText(/自選\S* 1\/3/);
});

test('右上角齒輪推入設定頁；說明面板可開啟、Esc 關閉；拖曳把手往下可關閉', async ({ page }) => {
  await page.goto('#/');
  await page.getByTestId('gear').first().click();
  await expect(page).toHaveURL(/#\/me\/settings/);
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
  await page.goto('#/me/glossary');
  await page.getByTestId('term-atr14').click();
  const dialog = page.getByRole('dialog', { name: 'ATR14' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('term-atr14').click();
  await page.waitForTimeout(700); // 等面板滑入完成
  const grabber = page.locator('.sheet-head').first();
  const b = (await grabber.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 380, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'ATR14' })).toHaveCount(0);
});

test('清單列：長按（右鍵）叫出快速預覽；左滑露出移除', async ({ page }) => {
  await addWatch(page, ['2330', '2317']);
  await page.goto('#/mine?seg=watch');
  const quiet = page.getByRole('button', { name: /未達門檻|都沒有顯著變化|低於門檻/ });
  if (await quiet.count() && (await quiet.getAttribute('aria-expanded')) === 'false') await quiet.click();
  const row = page.getByRole('button', { name: /鴻海 2317/ });
  await row.dispatchEvent('contextmenu');
  const preview = page.getByRole('dialog', { name: /鴻海 2317/ });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: '開啟個股頁' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  await row.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(box.x + box.width - 200, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByRole('button', { name: /鴻海 2317/ })).toHaveCount(0);
});

test('流程：看完簡報的市場分段即完成第 1 步（總覽的今日流程 0/1 → 1/1）', async ({ page, request }) => {
  // 三環依交易日計算：把時間固定在資料日 20:00（台北），簡報環對應的就是這份資料
  const { date } = await (await request.get('data/summary.json')).json() as { date: string };
  await page.clock.setFixedTime(new Date(`${date}T20:00:00+08:00`));
  await page.goto('#/');
  const row = page.getByTestId('flow-brief-row');
  await expect(row).toContainText('0/1');
  await page.getByTestId('brief-seg').getByRole('button', { name: '市場' }).click();
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(1200);
  await page.getByTestId('brief-seg').getByRole('button', { name: '總覽' }).click();
  await expect(row).toContainText('1/1', { timeout: 5000 });
  await row.click();
  await expect(page).toHaveURL(/#\/discipline$/);
  await expect(page.getByTestId('ring-brief')).toContainText('已完成');
});

test('環境光（恢復改版前）：背景純黑，環境光由 y=0 開始、顏色跟隨主標漲跌；導覽列預設透明', async ({ page }) => {
  await page.goto('#/dev');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  const amb = page.getByTestId('ambient');
  await expect(amb).toHaveAttribute('data-mood', 'up');
  const st = await amb.evaluate((el) => ({ top: el.getBoundingClientRect().top, bg: getComputedStyle(el.querySelector('i.on')!).backgroundImage }));
  expect(st.top).toBe(0);
  expect(st.bg).toContain('radial-gradient');
  const nav = await page.getByTestId('topbar').evaluate((el) => getComputedStyle(el, '::before').opacity);
  expect(nav).toBe('0');
});
