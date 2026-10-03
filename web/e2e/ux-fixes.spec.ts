import { expect, test, type Page } from '@playwright/test';

// 行動體驗修正（docs/design/UX_FIXES.md）：
// 1 底部導覽一列化與 safe-area、2 底部搜尋、3 我的股票自選優先與新用戶、4 資料源異常呈現、5 今晚主角數字、6 中文排版。
// iPhone 393×852；standalone 以 <html class="standalone"> 模擬，safe-area 以 CSS 變數設為 iPhone 實際值。

test.use({ viewport: { width: 393, height: 852 } });

const H = 852;
const SAFE_BOTTOM = 34;

async function simulateStandalone(page: Page) {
  await page.addInitScript((safe) => {
    const apply = () => {
      document.documentElement.classList.add('standalone');
      const st = document.createElement('style');
      st.textContent = `:root{--safe-top:47px!important;--safe-bottom:${safe}px!important}`;
      document.head.appendChild(st);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }, SAFE_BOTTOM);
}

const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

// ---------------------------------------------------------------- 1. 底部導覽
test.describe('1. 底部導覽列', () => {
  test('瀏覽器模式：5 個分頁在同一條浮動膠囊內、搜尋在第 4 格，離視窗底緣 8px（safe-area 為 0 時的下限）', async ({ page }) => {
    await page.goto('#/');
    const tab = await box(page, '.tabbar');
    const links = page.locator('.tabbar a');
    await expect(links).toHaveCount(5);
    await expect(links.nth(3)).toHaveAttribute('aria-label', '搜尋代號或名稱'); // 第 4 格：右手拇指最順手
    expect(Math.round(tab.y + tab.height)).toBe(H - 8);
    await expect(page.locator('.search-btn, .search-float')).toHaveCount(0); // 舊的圓形按鈕與漂浮膠囊已移除
  });

  test('加入主畫面（standalone）：導覽列與畫面底部的距離只有 safe-area', async ({ page }) => {
    await simulateStandalone(page);
    await page.goto('#/mine');
    const tab = await box(page, '.tabbar');
    expect(Math.round(H - (tab.y + tab.height))).toBe(SAFE_BOTTOM);
    const dock = await box(page, '.dock');
    expect(Math.round(dock.y + dock.height)).toBe(H); // 固定元素本身 bottom: 0
  });

  test('內容底部留白＝分頁列高＋safe-area＋16，頁尾免責聲明不被遮住（兩種模式）', async ({ page }) => {
    for (const standalone of [false, true]) {
      if (standalone) await simulateStandalone(page);
      await page.goto('#/me/methodology');
      await expect(page.locator('h1.ui-large')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('.dock')).not.toHaveClass(/compact/, { timeout: 2000 }); // 停止捲動後導覽列恢復
      await page.waitForTimeout(450); // 高度轉場結束
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.app')!).paddingBottom));
      const dock = await box(page, '.dock');
      // 2026-10 改版：底部 padding＝分頁列高＋env(safe-area-inset-bottom)＋16（dock 高度＝分頁列＋safe-area）
      expect(Math.round(pad)).toBe(Math.round(dock.height) + 16);
      const footer = await box(page, '.footer');
      const tab = await box(page, '.tabbar');
      expect(footer.y + footer.height).toBeLessThanOrEqual(tab.y + 0.5);
      await expect(page.getByText('僅供研究參考，非投資建議')).toBeInViewport();
    }
  });

  test('往下捲動時縮小成精簡型態，往上捲或停止時恢復', async ({ page }) => {
    await page.goto('#/');
    await page.waitForTimeout(800);
    const full = (await box(page, '.tabbar')).height;
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy(0, 120)); await page.waitForTimeout(40); }
    await expect(page.locator('.dock')).toHaveClass(/compact/);
    await page.waitForTimeout(400); // 高度轉場
    expect((await box(page, '.tabbar')).height).toBeLessThan(full);
    await page.evaluate(() => window.scrollBy(0, -120));
    await expect(page.locator('.dock')).not.toHaveClass(/compact/);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 120)); await page.waitForTimeout(40); }
    await expect(page.locator('.dock')).toHaveClass(/compact/);
    await expect(page.locator('.dock')).not.toHaveClass(/compact/, { timeout: 2000 }); // 停止捲動後恢復
  });
});

