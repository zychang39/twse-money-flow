import { expect, test, type Page } from '@playwright/test';

// 第四輪（docs/design/ROUND4.md）：底部導覽（搜尋在第 4 格、選取膠囊滑動、玻璃樣式）與個股頁左右換股（Apple 股市式）。
// 觸控拖曳用 Chrome DevTools Protocol 的 Input.dispatchTouchEvent（產生真正的 touch pointer 事件）。

test.use({ viewport: { width: 393, height: 852 } });

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { steps?: number; holdMs?: number; beforeEnd?: () => Promise<void> } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const steps = opts.steps ?? 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  if (opts.holdMs) await page.waitForTimeout(opts.holdMs);
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await page.waitForTimeout(16);
  }
  if (opts.beforeEnd) await opts.beforeEnd();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const center = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// ---------------------------------------------------------------- 1. 底部導覽
test.describe('1. 底部導覽', () => {
  test('5 個分頁的順序：簡報、我的股票、探索、搜尋（第 4 格）、流程；選取膠囊在目前分頁底下', async ({ page }) => {
    await page.goto('#/');
    const labels = await page.locator('.tabbar a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels).toEqual(['簡報', '我的股票', '探索', '搜尋代號或名稱', '流程']);
    for (const [i, hash] of [[2, '#/explore'], [4, '#/discipline'], [1, '#/mine'], [0, '#/']] as const) {
      await page.locator('.tabbar a').nth(i).click();
      await expect(page).toHaveURL(new RegExp(`${hash.replace('/', '\\/')}$`));
      await expect(page.locator('.tabbar a').nth(i)).toHaveAttribute('aria-current', 'page');
      await page.waitForTimeout(550); // 滑動動畫結束
      const ind = await center(page, '.tab-indicator');
      const cur = await center(page, `.tabbar a:nth-of-type(${i + 1})`);
      expect(Math.abs(ind.x - cur.x)).toBeLessThan(1.5);
    }
  });

  test('切換分頁時選取膠囊有滑動動畫（Web Animations），減少動態效果時不播放', async ({ page }) => {
    await page.goto('#/');
    await page.locator('.tabbar a').nth(2).click();
    const running = await page.locator('.tab-indicator').evaluate((el) => el.getAnimations().length);
    expect(running).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(600);
    await page.locator('.tabbar a').nth(4).click();
    expect(await page.locator('.tab-indicator').evaluate((el) => el.getAnimations().length)).toBe(0);
  });

  test('手指按住導覽列左右拖曳：放開時切換到手指下方的分頁', async ({ page }) => {
    await page.goto('#/');
    const a = await center(page, '.tabbar a:nth-of-type(1)');
    const c = await center(page, '.tabbar a:nth-of-type(3)');
    await touchDrag(page, a, c, {
      beforeEnd: async () => {
        await expect(page.locator('.tabbar')).toHaveClass(/lens/); // 拖曳中膠囊放大、跟著手指
      },
    });
    await expect(page).toHaveURL(/#\/explore$/);
    await expect(page.locator('.tabbar')).not.toHaveClass(/lens/);
  });

  test('搜尋頁：鍵盤開啟時導覽列淡出；已在搜尋頁再點搜尋分頁會回到搜尋框', async ({ page }) => {
    await page.goto('#/search');
    const input = page.getByRole('searchbox', { name: '搜尋代號或名稱' });
    await expect(input).toBeFocused();
    await expect(page.locator('.dock')).toHaveCSS('opacity', '1');
    await page.evaluate(() => { document.documentElement.dataset.kb = 'open'; });
    await expect(page.locator('.dock')).toHaveCSS('opacity', '0');
    await page.evaluate(() => { document.documentElement.dataset.kb = 'closed'; });
    await input.blur();
    await page.locator('.tabbar a').nth(3).click();
    await expect(page).toHaveURL(/#\/search$/);
    await expect(input).toBeFocused();
  });

  test('導覽列是玻璃膠囊：半透明底、背景模糊、細框與陰影；深淺色都有對應的樣式', async ({ page }) => {
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('#/');
      const st = await page.locator('.tabbar').evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, bf: c.backdropFilter || (c as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter, shadow: c.boxShadow };
      });
      expect(st.bg).toMatch(/rgba\(.+, 0\.7\d?\)/);
      expect(st.bf).toContain('blur');
      expect(st.shadow).toContain('inset');
    }
  });
});

