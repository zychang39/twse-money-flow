/**
 * M7 流程走查：簡報 → 我的股票 → 個股分段 → 族群頁 → 選股 → 策略分段 → 流程 → 設定；每一步返回都回到原本的分段與捲動位置。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seed } from './helpers';

test.use({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
const FIX = new URL('./fixtures/', import.meta.url);
const fx = (n: string) => readFileSync(new URL(n, FIX), 'utf8');

async function fixtures(page: Page) {
  const map: Record<string, string> = { 'strategies.json': 'strategies-m5.json', 'screen.json': 'screen.json', 'strategy/rev_confirm.json': 'strategy/rev_confirm.json', 'strategy/rev_confirm-signals.json': 'strategy/rev_confirm-signals.json' };
  for (const [u, f] of Object.entries(map)) await page.route(`**/data/${u}`, (r) => r.fulfill({ contentType: 'application/json', body: fx(f) }));
}
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** 記錄接下來 11 秒每個畫格的捲動位置與可捲高度（只留有變化的畫格） */
const recordFrames = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __frames: unknown[] };
  w.__frames = [];
  const t0 = performance.now();
  let prev = '';
  const f = () => {
    const row = [Math.round(window.scrollY), document.documentElement.scrollHeight - window.innerHeight, location.hash.slice(0, 24)];
    const k = JSON.stringify(row);
    if (k !== prev) w.__frames.push([Math.round(performance.now() - t0), ...row]);
    prev = k;
    if (performance.now() - t0 < 11000) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: unknown[] }).__frames);
/**
 * 等進場動畫與捲動觸發的轉場（有限長度的動畫）結束再量捲動位置、再點擊。
 * 動畫還在跑時 Playwright 判定元素「不穩定」，重試點擊前會換一種對齊方式重新捲動，實際離開的位置就不是測試量到的 y
 * （CI 機器較忙時偶發；2026-10-06 main CI 106：族群列在 358 被捲回 0、策略頁 1157 被捲到 727）。
 */
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
  .map((a) => a.finished.catch(() => undefined))));
async function scrollTo(page: Page, y: number) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(300);
  await settle(page);
  return scrollY(page);
}

test('個股籌碼分段 → 外資持股詳情 → 返回：仍在籌碼分段、捲動位置還原', async ({ page }) => {
  await page.goto('#/stock/2330?seg=c');
  await expect(page.getByTestId('stock-seg').getByRole('button', { name: '籌碼' })).toHaveAttribute('aria-pressed', 'true');
  const y = await scrollTo(page, 900);
  const link = page.locator('a[href*="/c/qfii"]').first();
  await link.click();
  await expect(page).toHaveURL(/\/c\/qfii/);
  await page.goBack();
  await expect(page).toHaveURL(/seg=c/);
  await expect.poll(() => scrollY(page), { timeout: 10000 }).toBeGreaterThan(y - 60);
});

test('族群輪動 → 族群頁 → 返回：層級、排序與捲動位置還原', async ({ page }) => {
  await page.goto('#/explore/sectors?layer=official&sort=r1m');
  await expect(page.getByTestId('group-list').locator('.grp-row').first()).toBeVisible();
  const y = await scrollTo(page, 700);
  await page.getByTestId('group-list').locator('.grp-row:visible').nth(3).click();
  await expect(page).toHaveURL(/#\/explore\/sectors\/o-/);
  await page.goBack();
  await expect(page).toHaveURL(/layer=official/);
  await expect(page).toHaveURL(/sort=r1m/);
  await expect.poll(() => scrollY(page), { timeout: 10000 }).toBeGreaterThan(y - 60);
});

test('選股篩出 → 個股 → 返回：仍是篩出；策略績效（2024 年、等權）→ 當週持股的個股 → 返回：期間與基準不變', async ({ page }) => {
  await fixtures(page);
  await page.goto('#/explore/screener?view=all');
  await page.locator('.scr-row').nth(2).click();
  await expect(page).toHaveURL(/#\/stock\//);
  await page.goBack();
  await expect(page.getByTestId('screen-view').getByRole('button', { name: /篩出/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('#/explore/strategies/rev_confirm?seg=p&p=year:2024&b=ew');
  const held = page.getByTestId('st-held').locator('a').first();
  await held.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await settle(page);
  const y = await scrollY(page);
  await held.click();
  await expect(page).toHaveURL(/#\/stock\//);
  await recordFrames(page);
  await page.goBack();
  await expect(page).toHaveURL(/seg=p/);
  await expect(page).toHaveURL(/p=year(%3A|:)2024/);
  await expect(page.getByTestId('bench-switch').getByRole('button', { name: '等權' })).toHaveAttribute('aria-pressed', 'true');
  try {
    await expect.poll(() => scrollY(page), { timeout: 10000 }).toBeGreaterThan(y - 120);
  } catch (e) {
    // 失敗時印出返回後每個畫格的捲動位置與可捲高度，方便判斷是被夾住還是被移動
    console.warn(`返回前 y=${y}；[ms, scrollY, maxScroll, hash]：`, JSON.stringify(await frames(page)));
    throw e;
  }
});

test('一天的流程：簡報市場 → 我的股票持股與異動 → 選股 → 流程頁顯示已完成的步驟；設定與備份可進出', async ({ page, request }) => {
  const { date } = await (await request.get('data/summary.json')).json() as { date: string };
  await page.clock.setFixedTime(new Date(`${date}T20:00:00+08:00`));
  await seed(page, { watchlist: [{ code: '2330', group: '預設', addedAt: '2026-01-01' }] });
  await page.goto('#/?seg=market');
  await expect(page.getByTestId('brief-seg').getByRole('button', { name: '市場' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(1200);
  await page.goto('#/mine?seg=watch');
  await expect(page.getByTestId('watch-basis')).toBeVisible();
  await page.goto('#/stock/2330');
  await expect(page.locator('h1')).toHaveText('台積電');
  await page.goto('#/explore/screener');
  await expect(page.getByTestId('strategy-chips')).toBeVisible();
  await page.goto('#/discipline');
  await expect(page.getByRole('heading', { level: 1, name: '今日流程' })).toBeVisible();
  await expect(page.getByTestId('step-market')).toContainText('已完成', { timeout: 10000 });
  await expect(page.getByTestId('step-screener')).toContainText('已完成', { timeout: 10000 });
  await expect(page.getByTestId('step-movers')).toContainText('已完成', { timeout: 10000 });
  await page.goto('#/me/settings');
  await expect(page.getByTestId('set-data')).toBeVisible();
  await page.getByTestId('set-data').getByRole('link', { name: /備份與還原/ }).click();
  await expect(page).toHaveURL(/#\/me\/backup/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/me\/settings/);
});

test('減少動態效果：版面高度不變（只關閉動畫）', async ({ browser }) => {
  const pages = ['#/', '#/stock/2330', '#/explore', '#/explore/sectors', '#/discipline', '#/me/settings'];
  const heights = async (reducedMotion: 'reduce' | 'no-preference') => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, reducedMotion, serviceWorkers: 'block', baseURL: 'http://localhost:4173/twse-money-flow/' });
    const page = await ctx.newPage();
    const out: number[] = [];
    for (const h of pages) {
      await page.goto(h);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1200);
      out.push(await page.evaluate(() => document.documentElement.scrollHeight));
    }
    await ctx.close();
    return out;
  };
  const a = await heights('no-preference');
  const b = await heights('reduce');
  a.forEach((h, i) => expect(Math.abs(h - b[i]), pages[i]).toBeLessThanOrEqual(2));
});
