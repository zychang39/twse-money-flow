import { expect, test, type Page } from '@playwright/test';
import { gotoStockSeg, revealAllSections } from './helpers';

// 第 1 輪 M6：U-03 點擊區域 ≥ 44pt、U-04 表頭不斷行、U-05 理由兩行、U-06 中文不斷在詞中間；375 與 393pt 寬度。

const TAP_SEL = '.segmented button, .chip, .btn, .sort-select, .range-seg button, .text-btn, .icon-btn, .periods button, .env-pill, .search-clear, details.tech summary';

/** 每個可點元件的實際可點高度（含 ::before 擴大）與寬度；回傳不足 44 的清單 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[inert], [aria-hidden="true"]')) continue;
      const b = getComputedStyle(el, '::before');
      let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
      if (b.content && b.content !== 'none' && b.position === 'absolute') {
        top = Math.min(top, r.top + parseFloat(b.top));
        bottom = Math.max(bottom, r.bottom - parseFloat(b.bottom));
        left = Math.min(left, r.left + parseFloat(b.left));
        right = Math.max(right, r.right - parseFloat(b.right));
      }
      if (bottom - top < 43.5) bad.push(`${el.className || el.tagName}「${(el.textContent ?? '').trim().slice(0, 10)}」高 ${Math.round(bottom - top)}`);
      else if (right - left < 24) bad.push(`${el.className}「${(el.textContent ?? '').trim().slice(0, 10)}」寬 ${Math.round(right - left)}`);
    }
    return bad;
  }, TAP_SEL);
}

for (const width of [375, 393]) {
  test.describe(`${width}pt`, () => {
    test.use({ viewport: { width, height: 852 } });

    test('U-03：個股頁、我的股票、探索、紀律的點擊區域都至少 44pt（視覺小的用 ::before 擴大）', async ({ page }) => {
      await page.goto('#/stock/2330');
      await revealAllSections(page);
      expect(await smallTargets(page)).toEqual([]);
      // ::before 擴大的範圍真的可以點到：點在分段按鈕視覺範圍上方 3px 仍命中該按鈕（M3：風險試算在「動能 → 波動與部位」詳情頁）
      await page.goto('#/stock/2330/m/risk');
      expect(await smallTargets(page)).toEqual([]);
      const seg = page.getByTestId('risk-calc').getByRole('button', { name: '3 倍 ATR' });
      // 捲到畫面中間（scrollIntoViewIfNeeded 可能停在透明導覽列底下）；先等換頁的捲動位置還原結束
      await expect(seg).toBeVisible();
      await page.waitForTimeout(500);
      await seg.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(100);
      const b = (await seg.boundingBox())!;
      expect(b.height).toBeLessThan(44);
      await page.mouse.click(b.x + b.width / 2, b.y - 3);
      await expect(seg).toHaveAttribute('aria-pressed', 'true');
      for (const hash of ['#/mine', '#/explore', '#/discipline', '#/discipline/journal', '#/me/backup']) {
        await page.goto(hash);
        await expect(page.locator('h1').first()).toBeVisible();
        await page.waitForTimeout(400);
        expect(await smallTargets(page), hash).toEqual([]);
      }
    });

    test('U-04（2026-10 改版）：法人表、信用表、股權分散表的表頭都單行、不截斷', async ({ page }) => {
      await gotoStockSeg(page, '#/stock/2330', '籌碼');
      await expect(page.getByTestId('insti-daily')).toBeVisible();
      const heads = await page.locator('.ui-table th, [data-testid="insti-daily"] thead th').evaluateAll((ths) => ths.map((th) => {
        // 只量文字本身的行（名詞按鈕上下擴大的點擊區不算一行）
        const tops = new Set<number>();
        const tw = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (n.parentElement?.closest('.sr-only')) continue; // 螢幕閱讀器專用文字不佔版面
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
        }
        return { text: (th.textContent ?? '').trim(), lines: tops.size, clipped: th.scrollWidth > th.clientWidth + 1 };
      }).filter((x) => x.text));
      expect(heads.length).toBeGreaterThan(8);
      for (const h of heads) { expect(h.lines, h.text).toBe(1); expect(h.clipped, h.text).toBe(false); }
    });

    test('U-05／#8：清單列的變化理由可以換行、不截斷', async ({ page }) => {
      await page.goto('#/mine');
      await page.getByRole('button', { name: '加入範例自選' }).click();
      const sub = page.locator('.srow .sub').first();
      await expect(sub).toBeVisible();
      expect(await sub.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe('none');
      expect(await sub.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('normal');
    });

    test('U-06（M4）：探索頁不捲動就看得到全部 9 個功能格與 3 個指數格；每格的即時數值一行', async ({ page }) => {
      await page.goto('#/explore');
      const tiles = page.locator('.ex-tile');
      await expect(tiles).toHaveCount(9);
      await expect(page.locator('.ex-index')).toHaveCount(3);
      await page.waitForTimeout(600);
      const info = await tiles.evaluateAll((els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const v = el.querySelector('.ex-tile-v') as HTMLElement;
        const lh = parseFloat(getComputedStyle(v).lineHeight);
        return { bottom: r.bottom, lines: Math.round(v.getBoundingClientRect().height / lh), text: v.textContent };
      }));
      const dockTop = await page.locator('.dock').evaluate((el) => el.getBoundingClientRect().top);
      for (const t of info) {
        expect(t.bottom, t.text ?? '').toBeLessThanOrEqual(dockTop);
        expect(t.lines, t.text ?? '').toBe(1);
      }
    });
  });
}
