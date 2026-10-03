import { expect, test, type Page } from '@playwright/test';

// 冒煙測試：逐一載入每個頁面（新資訊架構），確認沒有 JS 錯誤、有頁面標題、頁尾免責聲明與 4 個圖示 Tab。
const PAGES: { hash: string; title?: RegExp }[] = [
  { hash: '#/', title: /今晚|資金/ }, // 資料載入前是「今晚的盤後簡報」，載入後是結論句（後半句一定是資金環境）
  { hash: '#/mine' },
  { hash: '#/mine?seg=watch' },
  { hash: '#/stock/2330', title: /台積電/ },
  { hash: '#/explore' },
  { hash: '#/explore/screener' },
  { hash: '#/explore/backtest', title: /回測/ },
  { hash: '#/explore/sectors' },
  { hash: '#/explore/etf', title: /主動式 ETF/ },
  { hash: '#/explore/market', title: /資金環境/ },
  { hash: '#/explore/calendar' },
  { hash: '#/explore/disposition', title: /處置/ },
  { hash: '#/discipline' },
  { hash: '#/discipline/journal' },
  { hash: '#/discipline/stats' },
  { hash: '#/discipline/badges' },
  { hash: '#/discipline/weekly' },
  { hash: '#/me', title: /設定與資料/ },
  { hash: '#/me/settings', title: /設定/ },
  { hash: '#/me/backup' },
  { hash: '#/me/health' },
  { hash: '#/me/methodology', title: /方法說明/ },
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

async function addWatch(page: Page, code: string) {
  await page.goto('#/mine?seg=watch');
  await page.getByRole('button', { name: '加入自選股' }).first().click();
  await page.getByRole('searchbox', { name: '搜尋股票' }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
  await page.getByRole('button', { name: '關閉' }).click();
}

for (const p of PAGES) {
  test(`載入 ${p.hash}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(p.hash);
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10_000 });
    if (p.title) await expect(h1).toHaveText(p.title, { timeout: 10_000 });
    await expect(page.getByText('僅供研究參考，非投資建議')).toBeVisible();
    const nav = page.getByRole('navigation', { name: '主要分頁' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(5); // 今晚、我的股票、探索、搜尋、紀律
    expect(errors).toEqual([]);
  });
}

test('Tab 只有圖示、以 aria-label 提供名稱', async ({ page }) => {
  await page.goto('#/');
  const nav = page.getByRole('navigation', { name: '主要分頁' });
  for (const name of ['今晚', '我的股票', '探索', '搜尋代號或名稱', '紀律']) await expect(nav.getByRole('link', { name })).toBeVisible();
  await expect(nav).toHaveText('');
});

test('舊網址轉址到新位置', async ({ page }) => {
  await page.goto('#/watchlist');
  await expect(page).toHaveURL(/#\/mine\?seg=watch$/);
  await page.goto('#/more/settings');
  await expect(page).toHaveURL(/#\/me\/settings$/);
  await page.goto(`#/market/${encodeURIComponent('半導體業')}`);
  await expect(page).toHaveURL(/#\/explore\/sectors\//);
  await page.goto('#/journal');
  await expect(page).toHaveURL(/#\/discipline\/journal$/);
});

test('我的股票：加入自選後出現清單列，點擊進入個股頁', async ({ page }) => {
  await addWatch(page, '2330');
  const row = page.getByRole('button', { name: /台積電 2330/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('h1')).toHaveText(/台積電/);
  await expect(page.getByRole('img', { name: /走勢/ })).toBeVisible();
  await page.getByRole('button', { name: '進階' }).click();
  await expect(page.getByRole('img', { name: /K 線圖/ })).toBeVisible({ timeout: 15_000 });
});

test('選股：切換預設組合、新增條件、一鍵回測連結', async ({ page }) => {
  await page.goto('#/explore/screener');
  await page.getByRole('button', { name: '近高點放量' }).click();
  await expect(page.getByRole('heading', { name: /結果/ })).toBeVisible();
  await page.getByRole('button', { name: '新增條件' }).click();
  await expect(page.getByLabel('欄位').last()).toHaveValue('composite');
  await expect(page.getByRole('link', { name: '一鍵回測' })).toHaveAttribute('href', /#\/explore\/backtest\?c=/);
});

test('方法說明由設定產生（含介面呈現規則）', async ({ page }) => {
  await page.goto('#/me/methodology');
  await expect(page.getByText('外資連買天數')).toBeVisible();
  await expect(page.getByText(/線性：-5 → 0 分/).first()).toBeVisible();
  await expect(page.getByText(/遊戲化只獎勵紀律行為/)).toBeVisible();
});

test('設定：外觀、環境光與遊戲化開關', async ({ page }) => {
  await page.goto('#/me/settings');
  await expect(page.getByLabel('籌碼分權重')).toBeVisible();
  await page.getByRole('button', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-ambient', 'on');
  await page.getByRole('switch', { name: '環境光' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ambient', 'off');
  await page.getByRole('switch', { name: '遊戲化' }).click();
  await page.goto('#/discipline/badges');
  await expect(page.getByRole('heading', { name: '遊戲化已關閉' })).toBeVisible();
});

test('回測：預設組合顯示統計與可信度；自訂條件在 Web Worker 計算', async ({ page }) => {
  await page.goto('#/explore/backtest');
  await expect(page.getByRole('rowheader', { name: '勝率' })).toBeVisible(); // M3：指標為列、持有天數為欄（不左右滑動）
  await expect(page.getByText(/可信度(低|中|高)/).first()).toBeVisible();
  await expect(page.getByText('訊號衰減曲線')).toBeVisible();
  const c = encodeURIComponent(JSON.stringify([{ field: 'composite', op: '>=', value: 50 }]));
  await page.goto(`#/explore/backtest?c=${c}&name=test`);
  await expect(page.getByRole('rowheader', { name: '勝率' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/訊號 \d+ 筆 · 範圍：成交值前/)).toBeVisible();
});

test('日誌：冷靜卡 → 新增持倉前檢查表 → 新增持倉 → 平倉 → 統計出現錯誤標籤', async ({ page }) => {
  await page.goto('#/discipline/journal');
  await page.getByRole('button', { name: '新增持倉' }).click();
  await page.getByRole('searchbox', { name: '搜尋股票' }).fill('2330');
  await page.getByRole('option', { name: /2330/ }).click();
  // 示範資料的資金環境為「保守」→ 先出現冷靜卡，需勾選確認才能繼續
  const cont = page.getByRole('button', { name: '繼續填寫檢查表' });
  await expect(cont).toBeDisabled();
  await page.getByText('我已看過以上事實').click();
  await cont.click();
  const save = page.getByTestId('checklist-submit');
  await expect(save).toBeDisabled();
  await page.getByLabel('1. 市場燈號（見今晚頁）').selectOption('中性');
  for (const [label, idx] of [['2. 趨勢', 1], ['3. 營收', 1], ['4. 估值', 1]] as const) {
    const sel = page.getByLabel(label);
    if (!(await sel.inputValue())) await sel.selectOption({ index: idx });
  }
  await page.getByLabel('理由（必填）').fill('投信連買、營收創新高');
  const entry = Number(await page.getByLabel('進場價').inputValue());
  await page.getByLabel('6. 停損價').fill(String(Math.round(entry * 0.95)));
  await page.getByLabel('7. 目標價').fill(String(Math.round(entry * 1.2)));
  await expect(page.getByText(/風險報酬比：/)).toBeVisible();
  await page.getByLabel('實際股數（預設為建議部位）').fill('1000');
  await page.getByRole('button', { name: '加入持倉' }).click();
  await expect(page.getByRole('button', { name: /持倉\s*1/ })).toBeVisible();
  await page.getByRole('button', { name: '平倉', exact: true }).click();
  await page.getByRole('button', { name: '追高' }).click();
  await page.getByRole('button', { name: '確認平倉' }).click();
  await page.goto('#/discipline/stats');
  await expect(page.getByText('追高').first()).toBeVisible();
});

test('備份：匯出按鈕存在並說明包含紀律紀錄', async ({ page }) => {
  await page.goto('#/me/backup');
  await expect(page.getByRole('button', { name: '匯出全部資料（JSON）' })).toBeVisible();
  await expect(page.getByText(/紀律紀錄 \d+ 筆（含遊戲化資料）/)).toBeVisible();
});

test('產業資金輪動：熱力圖可點進產業個股清單', async ({ page }) => {
  await page.goto('#/explore/sectors');
  const tile = page.getByRole('button', { name: /半導體業：法人淨買超/ });
  await expect(tile).toBeVisible();
  await page.getByRole('button', { name: '20 日' }).click();
  await tile.click();
  await expect(page.locator('h1')).toHaveText('半導體業');
  await expect(page.getByRole('button', { name: /台積電/ })).toBeVisible();
});

test('今晚：加入自選後出現在「自選股的新變化」區塊', async ({ page }) => {
  await addWatch(page, '1101');
  await page.goto('#/');
  const section = page.getByRole('region', { name: '自選股出現了什麼新變化？' });
  await expect(section).toBeVisible();
  // 等區塊內容畫好：台泥這一列直接出現，或收在「低於門檻」底下（切換分頁不再等整頁轉場，內容可能晚一點才到）
  const row = section.getByRole('button', { name: /台泥 1101/ });
  const expand = section.getByRole('button', { name: /低於門檻/ });
  await expect(row.or(expand).first()).toBeVisible();
  if (await expand.isVisible() && (await expand.getAttribute('aria-expanded')) !== 'true') await expand.click();
  await expect(row).toBeVisible();
});

test('處置預警、行事曆、週報顯示資料', async ({ page }) => {
  await page.goto('#/explore/disposition');
  await expect(page.getByText('可能進入處置').first()).toBeVisible();
  await expect(page.getByText(/分盤撮合約每 5 分鐘/)).toBeVisible();
  await page.goto('#/explore/calendar');
  await page.getByRole('button', { name: '全部' }).click();
  await expect(page.getByText(/融券最後回補日/)).toBeVisible();
  await page.goto('#/discipline/weekly');
  await expect(page.getByRole('heading', { name: '下週事件' })).toBeVisible();
});

test('市場溫度：資金環境燈號與市場溫度', async ({ page }) => {
  await page.goto('#/explore/market');
  // M2（2026-10-03）：市場溫度頁另有同名的走勢列與鍵值列，這裡只確認燈號列存在
  await expect(page.getByText('外資台指期淨未平倉', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('散戶多空比（小台）').first()).toBeVisible();
});

test('主動式 ETF：持股標示部分涵蓋與來源投信', async ({ page }) => {
  await page.goto('#/explore/etf');
  await expect(page.getByText(/部分涵蓋：\d+／\d+ 檔主動式 ETF 有持股資料/)).toBeVisible();
  // 投信清單與家數來自 config/sources.yml（issuers status=verified），不寫死名單
  await expect(page.getByText(/目前涵蓋.+\d+ 家投信/)).toBeVisible();
});

test('資料健康：列出還原價推估事件並標示「推估」', async ({ page }) => {
  await page.goto('#/more/health');
  await expect(page.getByRole('region', { name: '還原價推估事件' })).toBeVisible();
  await expect(page.getByText(/只有在「前一個交易日之後到跳空當天」沒有任何官方/)).toBeVisible();
});