// ---------------------------------------------------------------- 2. 搜尋
test.describe('2. 搜尋頁', () => {
  test('搜尋按鈕 → 輸入框固定在底部且已聚焦；焦點框畫在內側不被裁切', async ({ page }) => {
    await page.goto('#/mine');
    await page.getByRole('link', { name: '搜尋代號或名稱' }).click();
    await expect(page).toHaveURL(/#\/search$/);
    const input = page.getByRole('searchbox', { name: '搜尋代號或名稱' });
    await expect(input).toBeFocused();
    const field = await box(page, '.search-field');
    expect(field.y + field.height).toBeGreaterThan(H - 96);
    const shadow = await page.locator('.search-field').evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain('inset');
    // 搜尋是底部導覽的第 4 格：鍵盤收起時導覽列顯示在搜尋框下方、搜尋分頁為目前分頁
    await expect(page.locator('.tabbar a[aria-current="page"]')).toHaveAttribute('aria-label', '搜尋代號或名稱');
    const tab = await box(page, '.tabbar');
    expect(field.y + field.height).toBeLessThanOrEqual(tab.y);
  });

  test('代號、中文名稱、部分比對；最相關的結果最靠近輸入框（由下往上）', async ({ page }) => {
    await page.goto('#/search');
    const input = page.getByRole('searchbox', { name: '搜尋代號或名稱' });
    for (const [q, name] of [['2330', '台積電'], ['台積', '台積電'], ['鴻', '鴻海']]) {
      await input.fill(q);
      const rows = page.locator('.sresult-main');
      await expect(rows.first()).toContainText(name); // DOM 第一個＝最相關
      const ys = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      expect(Math.max(...ys)).toBe(ys[0]); // 視覺上最下面（最靠近拇指）
    }
    await input.fill('不存在的股票');
    await expect(page.getByText(/找不到「不存在的股票」/)).toBeVisible();
  });

  test('點選結果進入個股頁，並出現在「最近搜尋」', async ({ page }) => {
    await page.goto('#/search');
    await page.getByRole('searchbox', { name: '搜尋代號或名稱' }).fill('台積');
    await page.getByRole('button', { name: /^台積電/ }).first().click();
    await expect(page).toHaveURL(/#\/stock\/2330$/);
    await page.goto('#/search');
    const recent = page.getByRole('list', { name: '最近搜尋' });
    await expect(recent.getByRole('button', { name: /^台積電/ })).toBeVisible();
  });

  test('結果列按＋或左滑都能直接加入自選', async ({ page }) => {
    await page.goto('#/search');
    const input = page.getByRole('searchbox', { name: '搜尋代號或名稱' });
    await input.fill('鴻海');
    await page.getByRole('button', { name: '把 鴻海 加入自選' }).click();
    await expect(page.getByRole('button', { name: '鴻海 已在自選' })).toBeVisible();

    await input.fill('聯發科');
    const row = await box(page, '.sresult');
    const x0 = row.x + row.width * 0.6; // 從列中間開始（列尾的＋按鈕不觸發手勢）
    await page.mouse.move(x0, row.y + row.height / 2);
    await page.mouse.down();
    for (let dx = 10; dx <= 160; dx += 15) await page.mouse.move(x0 - dx, row.y + row.height / 2);
    await expect(page.locator('.sresult-action.armed')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('button', { name: '聯發科 已在自選' })).toBeVisible();

    await page.goto('#/mine');
    await expect(page.locator('.srow', { hasText: '鴻海' })).toBeVisible();
    await expect(page.locator('.srow', { hasText: '聯發科' })).toBeVisible();
  });

  test('鍵盤：↑ 移到最相關的結果、Esc 取消返回', async ({ page }) => {
    await page.goto('#/');
    await page.goto('#/search');
    const input = page.getByRole('searchbox', { name: '搜尋代號或名稱' });
    await input.fill('2330');
    await input.press('ArrowUp');
    await expect(page.getByRole('button', { name: /^台積電/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(page).toHaveURL(/#\/$/);
  });
});

// ---------------------------------------------------------------- 3. 我的股票
test.describe('3. 我的股票：自選優先與新用戶', () => {
  test('分段控制為「自選｜持股」，自選在左且預設；舊網址仍有效', async ({ page }) => {
    await page.goto('#/mine');
    const seg = page.getByRole('group', { name: '清單' }).getByRole('button');
    await expect(seg.nth(0)).toContainText('自選');
    await expect(seg.nth(1)).toContainText('持股');
    await expect(seg.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await page.goto('#/mine?seg=hold');
    await expect(seg.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.goto('#/watchlist');
    await expect(page).toHaveURL(/#\/mine\?seg=watch$/);
    await expect(seg.nth(0)).toHaveAttribute('aria-pressed', 'true');
  });

  test('新用戶：歡迎卡 → 加入範例自選（標示範例）→ 一鍵清除', async ({ page }) => {
    await page.goto('#/mine');
    const welcome = page.getByRole('region', { name: '無自選股' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: '加入範例自選' }).click();
    await page.getByRole('combobox', { name: '排序' }).selectOption('pct'); // 列出全部（不收合低於門檻的）
    await expect(page.locator('.srow', { hasText: '台積電' })).toBeVisible();
    await expect(page.locator('.srow', { hasText: '鴻海' })).toBeVisible();
    await expect(page.getByRole('button', { name: '範例', exact: true })).toBeVisible(); // 範例群組
    await expect(page.getByText(/範例自選/)).toBeVisible();
    await expect(page.locator('.ui-head')).toContainText('自選');
    await page.getByRole('button', { name: '清除範例' }).click();
    await expect(welcome).toBeVisible();
    await expect(page.locator('.srow')).toHaveCount(0);
  });

  test('新用戶：從熱門動能挑選幾檔加入', async ({ page }) => {
    await page.goto('#/mine');
    await page.getByRole('button', { name: '從熱門動能挑選' }).click();
    const sheet = page.getByRole('dialog', { name: '從熱門動能挑選' });
    await expect(sheet.getByText('依規則產生，非推薦', { exact: false }).first()).toBeVisible();
    await sheet.getByRole('checkbox').first().check();
    await sheet.getByRole('button', { name: '加入 1 檔到自選' }).click();
    await expect(sheet.getByRole('status')).toHaveText('已加入 1 檔');
    await sheet.getByRole('button', { name: '關閉' }).click();
    await expect(page.locator('.srow')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '熱門動能', exact: true })).toBeVisible(); // 使用者群組
  });

  test('熱門動能是唯讀的系統群組，可一鍵複製成自己的群組', async ({ page }) => {
    await page.goto('#/mine');
    await page.getByRole('button', { name: '加入範例自選' }).click();
    await page.getByRole('button', { name: /熱門動能\s*系統/ }).click();
    await expect(page.getByText('依規則產生，非推薦', { exact: true })).toBeVisible();
    // 2026-10-03：完整規則在 ⓘ；卡片上一行摘要
    await expect(page.getByText(/成交值前 \d+ 名・RS 百分位 ≥ \d+/)).toBeVisible();
    await page.getByRole('button', { name: '熱門動能的規則的說明' }).click();
    await expect(page.getByText(/成交值排名前 \d+ 名、RS 百分位 ≥ \d+/)).toBeVisible();
    await page.keyboard.press('Escape');
    const hotRows = await page.locator('.srow').count();
    expect(hotRows).toBeGreaterThan(0);
    await page.getByRole('button', { name: '複製成我的群組' }).click();
    await expect(page.getByRole('status').filter({ hasText: '已建立群組' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^熱門動能 \d+\/\d+$/ })).toBeVisible();
  });

  test('既有使用者（v2 資料庫）升級後自選與設定都保留', async ({ page }) => {
    await page.goto('manifest.webmanifest'); // 同源、但不載入 App，先建立舊版資料庫
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('twse-money-flow', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const w = db.createObjectStore('watchlist', { keyPath: 'code' });
        w.createIndex('group', 'group');
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('screens', { keyPath: 'id' });
        const t = db.createObjectStore('trades', { keyPath: 'id' });
        t.createIndex('status', 'status');
        t.createIndex('code', 'code');
        const a = db.createObjectStore('activity', { keyPath: 'id' });
        a.createIndex('type', 'type');
        a.createIndex('day', 'day');
        w.put({ code: '2454', group: '半導體', addedAt: '2026-01-01', order: 0 });
        req.transaction!.objectStore('settings').put({ key: 'lastBackupAt', value: new Date().toISOString() });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    }));
    await page.goto('#/mine');
    await expect(page.locator('.srow', { hasText: '聯發科' })).toBeVisible();
    await expect(page.getByRole('button', { name: '半導體', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '無自選股' })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- 4. 資料源異常
test.describe('4. 資料源異常的呈現', () => {
  test('頁首異常提示只在該頁用到的資料受影響時顯示，且為琥珀色小字', async ({ page }) => {
    await page.route('**/data/meta.json', async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      await route.fulfill({ json: { ...json, sources_failed: ['tdcc_holders', 'tpex_valuation'], sources_affected: ['tdcc_holders'] } });
    });
    await page.goto('#/');
    await expect(page.locator('.meta-line').first()).toBeVisible();
    await expect(page.locator('a.meta-alert')).toHaveCount(0); // 今晚頁沒用到集保
    await page.goto('#/stock/2330');
    // 2026-10 改版：個股頁只在異常時顯示一行橘色警示（.ui-warn）
    const alert = page.getByText(/1 個資料源異常/);
    await expect(alert).toBeVisible();
    const [color, risk, brand] = await alert.evaluate((el) => {
      const probe = (v: string) => { const d = document.createElement('span'); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      return [getComputedStyle(el).color, probe('--risk'), probe('--brand')];
    });
    expect(color).toBe(risk);
    expect(color).not.toBe(brand);
  });

  test('資料健康頁：白話說明在前，技術細節收在「詳細資訊」', async ({ page }) => {
    await page.route('**/data/health.json', async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.sources = json.sources.map((s: Record<string, unknown>) => s.id === 'tpex_valuation'
        ? { ...s, last_status: 'ok', format_warnings: ['上櫃本益比：缺少欄位「財報年/季」，已略過（以空值處理）'], format_warning_date: '2024-01-02' }
        : s);
      await route.fulfill({ json });
    });
    await page.goto('#/me/health');
    await expect(page.getByText('櫃買中心調整了資料格式，已改用相容模式')).toBeVisible();
    const tech = page.getByText(/缺少欄位「財報年\/季」/);
    await expect(tech).toBeHidden();
    await page.locator('.list-item', { hasText: '上櫃本益比' }).getByText('詳細資訊').click();
    await expect(tech).toBeVisible();
    await expect(page.locator('.ui-head')).toContainText(/相容模式 \d+/); // 2026-10-03：頁首副資訊為「n／N 正常・相容模式 n・需要注意 n」
  });
});

// ---------------------------------------------------------------- 5. 今晚主角數字、6. 中文排版
test('5. 今晚：主角數字下方固定是資料日（M/D）的漲跌；走勢圖預設 3M、期間從 1D（盤後盤中走勢）開始，只改變走勢圖', async ({ page }) => {
  await page.goto('#/');
  const periods = page.getByRole('group', { name: '加權指數走勢期間' }).getByRole('button');
  // M2（2026-10-03）：1D 用盤後取得的每 5 秒指數統計；示範資料沒有盤中檔時仍可選，圖表寫原因
  await expect(periods.first()).toHaveText(/^1D/);
  await expect(page.getByRole('group', { name: '加權指數走勢期間' }).getByRole('button', { name: /^1D/ })).toHaveCount(1);
  await expect(page.getByRole('group', { name: '加權指數走勢期間' }).getByRole('button', { name: /^3M/ })).toHaveAttribute('aria-pressed', 'true');
  const change = page.locator('.hero-change').first();
  // 2026-10-02 健檢：標籤從「今日」改為資料日（M/D），休市日也不會寫成「今日」
  await expect(page.getByTestId('hero-change-date').first()).toHaveText(/^\d{1,2}\/\d{1,2}$/);
  const today = await change.textContent();
  await expect(page.locator('.chart-range').first()).toContainText('近 3 個月');
  await page.getByRole('group', { name: '加權指數走勢期間' }).getByRole('button', { name: /^1Y/ }).click();
  await expect(page.locator('.chart-range').first()).toContainText('近 1 年');
  await expect(change).toHaveText(today!);
});

test('6. 頁首副資訊在手機寬度最多兩行，只在標點處換行', async ({ page }) => {
  await page.goto('#/mine');
  await page.getByRole('button', { name: '加入範例自選' }).click();
  for (const hash of ['#/mine', '#/']) {
    await page.goto(hash);
    // 2026-10-03：頁首＝名詞標題＋一行副資訊（數字）；斷行規則看副資訊
    const title = page.locator('.ui-head-sub').first();
    await expect(title).toBeVisible();
    const lines = await title.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [...range.getClientRects()].map((r) => Math.round(r.top));
      return [...new Set(tops)].length;
    });
    expect(lines).toBeLessThanOrEqual(2);
    const style = await title.evaluate((el) => getComputedStyle(el).wordBreak);
    expect(style).toBe('keep-all');
  }
});
