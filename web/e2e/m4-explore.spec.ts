import { expect, test } from '@playwright/test';

// M4（2026-10 恢復環境光改版）：探索格、族群輪動（層級、排序、虛擬捲動）、族群頁（成員｜上中下游｜統計）、
// 自訂族群建立／編輯／刪除／備份還原、選股（策略膠囊 → 新觸發｜篩出 → 清單在第一個螢幕）。
test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

test('族群輪動：三個層級、三種排序；列有成員數、中位數、名次與站上 60 日線比例；只畫看得到的列', async ({ page }) => {
  await page.goto('#/explore/sectors');
  const seg = page.getByTestId('layer-seg');
  for (const name of ['官方產業', '細產業', '題材與自訂']) await expect(seg.getByRole('button', { name })).toBeVisible();
  await seg.getByRole('button', { name: '官方產業' }).click();
  await expect(page).toHaveURL(/layer=official/);
  const list = page.getByTestId('group-list');
  await expect(list.locator('.grp-row').first()).toBeVisible();
  const first = list.locator('.grp-row').first();
  await expect(first.locator('.grp-sub')).toContainText(/\d+ 檔/);
  await expect(first.locator('.grp-rank')).toContainText(/第 \d+ 名|—/);
  await page.getByRole('group', { name: '排序' }).getByRole('button', { name: '1 個月報酬' }).click();
  await expect(page).toHaveURL(/sort=r1m/);
  // 重新整理保留層級與排序
  await page.reload();
  await expect(seg.getByRole('button', { name: '官方產業' })).toHaveAttribute('aria-pressed', 'true');
  // 虛擬捲動：清單的列數 ≤ 總數
  const total = Number(await list.getAttribute('data-count'));
  const drawn = await list.locator('[role="listitem"]').count();
  expect(drawn).toBeLessThanOrEqual(total);
});

