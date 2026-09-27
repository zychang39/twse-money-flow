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
  const hero = page.locator('.hero').first();
  const chart = page.getByRole('img', { name: /走勢/ }).first();
  await expect(chart).toBeVisible();
  await page.waitForTimeout(1200); // 等數字滾動與描繪完成
  const latest = await hero.textContent();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await expect(page.locator('.hero-change .caption').first()).toHaveText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  const scrubbed = await hero.textContent();
  expect(scrubbed).not.toBe(latest);
  await page.mouse.move(box.x + box.width * 0.2, box.y - 200);
  await expect(hero).toHaveText(latest!);
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.hero-change .caption').first()).toHaveText(/\d{4}\/\d{1,2}\/\d{1,2}/);
  await page.keyboard.press('Escape');
  await expect(hero).toHaveText(latest!);
});

test('期間選擇器：選中者為實心膠囊，選擇會被記住；線與環境光同色', async ({ page }) => {
  await page.goto('#/stock/2330');
  const btn = page.getByRole('group', { name: '股價走勢期間' }).getByRole('button', { name: /^1Y/ });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hero-change .caption').first()).toHaveText('近 1 年');
  const stroke = await page.locator('.chart-line').first().getAttribute('stroke');
  const mood = await page.locator('.ambient').first().getAttribute('data-mood');
  expect(stroke === 'var(--up)' ? 'up' : stroke === 'var(--down)' ? 'down' : 'neutral').toBe(mood);
  await page.reload();
  await expect(page.getByRole('group', { name: '股價走勢期間' }).getByRole('button', { name: /^1Y/ })).toHaveAttribute('aria-pressed', 'true');
});

test('個股頁：同一清單左右切換（按鈕與拖曳手勢）', async ({ page }) => {
  await addWatch(page, ['2330', '2317', '0050']);
  await page.goto('#/mine?seg=watch');
  const quiet = page.getByRole('button', { name: /都沒有顯著變化|低於門檻/ });
  if (await quiet.count() && (await quiet.getAttribute('aria-expanded')) === 'false') await quiet.click();
  await page.locator('.srow').first().click();
  await expect(page.getByText(/自選 1 \/ 3/)).toBeVisible();
  const first = await page.locator('h1').textContent();
  await page.getByRole('button', { name: '下一檔' }).click();
  await expect(page.getByText(/自選 2 \/ 3/)).toBeVisible();
  await expect(page.locator('h1')).not.toHaveText(first!);
  // 在圖表以外的區域往右拖曳 → 上一檔（等頁面轉場結束）
  await page.waitForTimeout(600);
  const h = (await page.locator('h1').boundingBox())!;
  const y = h.y + h.height / 2;
  await page.mouse.move(h.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, y, { steps: 3 });
  await page.mouse.move(h.x + 200, y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/自選 1 \/ 3/)).toBeVisible();
});

test('底部面板：頭像選單可開啟、Esc 關閉；拖曳把手往下可關閉', async ({ page }) => {
  await page.goto('#/');
  await page.getByRole('button', { name: /帳戶選單/ }).click();
  const dialog = page.getByRole('dialog', { name: '我的' });
  await expect(dialog).toBeVisible();
  for (const name of ['設定', '備份', '資料健康', '方法說明']) await expect(dialog.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /帳戶選單/ }).click();
  await page.waitForTimeout(700); // 等面板滑入完成
  const grabber = page.locator('.sheet-head').first();
  const b = (await grabber.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 380, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '我的' })).toHaveCount(0);
});

test('清單列：長按（右鍵）叫出快速預覽；左滑露出移除', async ({ page }) => {
  await addWatch(page, ['2330', '2317']);
  await page.goto('#/mine?seg=watch');
  const quiet = page.getByRole('button', { name: /都沒有顯著變化|低於門檻/ });
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

test('今晚的紀律：捲到簡報底部即完成第一環', async ({ page }) => {
  await page.goto('#/');
  const panel = page.getByRole('group', { name: /今晚的紀律/ });
  await expect(panel).toContainText('捲到底即完成');
  await page.getByRole('region', { name: '我該記錄或檢討什麼？' }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 4000);
  await expect(panel).toContainText('已完成', { timeout: 5000 });
});

test('環境光：今晚頁代表資金環境（示範資料為保守 → 琥珀）；減少動態效果時退回純黑', async ({ page }) => {
  await page.goto('#/');
  await expect(page.locator('.ambient')).toHaveAttribute('data-mood', 'risk');
  await expect(page.locator('.ambient')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.ambient')).toBeHidden();
  await page.goto('#/explore');
  await expect(page.locator('.ambient')).toHaveCount(0);
});
