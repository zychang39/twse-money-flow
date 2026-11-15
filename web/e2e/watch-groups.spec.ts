import { expect, test, type Page } from '@playwright/test';

// 自選群組（2026-11-15；DECISIONS #466、#467）。
// 群組列：群組…｜系統清單｜＋；右邊固定「編輯」。沒有「全部」：一次看一個群組，清單全部列出、依加入順序。
// 換順序：在群組列上按住一個群組，直接左右拖曳（#469）；按住不會進編輯。
// 編輯直接在頁面上展開（不另開面板）：改名、刪除（可復原）、拖曳排序、顯示或隱藏系統清單。

async function seed(page: Page) {
  await page.goto('#/mine?seg=watch');
  await page.getByRole('button', { name: '加入自選股' }).first().click();
  await expect(page.getByTestId('watch-import')).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText('2330 台積電\n2317 鴻海'));
  await page.getByTestId('import-paste').click();
  await page.getByTestId('import-add').click();
  await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「預設」');
  await page.getByPlaceholder('預設').fill('Latest');
  await page.evaluate(() => navigator.clipboard.writeText('2454 聯發科\n0050 元大台灣50'));
  await page.getByTestId('import-paste').click();
  await page.getByTestId('import-add').click();
  await expect(page.getByTestId('import-msg')).toHaveText('已加入 2 檔到「Latest」');
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0); // 面板收合動畫結束
}
const chips = (page: Page) => page.getByRole('group', { name: '群組' });
const chip = (page: Page, name: string | RegExp) => chips(page).getByRole('button', { name });
const editor = (page: Page) => page.getByTestId('group-editor');
/** 群組列上使用者群組的名稱（不含系統清單與「＋」） */
const names = async (page: Page) => (await chips(page).getByRole('button').allTextContents()).filter((t) => t && !t.startsWith('熱門動能'));
/** 可點範圍的高度（視覺上較小的膠囊用 ::before 往上下擴大） */
const hitHeight = (l: import('@playwright/test').Locator) => l.evaluate((el) => {
  const r = el.getBoundingClientRect(), b = getComputedStyle(el, '::before');
  if (!b.content || b.content === 'none' || b.position !== 'absolute') return r.height;
  return r.height - parseFloat(b.top) - parseFloat(b.bottom);
});
const rowNames = (page: Page) => page.locator('.stock-list .srow').evaluateAll((els) => els.map((el) => el.querySelector('.body')?.textContent ?? ''));