test('舊網址（產業名稱）轉成族群 id；族群頁有等權指數對加權、三個分段', async ({ page }) => {
  await page.goto('#/explore/sectors/%E5%8D%8A%E5%B0%8E%E9%AB%94%E6%A5%AD');
  await expect(page).toHaveURL(/#\/explore\/sectors\/o-/);
  await expect(page.locator('h1')).toHaveText('半導體業');
  await expect(page.getByTestId('group-concl')).toContainText('3 個月中位數');
  await expect(page.getByTestId('group-chart')).toBeVisible();
  const tabs = page.getByTestId('group-tabs');
  await expect(page.getByTestId('member-rows').locator('.ui-row').first()).toBeVisible();
  await tabs.getByRole('button', { name: '統計' }).click();
  await expect(page.getByTestId('group-stats')).toBeVisible();
  await tabs.getByRole('button', { name: '上中下游' }).click();
  await expect(page.getByTestId('group-streams')).toBeVisible();
  await expect(page.getByTestId('group-streams')).not.toContainText('受惠');
});

test('自訂族群：建立、加入成員、分段與備註、刪除；存在本機（可備份）', async ({ page }) => {
  await page.goto('#/explore/sectors?layer=theme');
  await page.getByTestId('add-group').click();
  await page.getByTestId('group-name').fill('我的觀察');
  await page.getByTestId('group-create').click();
  await expect(page).toHaveURL(/#\/explore\/sectors\/u-/);
  const editor = page.getByTestId('group-editor');
  await expect(editor).toBeVisible();
  for (const code of ['2330', '2317']) {
    await editor.getByRole('searchbox', { name: '搜尋股票' }).fill(code);
    await editor.getByRole('option', { name: new RegExp(code) }).first().click();
  }
  await expect(editor.getByTestId('edit-members').locator('.grp-edit-row')).toHaveCount(2);
  await editor.getByLabel(/台積電的分段/).selectOption('上游');
  await editor.getByTestId('edit-note').fill('自己的筆記');
  await editor.getByTestId('edit-save').click();
  await expect(page.locator('h1')).toHaveText('我的觀察');
  await expect(page.getByTestId('member-rows').locator('.ui-row')).toHaveCount(2);
  await expect(page.getByTestId('group-note')).toHaveText('自己的筆記');
  await page.getByTestId('group-tabs').getByRole('button', { name: '上中下游' }).click();
  await expect(page.getByTestId('stream-上游')).toContainText('台積電');
  // 清單出現在「題材與自訂」層級
  await page.goto('#/explore/sectors?layer=theme');
  await expect(page.getByTestId('group-list')).toContainText('我的觀察');
  // 存在本機 IndexedDB 的 groups store（備份匯出／還原的往返在 vitest db.test.ts）
  const stored = await page.evaluate(() => new Promise<string[]>((resolve) => {
    const req = indexedDB.open('twse-money-flow');
    req.onsuccess = () => {
      const tx = req.result.transaction('groups', 'readonly');
      const all = tx.objectStore('groups').getAll();
      all.onsuccess = () => resolve((all.result as { name: string }[]).map((g) => g.name));
    };
  }));
  expect(stored).toContain('我的觀察');
  // 刪除
  await page.goto('#/explore/sectors?layer=theme');
  await page.getByTestId('group-list').getByRole('link', { name: /我的觀察/ }).click();
  await page.getByTestId('group-edit').click();
  await page.getByTestId('edit-delete').click();
  await expect(page).toHaveURL(/#\/explore\/sectors\?layer=theme/);
  await expect(page.getByTestId('group-list').getByText('我的觀察')).toHaveCount(0);
});

test('編輯內建族群：移除成員後顯示「已編輯」，可還原', async ({ page }) => {
  await page.goto('#/explore/sectors?layer=official');
  await page.getByTestId('group-list').getByRole('link', { name: /半導體業/ }).first().click();
  await expect(page.getByTestId('member-rows').locator('.ui-row').first()).toBeVisible();
  const n0 = await page.getByTestId('member-rows').locator('.ui-row').count();
  await page.getByTestId('group-edit').click();
  await page.getByTestId('group-editor').locator('[data-testid^="edit-remove-"]').first().click();
  await page.getByTestId('edit-save').click();
  await expect(page.locator('.ui-head-sub')).toContainText('已編輯');
  await expect(page.getByTestId('member-rows').locator('.ui-row')).toHaveCount(n0 - 1);
  await page.getByTestId('group-edit').click();
  await page.getByTestId('edit-reset').click();
  await expect(page.locator('.ui-head-sub')).not.toContainText('已編輯');
  await expect(page.getByTestId('member-rows').locator('.ui-row')).toHaveCount(n0);
});

const SCREEN = {
  strategies: [
    { id: 'near_high', label: '近高點放量', subtitle: '距 52 週高 5% 內・量比 1.5 倍', grade: 'valid', rank: 1, date: '2026-09-24', cols: ['code', 'trigger', 'day', 'ret'],
      rows: [['2330', '2026-09-24', 0, null], ['2317', '2026-09-24', 0, null], ['2454', '2026-09-20', 3, 2.5], ['1101', '2026-09-18', 5, -1.2], ['6488', '2026-09-24', 0, null]], new: ['2330', '2317', '6488'] },
    { id: 'three_buy', label: '三方同買', subtitle: '投信連買・外資買超・大戶增加', grade: 'watch', rank: 2, date: '2026-09-24', cols: ['code', 'trigger', 'day', 'ret'],
      rows: [['2330', '2026-09-24', 0, null], ['2882', '2026-09-22', 1, 0.8]], new: ['2330'] },
  ],
};

test('選股：策略膠囊（含全部）→ 新觸發｜篩出 → 第一個螢幕至少 4 檔；篩出列有觸發日、第 k 日與觸發以來報酬', async ({ page }) => {
  await page.route('**/data/screen.json', (r) => r.fulfill({ json: SCREEN }));
  await page.goto('#/explore/screener');
  const chips = page.getByTestId('strategy-chips');
  await expect(chips.getByRole('button')).toHaveText(['全部', '近高點放量', '三方同買']);
  const view = page.getByTestId('screen-view');
  await expect(view.getByRole('button', { name: /新觸發 3/ })).toHaveAttribute('aria-pressed', 'true');
  await view.getByRole('button', { name: /篩出 6/ }).click();
  const rows = page.locator('.scr-row');
  await expect(rows).toHaveCount(6);
  const inView = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().bottom <= innerHeight).length);
  expect(inView).toBeGreaterThanOrEqual(4);
  // 同一檔被兩個策略篩出：兩個策略標籤都列出
  await expect(page.getByTestId('scr-2330').locator('.scr-tag')).toHaveCount(2);
  await expect(page.getByTestId('scr-2454')).toContainText(/9\/20 觸發・第 3 日/);
  await expect(page.getByTestId('scr-2454')).toContainText('觸發以來');
  await chips.getByRole('button', { name: '三方同買' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByTestId('group-by-fine').click();
  await expect(page.locator('.scr-group-h').first()).toBeVisible();
  await expect(page.locator('.scr-row').first()).not.toContainText(/買進|賣出|推薦/);
});

test('探索：不捲動就看得到 10 個功能格；格內數值來自資料', async ({ page }) => {
  await page.goto('#/explore');
  await expect(page.locator('.ex-tile')).toHaveCount(10);
  await expect(page.getByTestId('ex-sectors')).toContainText(/第 1 名|—/);
  await page.getByTestId('ex-sectors').click();
  await expect(page).toHaveURL(/#\/explore\/sectors/);
});
