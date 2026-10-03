/**
 * v3 實驗室 M5 互動驗收（任一不符即失敗）：
 * 1. 排序選單開關，選擇後列表排序正確、標頭顯示目前排序與方向、選擇記住。
 * 2. 基準切換（sticky 分段控制）後捲動位置不變，列表數字跟著換基準。
 * 3. 累積超額曲線拖曳讀值（第 k 日、超額、95% 區間）。
 * 評估資料用 e2e/fixtures（data 分支 2026-09-30 本機重算）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');

async function useFixtures(page: Page) {
  const files = ['evidence.json', 'strategies.json', 'evidence_today.json', ...readdirSync(new URL('evidence/', FIX)).map((f) => `evidence/${f}`)];
  for (const f of files) await page.route(`**/data/${f}`, (route) => route.fulfill({ contentType: 'application/json', body: fixture(f) }));
}

const TIER: Record<string, number> = { 有效: 0, 環境依賴: 1, 不穩定: 2, 樣本不足: 3, 樣本範圍受限: 3, 無效: 4 };

test.describe('v3 實驗室互動', () => {
  test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });

  test('排序選單：預設判定分級，改成名稱後排序正確且記住', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/evidence');
    const list = page.getByTestId('ev-list');
    await expect(list.locator('.ev-label').first()).toBeVisible();
    await expect(page.getByTestId('sort-now-evidence')).toHaveText('排序：判定分級・由高到低');
    // 預設：判定分級不遞減
    const verdicts = await list.locator('.ev-verdict:first-child').allTextContents();
    const tiers = verdicts.map((v) => TIER[v.trim()] ?? 9);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    // 開啟選單 → 選「名稱」
    const btn = page.getByRole('button', { name: '排序', exact: true });
    await btn.click();
    const menu = page.getByRole('menu', { name: '排序方式' });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitemradio', { name: '名稱' }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('sort-now-evidence')).toHaveText('排序：名稱・筆畫少到多');
    const names = (await list.locator('.ev-label').allTextContents()).map((s) => s.trim());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
    // 方向切換
    await btn.click();
    await page.getByRole('menuitemradio', { name: '筆畫多到少' }).click();
    const rev = (await list.locator('.ev-label').allTextContents()).map((s) => s.trim());
    expect(rev).toEqual([...names].reverse());
    // Escape 關閉；重新整理後保留
    await btn.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '排序方式' })).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('sort-now-evidence')).toHaveText('排序：名稱・筆畫多到少');
  });

  test('基準切換後捲動位置不變，數字跟著換基準', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/evidence');
    const list = page.getByTestId('ev-list');
    await expect(list.locator('.ev-label').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(200);
    const bar = page.getByTestId('bench-switch');
    await expect(bar).toBeInViewport();
    await bar.getByRole('button', { name: '0050' }).click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    await expect(bar.getByRole('button', { name: '0050' })).toHaveAttribute('aria-pressed', 'true');
    // 2026-10-02 健檢：第一行固定是判定依據（等權），第二行才隨基準切換
    const judge = page.getByTestId('ev-row-high52').getByTestId('ev-line');
    await expect(judge).toContainText('判定依據（等權');
    const high = page.getByTestId('ev-row-high52').getByTestId('ev-bench-line');
    await expect(high).toContainText('相對0050');
    await expect(high).toContainText('超額勝率');
    await bar.getByRole('button', { name: '加權報酬' }).click();
    await page.waitForTimeout(150);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
    await expect(high).toContainText('相對加權報酬');
    await expect(judge).toContainText('判定依據（等權');
  });

  test('累積超額曲線：拖曳讀值、峰值日與 alpha 耗盡日有文字標示', async ({ page }) => {
    await useFixtures(page);
    await page.goto('./#/explore/strategies/near_high');
    const svg = page.locator('svg.ac-svg').first();
    await svg.scrollIntoViewIfNeeded();
    await expect(svg).toBeVisible();
    await expect(svg.locator('[data-mark="peak"] text')).toContainText('峰值');
    const box = (await svg.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
    const read = page.locator('.ac-read').first();
    await expect(read).toContainText(/第 \d+ 日：累積超額 [+−]?\d+\.\d{2}%（95% 區間 /);
    const kOf = async () => Number((await read.textContent())!.match(/第 (\d+) 日/)![1]);
    const k1 = await kOf();
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 5 });
    await expect.poll(kOf).toBeGreaterThan(k1);
    await page.mouse.up();
    // 鍵盤也能讀值
    await svg.focus();
    await page.waitForTimeout(100);
    const k2 = await kOf();
    await page.keyboard.press('ArrowLeft');
    await expect(read).toContainText(`第 ${k2 - 1} 日`);
    // 切到 0050 基準：曲線同步
    await page.getByTestId('bench-switch').getByRole('button', { name: '0050' }).click();
    await expect(page.getByRole('heading', { name: '累積超額曲線（相對0050）' })).toBeVisible();
  });
});
