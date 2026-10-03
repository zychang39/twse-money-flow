import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HealthSource } from '../data/types';
import { PAGE_SOURCES, affectedFor, asofSummary, describeSource, healthConclusion, siteName } from './health';

const base: HealthSource = {
  id: 'tpex_valuation', label: '上櫃本益比', tier: 'core', market: 'tpex', frequency: 'daily', verified: 'verified',
  last_success: '2026-09-24', last_status: 'ok', last_message: null, last_attempt: null, rows: 889, lag_days: 0,
  consecutive_failures: 0, affects_latest: false, format_warnings: [], format_warning_date: null,
};

describe('資料健康白話說明', () => {
  it('來源網站名稱', () => {
    expect(siteName(base)).toBe('櫃買中心');
    expect(siteName({ id: 'twse_quotes', market: 'twse' })).toBe('證交所');
  });
  it('格式變動但已相容 → 白話說明「已改用相容模式」，不用琥珀', () => {
    const d = describeSource({ ...base, format_warnings: ['上櫃本益比：缺少欄位「財報年/季」'] });
    expect(d).toEqual({ tone: 'compat', text: '櫃買中心調整了資料格式，已改用相容模式' });
  });
  it('回補歷史失敗、最新資料正常 → 不列為需要注意', () => {
    const d = describeSource({ ...base, last_status: 'failed', last_message: '找不到欄位「財報年/季」', affects_latest: false });
    expect(d.tone).toBe('compat');
    expect(d.text).toContain('最新資料不受影響');
  });
  it('影響最新資料的格式錯誤與連線錯誤', () => {
    expect(describeSource({ ...base, last_status: 'failed', last_message: '找不到必要欄位「本益比」', affects_latest: true }).tone).toBe('risk');
    // E-09：WAF 阻擋（即使訊息同時提到「不是 JSON」）也不是格式變動
    const blocked = describeSource({ ...base, id: 'twse_insti', market: 'twse', last_status: 'failed', last_message: '被網站安全機制阻擋（WAF，HTTP 307／FOR SECURITY REASONS）：…', affects_latest: true });
    expect(blocked.text).toBe('證交所暫時阻擋自動抓取，已放慢速度，下次排程會自動重試');
    expect(blocked.text).not.toContain('格式');
  });
  it('Q-08：PAGE_SOURCES 的每個來源 id 都在 config/sources.yml（行事曆是 investor_conference）', () => {
    const yml = readFileSync(new URL('../../../config/sources.yml', import.meta.url), 'utf8');
    const ids = new Set([...yml.matchAll(/^ {2}([a-z0-9_]+):\s*$/gm)].map((m) => m[1]));
    for (const [page, list] of Object.entries(PAGE_SOURCES)) {
      for (const id of list) expect(ids.has(id), `${page}: ${id}`).toBe(true);
    }
    expect(PAGE_SOURCES.calendar).toContain('investor_conference');
  });
  it('頁首結論', () => {
    expect(healthConclusion([base])).toBe('1／1 正常');
    expect(healthConclusion([base, { ...base, format_warnings: ['x'] }])).toBe('1／2 正常・相容模式 1');
  });
  it('頁首異常提示只看該頁用到的來源', () => {
    expect(affectedFor(['twse_quotes', 'tpex_valuation'], ['tpex_valuation', 'tdcc_holders'])).toEqual(['tpex_valuation']);
    expect(affectedFor(undefined, ['tpex_valuation'])).toEqual([]);
    expect(affectedFor(['twse_quotes'], ['tdcc_holders'])).toEqual([]);
  });
});

describe('各資料集的資料日（M1-4）', () => {
  const asof = { quotes: '2026-10-02', insti: '2026-10-02', credit: '2026-10-01', tdcc: '2026-09-24', etf_holdings: '2026-10-01', taifex: null };
  it('每個資料集標自己的日期', () => {
    expect(asofSummary(asof, ['insti', 'credit', 'tdcc', 'etf_holdings'])).toBe('三大法人 10/2・融資融券 10/1・集保股權分散 9/24・主動式 ETF 持股 10/1');
  });
  it('沒有日期的資料集寫原因，不留空破折號', () => {
    expect(asofSummary(asof, ['taifex'])).toBe('期貨法人 —（尚未取得）');
    expect(asofSummary(asof, ['quotes', 'sbl'])).toBe('收盤行情 10/2・借券 —（尚未取得）');
  });
  it('舊版 meta 沒有 asof → 不顯示這一行', () => {
    expect(asofSummary(undefined, ['quotes'])).toBeNull();
    expect(asofSummary(null, ['quotes'])).toBeNull();
    expect(asofSummary(asof, [])).toBeNull();
  });
});