// ---------------------------------------------------------------- 2. 個股頁左右換股
/** M5：換股手勢只從頁首區域（股票名稱）開始 → 拖曳的 y 取名稱列 */
const headY = async (page: Page) => {
  const b = (await page.locator('.pager-pane:not([inert]) .page-head').boundingBox())!;
  return b.y + b.height / 2;
};

async function openInList(page: Page, code: string, codes = ['2330', '2317', '2454']) {
  await page.goto('#/mine');
  await page.evaluate((c) => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: c })), codes);
  await page.goto(`#/stock/${code}`);
  await expect(page.locator('.pager-pane:not([inert]) .hero')).toBeVisible();
  await page.waitForTimeout(600);
}

test.describe('2. 個股頁左右換股', () => {
  test('前一檔／目前／後一檔都在軌道上；非目前的一檔不能被聚焦或讀出', async ({ page }) => {
    await openInList(page, '2317');
    const panes = page.locator('.pager-pane');
    await expect(panes).toHaveCount(3);
    expect(await panes.evaluateAll((els) => els.map((e) => [e.getAttribute('data-code'), e.hasAttribute('inert'), e.getAttribute('aria-hidden')]))).toEqual([
      ['2330', true, 'true'], ['2317', false, null], ['2454', true, 'true'],
    ]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('鴻海');
  });

  test('拖曳時後一檔一起被帶出，頂列與下方內容不動；放開後換股，過程中沒有載入畫面', async ({ page }) => {
    await openInList(page, '2317');
    const top0 = (await page.locator('.topbar').boundingBox())!;
    const low0 = (await page.locator('.stock-lower').boundingBox())!;
    let busy = false;
    const y = await headY(page);
    await touchDrag(page, { x: 320, y }, { x: 140, y: y + 2 }, {
      beforeEnd: async () => {
        const next = (await page.locator('.pager-pane[data-code="2454"]').boundingBox())!;
        expect(next.x).toBeLessThan(393); // 後一檔已經進入畫面
        expect(next.x).toBeGreaterThan(0);
        const top1 = (await page.locator('.topbar').boundingBox())!;
        const low1 = (await page.locator('.stock-lower').boundingBox())!;
        expect(top1.x).toBe(top0.x);
        expect(low1.x).toBe(low0.x); // 下方內容不動
        expect(low1.y).toBe(low0.y);
      },
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) {
      if (await page.locator('[aria-busy="true"]').count()) busy = true;
      await page.waitForTimeout(30);
    }
    expect(busy).toBe(false);
    await expect(page).toHaveURL(/#\/stock\/2454$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('聯發科');
    await expect(page.locator('.topbar')).toContainText('自選 3 / 3');
    await expect(page.locator('.pager-pane:not([inert])')).toHaveAttribute('data-code', '2454');
  });

  test('第一檔往右拖：橡皮筋回彈，不換股；拖曳距離不夠也彈回', async ({ page }) => {
    await openInList(page, '2330');
    const y = await headY(page);
    await touchDrag(page, { x: 100, y }, { x: 330, y });
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    await touchDrag(page, { x: 300, y }, { x: 260, y }, { steps: 20 });
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    const x = await page.locator('.pager-pane:not([inert])').evaluate((el) => el.getBoundingClientRect().x);
    expect(Math.abs(x)).toBeLessThan(1);
  });

  test('頂列的 ‹ › 走同一個滑動動畫', async ({ page }) => {
    await openInList(page, '2330');
    await page.getByRole('button', { name: '下一檔' }).click();
    await expect(page).toHaveURL(/#\/stock\/2317$/);
    await page.getByRole('button', { name: '上一檔' }).click();
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('台積電');
  });

  test('走勢圖上左右拖曳是查價（M5：不必先按住），不會換股', async ({ page }) => {
    await openInList(page, '2317');
    const chart = (await page.locator('.pager-pane:not([inert]) .chart-wrap').boundingBox())!;
    const hero = page.locator('.pager-pane:not([inert]) .hero');
    const before = await hero.textContent();
    let during = before;
    await touchDrag(page, { x: chart.x + chart.width * 0.85, y: chart.y + 80 }, { x: chart.x + chart.width * 0.3, y: chart.y + 82 }, {
      beforeEnd: async () => { during = await hero.textContent(); },
    });
    expect(during).not.toBe(before);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/stock\/2317$/);
    await expect(hero).toHaveText(before!);
  });
});
