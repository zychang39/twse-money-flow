/**
 * 版面規範自動驗收（docs/UI_GUIDE.md §12）：402×874（iPhone 18 Pro）、375×667、440×956 三種 viewport，每個頁面檢查
 * 1. 沒有左右滑移（scrollWidth ≤ clientWidth；表格不在水平捲動容器裡）
 * 2. 所有可見文字 ≥ 11px 3. 表格數字 ≥ 13px 4. 數字欄靠右 5. 可點擊元素 ≥ 44 × 44px（計入 ::before 擴大；行內文字連結除外）
 * 指標效度表、策略庫、槓桿計算以真實資料的評估結果（e2e/fixtures，2026-09-24）取代示範資料（示範資料太短，全部樣本不足）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { revealAllSections } from './helpers';

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX), 'utf8');

async function useEvidenceFixtures(page: Page) {
  const files = ['evidence.json', 'strategies.json', 'evidence_today.json', ...readdirSync(new URL('evidence/', FIX)).map((f) => `evidence/${f}`)];
  for (const f of files) {
    await page.route(`**/data/${f}`, (route) => route.fulfill({ contentType: 'application/json', body: fixture(f) }));
  }
}

const VIEWPORTS = [
  { width: 402, height: 874 },
  { width: 375, height: 667 },
  { width: 440, height: 956 },
];

const PAGES: { name: string; hash: string; prepare?: (page: Page) => Promise<void> }[] = [
  { name: '今晚', hash: '#/' },
  { name: '我的股票', hash: '#/mine' },
  { name: '探索', hash: '#/explore' },
  { name: '選股', hash: '#/explore/screener' },
  { name: '產業', hash: '#/explore/sectors' },
  { name: '主動式 ETF', hash: '#/explore/etf' },
  { name: '市場溫度', hash: '#/explore/market' },
  { name: '行事曆', hash: '#/explore/calendar' },
  { name: '處置', hash: '#/explore/disposition' },
  { name: '指標效度表', hash: '#/explore/evidence', prepare: async (p) => { await p.getByRole('button', { name: /RS 百分位站上 90/ }).click(); await expect(p.getByRole('table', { name: '各持有天數' })).toBeVisible(); } },
  { name: '策略庫', hash: '#/explore/strategies', prepare: async (p) => { await expect(p.getByText('近一年高點').first()).toBeVisible(); } },
  { name: '策略頁', hash: '#/explore/strategies/near_high', prepare: async (p) => { await expect(p.getByRole('heading', { name: '健康度' })).toBeVisible(); await p.getByRole('button', { name: '看其他出場規則' }).click(); } },
  { name: '槓桿計算', hash: '#/explore/leverage?s=near_high', prepare: async (p) => { await expect(p.getByText('波動目標法倍數')).toBeVisible(); } },
  { name: '個股頁（每日籌碼、區間統計、有效訊號面板）', hash: '#/stock/2330', prepare: async (p) => { await revealAllSections(p); await expect(p.getByTestId('signal-panel')).toBeVisible(); await p.getByRole('group', { name: '明細期間' }).getByRole('button', { name: '60 日' }).click(); } },
  { name: '法人報表', hash: '#/stock/2330/institutional' },
  { name: '籌碼結構', hash: '#/stock/2330/holders' },
  { name: '多空對照', hash: '#/stock/2330/bullbear' },
  { name: '紀律', hash: '#/discipline' },
  { name: '訊號追蹤', hash: '#/discipline/tracking' },
  { name: '設定', hash: '#/me/settings' },
  { name: '資料健康', hash: '#/me/health' },
  { name: '回測', hash: '#/explore/backtest' },
  { name: '搜尋', hash: '#/search' },
  { name: '日誌', hash: '#/discipline/journal' },
  { name: '統計', hash: '#/discipline/stats' },
  { name: '徽章', hash: '#/discipline/badges' },
  { name: '週報', hash: '#/discipline/weekly' },
  { name: '我', hash: '#/me' },
  { name: '方法說明', hash: '#/me/methodology' },
  { name: '備份', hash: '#/me/backup' },
];

interface Problem { rule: string; detail: string }

/** 在頁面內檢查五條規則，回傳違規清單（每條最多 5 筆，避免訊息過長）。 */
async function audit(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; detail: string }[] = [];
    const add = (rule: string, detail: string) => { if (out.filter((p) => p.rule === rule).length < 5) out.push({ rule, detail }); };
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const desc = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}「${(el.textContent ?? '').trim().slice(0, 24)}」`;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false; // sr-only、隱藏量測元素
      const cs = getComputedStyle(el);
      // 透明的原生 input（自訂外觀的開關）仍然是可點擊元素，不排除
      if (cs.visibility === 'hidden' || cs.display === 'none' || (Number(cs.opacity) === 0 && el.tagName !== 'INPUT')) return false;
      if (el.closest('[aria-hidden="true"].cd-measure, .cd-wide-probe, [inert]')) return false;
      return true;
    };
    // 1. 左右滑移
    if (doc.scrollWidth > vw) add('左右滑移', `scrollWidth ${doc.scrollWidth} > clientWidth ${vw}`);
    for (const t of Array.from(document.querySelectorAll('table'))) {
      if (!visible(t)) continue;
      const r = t.getBoundingClientRect();
      if (r.right > vw + 0.5 || r.left < -0.5) add('左右滑移', `表格超出畫面 ${desc(t)} ${Math.round(r.left)}–${Math.round(r.right)}`);
      for (let el = t.parentElement; el && el !== document.body; el = el.parentElement) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) add('左右滑移', `表格在水平捲動容器內 ${desc(el)}`);
      }
    }
    // 2. 文字 ≥ 11px（含 SVG 文字）
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue;
      seen.add(el);
      if (el.closest('script, style, noscript, option') || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 10.95) add('字級 ≥ 11px', `${fs}px ${desc(el)}`);
    }
    // 3、4. 表格數字字級與對齊
    const NUM = /^[▲▼+\-−]?\s?[\d,]+(\.\d+)?\s?%?$/;
    for (const t of Array.from(document.querySelectorAll('table'))) {
      if (!visible(t)) continue;
      const rows = Array.from(t.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
      const cols = new Map<number, { cells: HTMLElement[]; numeric: boolean }>();
      for (const tr of rows) {
        Array.from(tr.children).forEach((c, i) => {
          const txt = ((c as HTMLElement).innerText ?? '').trim();
          if (!txt || txt === '—') return;
          const e = cols.get(i) ?? { cells: [], numeric: true };
          e.cells.push(c as HTMLElement);
          if (!NUM.test(txt)) e.numeric = false;
          cols.set(i, e);
        });
      }
      for (const [i, c] of cols) {
        if (!c.numeric || i === 0) continue;
        for (const cell of c.cells) {
          const cs = getComputedStyle(cell);
          const fs = Math.min(parseFloat(cs.fontSize), ...Array.from(cell.querySelectorAll('*')).filter((x) => (x.textContent ?? '').trim() && /\d/.test(x.textContent ?? '') && x.getAttribute('aria-hidden') !== 'true' && !x.classList.contains('sr-only') && !x.classList.contains('cd-arrow')).map((x) => parseFloat(getComputedStyle(x).fontSize)));
          if (fs < 12.95) add('表格數字 ≥ 13px', `${fs}px ${desc(cell)}`);
          if (!['right', 'end'].includes(cs.textAlign)) add('數字欄靠右', `${cs.textAlign} ${desc(cell)}`);
        }
      }
    }
    // 5. 可點擊元素 ≥ 44 × 44（計入 ::before 擴大範圍；段落中的行內連結除外）
    const clickables = Array.from(document.querySelectorAll('a[href], button, [role="button"], summary, select, [role="tab"], input[type="checkbox"], input[type="radio"]')) as HTMLElement[];
    for (const el of clickables) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none') continue;
      if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li, .caption, .meta-line, dd, td, .ev-sub')) continue;
      // 核取方塊、開關：點 <label> 整塊都會切換，觸控區是 label
      const target = el.tagName === 'INPUT' && el.closest('label') ? (el.closest('label') as HTMLElement) : el;
      const r = target.getBoundingClientRect();
      let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
      const b = getComputedStyle(target, '::before');
      if (b.content && b.content !== 'none' && b.position === 'absolute') {
        const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
        top = Math.min(top, r.top + px(b.top));
        bottom = Math.max(bottom, r.bottom - px(b.bottom));
        left = Math.min(left, r.left + px(b.left));
        right = Math.max(right, r.right - px(b.right));
      }
      const w = right - left, h = bottom - top;
      if (w < 43.5 || h < 43.5) add('觸控區 ≥ 44 × 44', `${Math.round(w)}×${Math.round(h)} ${desc(el)}`);
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`版面規範 ${vp.width}×${vp.height}`, () => {
    // service worker 會繞過 page.route（真實資料的評估結果改由路由提供），這個測試不註冊 SW
    test.use({ viewport: vp, serviceWorkers: 'block' });
    for (const p of PAGES) {
      test(`${p.name}`, async ({ page }) => {
        await useEvidenceFixtures(page);
        await page.goto(p.hash);
        await expect(page.locator('#main')).toBeVisible();
        await page.waitForTimeout(600);
        if (p.prepare) await p.prepare(page);
        // 往下捲一次，讓延後渲染的區塊出現
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(400);
        await page.evaluate(() => window.scrollTo(0, 0));
        const problems = await audit(page);
        expect(problems, problems.map((x) => `${x.rule}：${x.detail}`).join('\n')).toEqual([]);
      });
    }
  });
}
