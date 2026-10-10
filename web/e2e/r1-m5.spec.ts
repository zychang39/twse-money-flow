import { expect, test, type Page } from '@playwright/test';

// 2026-10 改版：還原／原始在導覽列「⋯」；只在還原價與原始價不同時顯示「還原」字樣；長按＝十字線、兩指（桌機按住拖曳）＝區間報酬。
// 第 1 輪 M5（使用者回報）：1) 「還原／原始」切換要讓主角數字、走勢、期間與區間報酬一起切換並標示目前基準；
// 2) 走勢圖手勢與換股分開：圖表內查價／選區間不換股；換股只在頁首區域滑動、點 ‹ ›、或電腦版方向鍵（焦點不在圖表）。
// 攔截個股檔：service worker 接手後的請求不經過 page.route，所以停用
test.use({ serviceWorkers: 'block' });

async function openInList(page: Page, code: string, codes = ['2330', '2317', '2454']) {
  await page.goto('#/mine');
  await page.evaluate((c) => sessionStorage.setItem('twse:list-context', JSON.stringify({ name: '自選', codes: c })), codes);
  await page.goto(`#/stock/${code}`);
  await expect(page.locator('.pager-pane:not([inert]) [data-testid="stock-price"]')).toBeVisible();
  await page.waitForTimeout(1100); // 走勢描繪動畫
}

/** 把 2330 的前段改成「分割前」：原始價 ×4、還原因子 ×0.25（還原價不變） */
async function injectSplit(page: Page) {
  await page.route('**/data/stocks/2330.json', async (route) => {
    const res = await route.fetch();
    const h = await res.json();
    const k = h.d.length - 30;
    for (const key of ['o', 'h', 'l', 'c']) h[key] = h[key].map((v: number | null, i: number) => (v !== null && i < k ? v * 4 : v));
    h.af = h.af.map((v: number, i: number) => (i < k ? v * 0.25 : v));
    h.adj_events = [[h.d[k], 0.25, 'split']];
    await route.fulfill({ response: res, json: h });
  });
}

async function pickBasis(page: Page, name: '還原價' | '原始價') {
  await page.getByTestId('stock-more').click();
  await page.getByTestId('basis-seg').getByRole('button', { name }).click();
  await page.keyboard.press('Escape');
}

const pct = async (page: Page) => {
  const t = (await page.getByTestId('hero-period-change').textContent()) ?? '';
  // M3：「▼ 1,234 (61.20%) 近 1 年」（▲▼＋半形括號百分比）
  const m = t.match(/([▲▼])?\s*[\d,.]+\s*\(([\d.]+)%\)/);
  return { text: t, value: m ? Number(m[2]) : NaN, down: m?.[1] === '▼' };
};

test.describe('M5-1 還原／原始切換', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('切換到原始價：「還原」字樣消失，期間漲跌反映分割斷層；切回還原則恢復', async ({ page }) => {
    await injectSplit(page);
    await page.goto('#/stock/2330');
    await expect(page.getByTestId('basis-tag')).toHaveText('還原');
    const adj = await pct(page);
    await pickBasis(page, '原始價');
    await expect(page.getByTestId('basis-tag')).toHaveCount(0);
    await expect(page.getByTestId('data-time')).toContainText('原始價');
    const raw = await pct(page);
    // 分割 1 拆 4：原始價的期間漲跌至少 −60%，還原價沒有這個斷層
    expect(raw.down).toBe(true);
    expect(raw.value).toBeGreaterThan(60);
    expect(raw.text).not.toBe(adj.text);
    expect(adj.value).toBeLessThan(60);
    expect(await page.evaluate(() => localStorage.getItem('tmf-range-basis'))).toBe('raw');
    // 重新開啟仍記得原始價
    await page.reload();
    await expect(page.getByTestId('data-time')).toContainText('原始價');
    await pickBasis(page, '還原價');
    await expect(page.getByTestId('basis-tag')).toHaveText('還原');
    expect((await pct(page)).text).toBe(adj.text);
  });

  test('沒有還原事件的期間不顯示「還原」字樣', async ({ page }) => {
    await page.route('**/data/stocks/2330.json', async (route) => {
      const res = await route.fetch();
      const h = await res.json();
      h.af = h.af.map(() => 1);
      await route.fulfill({ response: res, json: h });
    });
    await page.goto('#/stock/2330');
    await expect(page.getByTestId('stock-price')).toBeVisible();
    await expect(page.getByTestId('basis-tag')).toHaveCount(0);
  });
});

