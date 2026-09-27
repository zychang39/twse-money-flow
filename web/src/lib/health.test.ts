import { describe, expect, it } from 'vitest';
import type { HealthSource } from '../data/types';
import { affectedFor, describeSource, healthConclusion, siteName } from './health';

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
    expect(describeSource({ ...base, last_status: 'failed', last_message: '被網站安全機制阻擋', affects_latest: true }).text).toContain('連不上');
  });
  it('頁首結論', () => {
    expect(healthConclusion([base])).toBe('所有資料源都正常更新');
    expect(healthConclusion([{ ...base, format_warnings: ['x'] }])).toContain('相容模式');
  });
  it('頁首異常提示只看該頁用到的來源', () => {
    expect(affectedFor(['twse_quotes', 'tpex_valuation'], ['tpex_valuation', 'tdcc_holders'])).toEqual(['tpex_valuation']);
    expect(affectedFor(undefined, ['tpex_valuation'])).toEqual([]);
    expect(affectedFor(['twse_quotes'], ['tdcc_holders'])).toEqual([]);
  });
});
