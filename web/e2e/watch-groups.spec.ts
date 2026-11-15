import { expect, test, type Page } from '@playwright/test';

// 自選群組的建立、改名、刪除與復原（2026-11-15；DECISIONS #466）。
// 群組列：全部｜群組…｜系統清單｜＋；右邊固定「編輯」。長按（或右鍵）群組＝直接編輯那一個。

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

test.describe('自選群組管理', () => {
  test.beforeEach(async ({ context }) => { await context.grantPermissions(['clipboard-read', 'clipboard-write']); });

  test('按「＋」建立空群組 → 直接切過去，空狀態可以加股票；重新整理後還在', async ({ page }) => {
    await seed(page);
    await page.getByTestId('group-new').click();
    await page.getByTestId('group-new-name').fill('全部');
    await page.getByTestId('group-new-submit').click();
    await expect(page.getByRole('alert')).toContainText('請換一個名稱'); // 保留字
    await page.getByTestId('group-new-name').fill('Latest');
    await page.getByTestId('group-new-submit').click();
    await expect(page.getByRole('alert')).toHaveText('已經有「Latest」這個群組');
    await page.getByTestId('group-new-name').fill('觀察中');
    await page.getByTestId('group-new-name').press('Enter');
    await expect(chip(page, '觀察中')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('group-empty')).toContainText('「觀察中」還沒有股票');
    await page.reload();
    await chip(page, '觀察中').click(); // 還沒有股票的群組也記得（重新整理後回到「全部」是原本的行為）
    // 空狀態的「加入股票」→ 加進這個群組
    await page.getByTestId('group-empty').getByRole('button', { name: '加入股票' }).click();
    await page.evaluate(() => navigator.clipboard.writeText('2412 中華電'));
    await page.getByTestId('import-paste').click();
    await expect(page.getByTestId('import-add')).toHaveText('加入 1 檔到「觀察中」');
  });

  test('編輯：改名、刪除時把股票移走並可復原；空群組直接刪', async ({ page }) => {
    await seed(page);
    await chip(page, 'Latest').click();
    await page.getByTestId('group-edit').click();
    await expect(page.getByTestId('group-row-Latest')).toContainText('2 檔');
    // 改名：目前正在看的群組跟著換名字
    await page.getByRole('button', { name: '把「Latest」改名' }).click();
    await page.getByLabel('「Latest」的新名稱').fill('最新');
    await page.getByRole('button', { name: '儲存' }).click();
    await expect(page.getByTestId('group-msg')).toHaveText('已改名為「最新」');
    await expect(chip(page, '最新')).toHaveAttribute('aria-pressed', 'true');
    // 刪除有股票的群組：在那一列展開兩個選擇，預設把股票移到「預設」
    await page.getByRole('button', { name: '刪除群組「最新」' }).click();
    await expect(page.getByRole('group', { name: '刪除「最新」' })).toContainText('裡有 2 檔股票');
    await page.getByTestId('group-delete-move').click();
    await expect(page.getByTestId('group-undo')).toContainText('已刪除「最新」，2 檔移到「預設」');
    await expect(page.getByTestId('group-row-預設')).toContainText('4 檔');
    await expect(page.getByTestId('group-row-最新')).toHaveCount(0);
    // 復原：群組與股票都回到原位
    await page.getByTestId('group-undo').getByRole('button', { name: '復原' }).click();
    await expect(page.getByTestId('group-row-最新')).toContainText('2 檔');
    await expect(page.getByTestId('group-row-預設')).toContainText('2 檔');
    // 空群組：不用確認，直接刪
    await page.getByTestId('group-new-name').fill('暫存');
    await page.getByTestId('group-new-submit').click();
    await expect(page.getByTestId('group-row-暫存')).toContainText('還沒有股票');
    await page.getByRole('button', { name: '刪除群組「暫存」' }).click();
    await expect(page.getByTestId('group-row-暫存')).toHaveCount(0);
    await expect(page.getByTestId('group-undo')).toContainText('已刪除「暫存」');
  });

  test('「預設」與熱門動能可以拿掉，再從「快速加入」一點加回來；頁面底部的復原', async ({ page }) => {
    await seed(page);
    await expect(chip(page, /熱門動能/)).toBeVisible();
    await page.getByTestId('group-edit').click();
    // 系統清單：關掉開關就從群組列消失
    await page.getByRole('switch', { name: '在群組列顯示熱門動能' }).uncheck();
    await expect(page.getByTestId('group-quick-hot')).toBeVisible();
    // 刪除「預設」連同股票
    await page.getByRole('button', { name: '刪除群組「預設」' }).click();
    await page.getByTestId('group-delete-all').click();
    await expect(page.getByTestId('group-quick-default')).toBeVisible();
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(chip(page, '預設')).toHaveCount(0);
    await expect(chip(page, /熱門動能/)).toHaveCount(0);
    await expect(page.locator('.system-teaser')).toHaveCount(0);
    // 頁面底部的復原提示：股票與群組回來
    await expect(page.getByTestId('undo-toast')).toContainText('已刪除「預設」與 2 檔自選');
    await page.getByTestId('undo-toast').getByRole('button', { name: '復原' }).click();
    await expect(chip(page, '預設')).toBeVisible();
    await expect(page.locator('.page').first()).toContainText('自選 4 檔');
    // 快速加入：熱門動能一點就回來
    await page.getByTestId('group-edit').click();
    await page.getByTestId('group-quick-hot').click();
    await expect(page.getByRole('switch', { name: '在群組列顯示熱門動能' })).toBeChecked();
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(chip(page, /熱門動能/)).toBeVisible();
  });

  test('長按（或右鍵）群組：直接打開那個群組的改名；點擊區域至少 44pt', async ({ page }) => {
    await seed(page);
    const box = await chip(page, 'Latest').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('group-new').boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('group-edit').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 長按 0.5 秒
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.getByLabel('「Latest」的新名稱')).toHaveValue('Latest');
    await expect(chip(page, '全部')).toHaveAttribute('aria-pressed', 'true'); // 長按不會切換群組
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
    // 右鍵（桌機）
    await chip(page, '預設').click({ button: 'right' });
    await expect(page.getByLabel('「預設」的新名稱')).toHaveValue('預設');
  });
});