test.describe('M5-2 手勢：電腦版', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('在圖表上按住拖曳會選出區間、不會換股', async ({ page }) => {
    await openInList(page, '2317');
    const b = (await page.locator('.pager-pane:not([inert]) .chart-wrap').boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, y, { steps: 10 });
    await expect(page.getByTestId('range-readout')).toBeVisible();
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/stock\/2317$/);
  });

  test('在頁首（股票名稱）拖曳、點 ‹ ›、方向鍵才換股；焦點在圖表時方向鍵是查價', async ({ page }) => {
    await openInList(page, '2317');
    const head = (await page.locator('.pager-pane:not([inert]) .ui-head').boundingBox())!;
    const y = head.y + head.height / 2;
    await page.mouse.move(head.x + head.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(head.x + head.width * 0.1, y, { steps: 12 });
    await page.mouse.up();
    await expect(page).toHaveURL(/#\/stock\/2454$/);
    await page.getByRole('button', { name: '上一檔' }).click();
    await expect(page).toHaveURL(/#\/stock\/2317$/);
    await page.locator('.pager-pane:not([inert]) .ui-head').click();
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('台積電');
    // 焦點在圖表：方向鍵移動查價點，不換股
    await page.locator('.pager-pane:not([inert]) .chart-wrap').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    await expect(page.locator('.pager-pane:not([inert]) [data-testid="hero-change"]').first()).toContainText(/\d{4}\/\d+\/\d+/);
  });
});

test.describe('M5-2 手勢：手機', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 0, beforeEnd?: () => Promise<void>) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    if (holdMs) await page.waitForTimeout(holdMs);
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }] });
      await page.waitForTimeout(16);
    }
    if (beforeEnd) await beforeEnd();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('單指快速滑過圖表不換股；長按再拖曳是十字線讀值；兩指是區間報酬；都不換股', async ({ page }) => {
    await openInList(page, '2317');
    const b = (await page.locator('.pager-pane:not([inert]) .chart-wrap').boundingBox())!;
    const y = b.y + b.height / 3;
    await touchDrag(page, { x: b.x + b.width * 0.9, y }, { x: b.x + b.width * 0.1, y });
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/stock\/2317$/);
    // M3：預設折線（HeroChart）長按再拖曳＝查價，主角數字下方換成該日日期（D4）
    let cross = '';
    await touchDrag(page, { x: b.x + b.width * 0.8, y }, { x: b.x + b.width * 0.3, y }, 600, async () => {
      cross = (await page.locator('.pager-pane:not([inert]) [data-testid="hero-change"]').first().textContent()) ?? '';
    });
    expect(cross).toMatch(/\d{4}\/\d+\/\d+/);
    // 兩指：區間報酬
    const cdp = await page.context().newCDPSession(page);
    const p1 = { x: b.x + b.width * 0.2, y }, p2 = { x: b.x + b.width * 0.7, y };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p1, id: 1 }, { ...p2, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p1, id: 1 }, { x: p2.x + 10, y, id: 2 }] });
    await expect(page.getByTestId('range-readout')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/stock\/2317$/);
  });

  test('在頂列「自選 2 / 3」那一列左右滑動會換股', async ({ page }) => {
    await openInList(page, '2317');
    const c = (await page.getByTestId('list-position').boundingBox())!;
    const y = c.y + c.height / 2;
    await touchDrag(page, { x: c.x + c.width, y }, { x: c.x - 60, y });
    await expect(page).toHaveURL(/#\/stock\/2454$/);
  });
});
