import { describe, expect, it } from 'vitest';
import golden from '../../../tests/fixtures/golden/calendar_2026.json';
import { datasetRows, expectedDate } from './dataStatus';
import { makeCalendar } from './tradingCalendar';

const cal = makeCalendar(golden as { closed: string[] });

describe('資料狀態頁：應有日依公布時程與交易日曆推算（2026-10-02 健檢 M2）', () => {
  it('每日型：最近一個交易日（週末、休市日取前一個交易日）', () => {
    expect(expectedDate('quotes', cal, { today: '2026-10-02', hhmm: '22:00' })).toBe('2026-10-02');
    expect(expectedDate('insti', cal, { today: '2026-10-03', hhmm: '10:00' })).toBe('2026-10-02'); // 週六
    expect(expectedDate('quotes', cal, { today: '2026-10-09', hhmm: '15:00' })).toBe('2026-10-08'); // 國慶日休市
  });
  it('信用：預期公布時間 22:00（2026-10-06 新鮮度規則）前的應有日是前一個交易日', () => {
    expect(expectedDate('credit', cal, { today: '2026-10-02', hhmm: '21:45' })).toBe('2026-10-01');
    expect(expectedDate('credit', cal, { today: '2026-10-02', hhmm: '22:00' })).toBe('2026-10-02');
    expect(expectedDate('credit', cal, { today: '2026-10-03', hhmm: '09:00' })).toBe('2026-10-02');
  });
  it('集保：昨天以前最近的週五（9/25 休市 → 9/24）', () => {
    expect(expectedDate('tdcc', cal, { today: '2026-10-02', hhmm: '12:00' })).toBe('2026-09-24'); // 10/2 是週五，昨天以前最近的週五是 9/25（休市）→ 9/24
    expect(expectedDate('tdcc', cal, { today: '2026-10-03', hhmm: '12:00' })).toBe('2026-10-02');
  });
  it('主動式 ETF 持股：今天的前一個交易日；月營收：10 日後上個月；季財報：季度', () => {
    expect(expectedDate('etf_holdings', cal, { today: '2026-10-02', hhmm: '12:00' })).toBe('2026-10-01');
    expect(expectedDate('revenue', cal, { today: '2026-10-02', hhmm: '12:00' })).toBe('2026-08');
    expect(expectedDate('revenue', cal, { today: '2026-10-11', hhmm: '12:00' })).toBe('2026-09');
    expect(expectedDate('revenue', cal, { today: '2026-01-05', hhmm: '12:00' })).toBe('2025-11');
    expect(expectedDate('financials', cal, { today: '2026-10-02', hhmm: '12:00' })).toBe('2026 Q2');
    expect(expectedDate('financials', cal, { today: '2026-11-20', hhmm: '12:00' })).toBe('2026 Q3');
  });
  it('datasetRows：已齊／落後／沒有資料，附涵蓋率、回補進度與失敗原因', () => {
    const health = {
      market_date: '2026-10-02',
      sources: [
        { id: 'twse_margin', label: '融資融券（上市）', tier: 'core', market: 'twse', frequency: 'daily', verified: 'verified', last_success: '2026-10-01', last_status: 'failed', last_message: 'HTTP 503', last_attempt: null, rows: 1, lag_days: 1, consecutive_failures: 1, affects_latest: true },
        { id: 'tdcc_holders', label: '集保股權分散', tier: 'advanced', market: 'all', frequency: 'weekly', verified: 'verified', last_success: '2026-09-24', last_status: 'ok', last_message: null, last_attempt: null, rows: 1, lag_days: null, consecutive_failures: 0 },
      ],
      closed_days: [], runs: [], trading_days: 1, first_date: null,
      backfill: { total: 99500, remaining: 72601, codes: 1990, weeks: 51, eta: '2026-10-08T02:04+08:00', oldest_week: '20251003' },
    } as never;
    const rows = datasetRows(health, { quotes: '2026-10-02', credit: '2026-10-01', tdcc: '2026-09-24', insti: null }, cal, { today: '2026-10-02', hhmm: '22:00' }, {
      tdcc: { ratio: 0.0491, included: 29, universe: 590, date: '2026-10-02', note: '回補中' },
      etf: { covered: 8, total: 32 },
    });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.quotes.state).toBe('ok');
    expect(by.credit.state).toBe('lag');
    expect(by.credit.lagText).toBe('落後 1 個交易日（應有 10/2）');
    expect(by.credit.failure).toContain('融資融券（上市）');
    expect(by.insti.state).toBe('missing');
    expect(by.tdcc.state).toBe('ok'); // 應有 9/24（10/2 當天的昨天以前最近的週五 9/25 休市 → 9/24）
    expect(by.tdcc.coverage).toContain('4.91%');
    expect(by.tdcc.backfill).toContain('26,899／99,500');
    expect(by.etf_holdings.coverage).toBe('8／32 檔主動式 ETF 有持股資料');
  });
});
