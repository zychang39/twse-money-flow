import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

// #1 新版上線後的更新流程（真實 service worker）：另開一個靜態伺服器服務 dist 的複本，
// 修改複本的 sw.js 模擬「部署新版」，不影響其他測試用的 preview 伺服器。
test.use({ viewport: { width: 390, height: 844 } });
test.describe.configure({ mode: 'serial' });

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
let dir = '';
let server: Server;
let base = '';

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tmf-sw-'));
  cpSync('dist', dir, { recursive: true });
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname).replace(/^\/twse-money-flow\//, '/');
    let file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}/twse-money-flow/`;
});
test.afterAll(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

/** 模擬部署新版：改 sw.js 的 VERSION（外殼快取名稱跟著改）。 */
function deploy(tag: string) {
  const f = join(dir, 'sw.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/const VERSION = "([^"]+)"/, `const VERSION = "$1${tag}"`));
}

async function install(page: Page) {
  await page.goto(base);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const shellCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('app-')));

test('自動更新：上次使用時已下載好新版（等待中），再次開啟 App 且尚未操作 → 自動接手並重新載入，不需要點擊', async ({ page }) => {
  await install(page);
  await page.getByRole('heading').first().click(); // 使用中：這一次只會提示
  deploy('b');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId('update-toast')).toBeVisible();
  let loads = 0;
  page.on('load', () => loads++);
  await page.reload(); // 再次開啟（仍由舊版 service worker 服務）
  await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2); // 開啟＋自動重新載入
  await expect.poll(async () => (await shellCaches(page)).some((k) => k.endsWith('b'))).toBe(true);
  await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
  await expect(page.getByTestId('update-toast')).toHaveCount(0);
});

test('更新提示：使用者正在操作時只顯示提示（不遮擋、不重新載入）；「稍後」可關閉，設定頁「立即更新」或點提示才更新', async ({ page }) => {
  await install(page);
  await page.goto(`${base}#/me/settings`);
  await page.waitForTimeout(3200);
  await page.getByRole('heading', { name: '設定' }).click(); // 已開始操作
  deploy('c');
  let loads = 0;
  page.on('load', () => loads++);
  await page.getByRole('button', { name: '檢查更新' }).click();
  const toast = page.getByTestId('update-toast');
  await expect(toast).toContainText('有新版本，點此更新');
  // 不遮擋：浮在底部導覽之上
  const t = (await toast.boundingBox())!;
  const dock = (await page.locator('.tabbar').boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(dock.y);
  await page.waitForTimeout(1000);
  expect(loads).toBe(0);
  await toast.getByRole('button', { name: '稍後' }).click();
  await expect(toast).toHaveCount(0);
  await page.getByRole('button', { name: '立即更新' }).click();
  await expect.poll(() => loads, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await shellCaches(page)).some((k) => k.endsWith('c'))).toBe(true);
  await expect(page.getByTestId('update-toast')).toHaveCount(0);
});

test('更新提示：點提示本身也會更新', async ({ page }) => {
  await install(page);
  await page.getByRole('heading').first().click();
  deploy('e');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  const toast = page.getByTestId('update-toast');
  await expect(toast).toBeVisible({ timeout: 10_000 });
  let loads = 0;
  page.on('load', () => loads++);
  await toast.getByRole('button', { name: '有新版本，點此更新' }).click();
  await expect.poll(() => loads, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await shellCaches(page)).some((k) => k.endsWith('e'))).toBe(true);
});

test('部署剛完成、CDN 仍回舊的 index.html：新版 service worker 安裝失敗（下次再試），不會把舊頁面存成新版', async ({ page }) => {
  await install(page);
  const before = await shellCaches(page);
  const f = join(dir, 'sw.js');
  // 新版 sw.js 預期的入口檔不在目前的 index.html 裡（等同 index.html 還是舊版）
  writeFileSync(f, readFileSync(f, 'utf8').replace(/const VERSION = "([^"]+)"/, 'const VERSION = "$1d"').replace(/const ENTRY = "([^"]+)"/, 'const ENTRY = "assets/index-NEW.js"'));
  const r = await page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!;
    await reg.update().catch(() => undefined);
    const w = reg.installing;
    if (w) await new Promise<void>((res) => { const done = () => { if (w.state !== 'installing') res(); }; w.addEventListener('statechange', done); done(); });
    return { waiting: !!reg.waiting, state: w?.state ?? null };
  });
  expect(r.waiting).toBe(false);
  expect(r.state).toBe('redundant');
  expect(await shellCaches(page)).toEqual(before); // 沒有留下半套的新版快取
});