test.describe('自選群組', () => {
  test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

  test('沒有「全部」：一次看一個群組，全部列出、依加入順序，不收合；記得上次看的群組', async ({ page }) => {
    await seed(page);
    expect(await names(page)).toEqual(['預設', 'Latest']);
    await expect(chip(page, '全部')).toHaveCount(0);
    // 第一個群組是預設顯示的；清單全部列出（沒有「未達門檻」的收合），依加入順序
    await expect(chip(page, '預設')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /未達門檻/ })).toHaveCount(0);
    await expect.poll(() => rowNames(page)).toEqual(['台積電', '鴻海']);
    await expect(page.getByLabel('排序')).toHaveValue('custom');
    await expect(page.locator('.sort-select option').first()).toHaveText('加入順序');
    await chip(page, 'Latest').click();
    await expect.poll(() => rowNames(page)).toEqual(['聯發科', '元大台灣50']);
    await expect(page.locator('.page').first()).toContainText('2 檔・左滑可移除或移到其他群組');
    // 重新整理後還在 Latest
    await page.reload();
    await expect(chip(page, 'Latest')).toHaveAttribute('aria-pressed', 'true');
    // 群組是小膠囊（不拉滿整列）：看起來高 36、寬度依名稱；可點範圍仍然至少 44pt
    const a = (await chip(page, '預設').boundingBox())!;
    const b = (await chip(page, 'Latest').boundingBox())!;
    expect(Math.round(a.height)).toBe(36);
    expect(a.width).toBeLessThan(90);
    expect(b.width).toBeLessThan(100);
    expect(await hitHeight(chip(page, '預設'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(page.getByTestId('group-new'))).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('group-edit').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('按「＋」：編輯區在頁面上展開（不是面板），打名字建立後直接切到新群組；空狀態可以加股票', async ({ page }) => {
    await seed(page);
    await page.getByTestId('group-new').click();
    await expect(editor(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); // 沒有另開一層
    await expect(page.getByTestId('group-new-name')).toBeFocused();
    await page.getByTestId('group-new-name').fill('Latest');
    await page.getByTestId('group-new-submit').click();
    await expect(page.getByRole('alert')).toHaveText('已經有「Latest」這個群組');
    await page.getByTestId('group-new-name').fill('觀察中');
    await page.getByTestId('group-new-name').press('Enter');
    await expect(editor(page)).toHaveCount(0); // 建立後收起來
    await expect(chip(page, '觀察中')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('group-empty')).toContainText('「觀察中」還沒有股票');
    await page.reload();
    await expect(chip(page, '觀察中')).toHaveAttribute('aria-pressed', 'true'); // 還沒有股票的群組也記得
    // 空狀態的「加入股票」→ 加進這個群組
    await page.getByTestId('group-empty').getByRole('button', { name: '加入股票' }).click();
    await page.evaluate(() => navigator.clipboard.writeText('2412 中華電'));
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-add')).toHaveText('加入 1 檔到「觀察中」');
  });

  test('編輯：改名、刪除時把股票移走並可復原；空群組直接刪；「完成」或 Esc 收起來', async ({ page }) => {
    await seed(page);
    await chip(page, 'Latest').click();
    await page.getByTestId('group-edit').click();
    await expect(editor(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('group-row-Latest')).toContainText('2 檔');
    // 改名：目前正在看的群組跟著換名字
    await page.getByRole('button', { name: '把「Latest」改名' }).click();
    await page.getByLabel('「Latest」的新名稱').fill('最新');
    await page.getByRole('button', { name: '儲存' }).click();
    await expect(page.getByTestId('group-msg')).toHaveText('已改名為「最新」');
    // 刪除有股票的群組：在那一列展開兩個選擇，預設把股票移到「預設」
    await page.getByRole('button', { name: '刪除群組「最新」' }).click();
    await expect(page.getByRole('group', { name: '刪除「最新」' })).toContainText('裡有 2 檔股票');
    await page.getByTestId('group-delete-move').click();
    await expect(page.getByTestId('undo-toast')).toContainText('已刪除「最新」，2 檔移到「預設」');
    await expect(page.getByTestId('group-row-預設')).toContainText('4 檔');
    await expect(page.getByTestId('group-row-最新')).toHaveCount(0);
    // 復原：群組與股票都回到原位
    await page.getByTestId('undo-toast').getByRole('button', { name: '復原' }).click();
    await expect(page.getByTestId('group-row-最新')).toContainText('2 檔');
    await expect(page.getByTestId('group-row-預設')).toContainText('2 檔');
    // 空群組：不用確認，直接刪
    await page.getByTestId('group-new-name').fill('暫存');
    await page.getByTestId('group-new-submit').click();
    await expect(page.getByTestId('group-row-暫存')).toContainText('還沒有股票');
    await page.getByRole('button', { name: '刪除群組「暫存」' }).click();
    await expect(page.getByTestId('group-row-暫存')).toHaveCount(0);
    await expect(page.getByTestId('undo-toast')).toContainText('已刪除「暫存」');
    // 完成：回到群組列，正在看的是改名後的群組
    await page.getByTestId('group-done').click();
    await expect(editor(page)).toHaveCount(0);
    await expect(chip(page, '最新')).toHaveAttribute('aria-pressed', 'true');
    // Esc 也能收起來
    await page.getByTestId('group-edit').click();
    await page.getByTestId('group-new-name').press('Escape');
    await expect(editor(page)).toHaveCount(0);
  });

  test('「預設」與熱門動能可以拿掉，再從「快速加入」一點加回來', async ({ page }) => {
    await seed(page);
    await expect(chip(page, /熱門動能/)).toBeVisible();
    await page.getByTestId('group-edit').click();
    // 系統清單：關掉開關就從群組列消失
    await page.getByRole('switch', { name: '在群組列顯示熱門動能' }).uncheck();
    await expect(page.getByTestId('group-quick-hot')).toBeVisible();
    // 「快速加入」的按鈕是小膠囊（看起來高 32），可點範圍仍然至少 44pt
    expect(Math.round((await page.getByTestId('group-quick-hot').boundingBox())!.height)).toBe(32);
    expect(await hitHeight(page.getByTestId('group-quick-hot'))).toBeGreaterThanOrEqual(44);
    // 加回來之後又關掉：「已加回」的訊息不會留在畫面上
    await page.getByTestId('group-quick-hot').click();
    await expect(page.getByTestId('group-msg')).toHaveText('已加回「熱門動能」');
    await page.getByRole('switch', { name: '在群組列顯示熱門動能' }).uncheck();
    await expect(page.getByTestId('group-msg')).toHaveCount(0);
    // 刪除「預設」連同股票：正在看的群組換成剩下的第一個
    await page.getByRole('button', { name: '刪除群組「預設」' }).click();
    await page.getByTestId('group-delete-all').click();
    await expect(page.getByTestId('group-quick-default')).toBeVisible();
    await page.getByTestId('group-done').click();
    await expect.poll(() => names(page)).toEqual(['Latest']);
    await expect(chip(page, /熱門動能/)).toHaveCount(0);
    await expect(chip(page, 'Latest')).toHaveAttribute('aria-pressed', 'true');
    // 復原：股票與群組回來
    await expect(page.getByTestId('undo-toast')).toContainText('已刪除「預設」與 2 檔自選');
    await page.getByTestId('undo-toast').getByRole('button', { name: '復原' }).click();
    await expect(chip(page, '預設')).toBeVisible();
    await expect(page.locator('.page').first()).toContainText('自選 4 檔');
    // 快速加入：熱門動能一點就回來
    await page.getByTestId('group-edit').click();
    await page.getByTestId('group-quick-hot').click();
    await expect(page.getByRole('switch', { name: '在群組列顯示熱門動能' })).toBeChecked();
    await page.getByTestId('group-done').click();
    await expect(chip(page, /熱門動能/)).toBeVisible();
  });

  test('在群組列上按住一個群組，直接左右拖曳換順序；按住不會進編輯；沒移動就放開＝點選；順序記得住', async ({ page }) => {
    await seed(page);
    await page.getByTestId('group-new').click();
    await page.getByTestId('group-new-name').fill('觀察中');
    await page.getByTestId('group-new-submit').click();
    await expect(editor(page)).toHaveCount(0);
    await expect.poll(() => names(page)).toEqual(['預設', 'Latest', '觀察中']);
    await chip(page, '預設').click();
    const center = async (name: string) => { const r = (await chip(page, name).boundingBox())!; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    // 按住「觀察中」0.4 秒 → 浮起來（不是進編輯）→ 往左拖過「預設」→ 放開
    const from = await center('觀察中');
    const to = await center('預設');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await expect(chip(page, '觀察中')).toHaveClass(/dragging/);
    await expect(editor(page)).toHaveCount(0);
    await page.mouse.move(to.x - 12, to.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => names(page)).toEqual(['觀察中', '預設', 'Latest']);
    await expect(chip(page, '預設')).toHaveAttribute('aria-pressed', 'true'); // 拖曳不會切換群組
    // 往右拖一格：把「觀察中」拖到「預設」後面
    const f2 = await center('觀察中');
    const t2 = await center('預設');
    await page.mouse.move(f2.x, f2.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(t2.x + 12, t2.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => names(page)).toEqual(['預設', '觀察中', 'Latest']);
    // 按住但沒有移動就放開：當成一般的點選（不排序、不進編輯）
    const f3 = await center('Latest');
    await page.mouse.move(f3.x, f3.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(chip(page, 'Latest')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor(page)).toHaveCount(0);
    expect(await names(page)).toEqual(['預設', '觀察中', 'Latest']);
    // 右鍵（或系統的長按選單）也不會進編輯
    await chip(page, '預設').click({ button: 'right' });
    await expect(editor(page)).toHaveCount(0);
    // 快速點一下照常切換群組
    await chip(page, '預設').click();
    await expect(chip(page, '預設')).toHaveAttribute('aria-pressed', 'true');
    // 重新整理後順序還在
    await page.reload();
    await expect(chip(page, '預設')).toBeVisible();
    expect(await names(page)).toEqual(['預設', '觀察中', 'Latest']);
  });

  test('拖曳排序：按住三條線上下拖；鍵盤用上下鍵；順序記得住', async ({ page }) => {
    await seed(page);
    await page.getByTestId('group-new').click();
    await page.getByTestId('group-new-name').fill('觀察中');
    await page.getByTestId('group-new-submit').click();
    await expect(editor(page)).toHaveCount(0);
    await expect.poll(() => names(page)).toEqual(['預設', 'Latest', '觀察中']); // 新群組等設定重讀後出現在列上
    await page.getByTestId('group-edit').click();
    const rows = () => page.getByTestId('group-list').locator('.group-name .body').allTextContents();
    // 把最後一個（觀察中）拖到最前面
    const grip = page.getByRole('button', { name: '調整「觀察中」的順序' });
    await grip.scrollIntoViewIfNeeded();
    const first = await page.getByTestId('group-row-預設').boundingBox();
    const g = await grip.boundingBox();
    expect(g!.width).toBeGreaterThanOrEqual(44);
    await page.mouse.move(g!.x + g!.width / 2, g!.y + g!.height / 2);
    await page.mouse.down();
    await page.mouse.move(g!.x + g!.width / 2, first!.y + first!.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(rows).toEqual(['觀察中', '預設', 'Latest']);
    await expect(page.getByTestId('group-msg')).toHaveText('「觀察中」移到第 1 個');
    // 鍵盤：Latest 往上一格；焦點留在同一個把手上，可以連續移動
    const key = page.getByRole('button', { name: '調整「Latest」的順序' });
    await key.focus();
    await key.press('ArrowUp');
    await expect.poll(rows).toEqual(['觀察中', 'Latest', '預設']);
    await expect(key).toBeFocused();
    await key.press('ArrowUp');
    await expect.poll(rows).toEqual(['Latest', '觀察中', '預設']);
    await page.getByTestId('group-done').click();
    await expect.poll(() => names(page)).toEqual(['Latest', '觀察中', '預設']);
    await page.reload();
    await expect(chip(page, 'Latest')).toBeVisible();
    expect(await names(page)).toEqual(['Latest', '觀察中', '預設']);
  });
});
