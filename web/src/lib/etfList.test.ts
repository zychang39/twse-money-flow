import { describe, expect, it } from 'vitest';
import type { ActiveEtf } from '../data/types';
import { barMax, metricOf, missingRetText, periodSummary, rowSub, sortEtfs } from './etfList';

const etf = (code: string, over: Partial<ActiveEtf> = {}): ActiveEtf => ({
  code, name: `主動${code}`, close: 10, value_million_20d: 100, has_holdings: true, ...over,
});

const list = [
  etf('A', { value_million_20d: 4613, mcap_yi: 2910, ret: { '1d': -0.06, '20d': 3.2, ytd: 12 }, holdings_n: 50, holdings_foreign: 0 }),
  etf('B', { value_million_20d: 664, mcap_yi: null, ret: { '1d': 1.94, '20d': -4.1, ytd: null }, listed: '2026-03-02', has_holdings: false, holdings_note: '國泰投信官網擋本工具的自動抓取，沒有持股資料' }),
  etf('C', { value_million_20d: null, mcap_yi: 61, ret: { '1d': 0, '20d': null }, listed: '2026-09-25', holdings_n: 67, holdings_foreign: 67 }),
];

describe('主動式 ETF 清單（2026-10-09）', () => {
  it('依成交值、市值、績效排序，缺值排最後', () => {
    expect(sortEtfs(list, 'value', '20d').map((e) => e.code)).toEqual(['A', 'B', 'C']);
    expect(sortEtfs(list, 'mcap', '20d').map((e) => e.code)).toEqual(['A', 'C', 'B']);
    expect(sortEtfs(list, 'ret', '20d').map((e) => e.code)).toEqual(['A', 'B', 'C']);
    expect(sortEtfs(list, 'ret', '1d').map((e) => e.code)).toEqual(['B', 'C', 'A']);
    expect(metricOf(list[0], 'value', '1d')).toBe(46.13);
  });

  it('橫條刻度：績效取絕對值最大（同一張圖同一個刻度）', () => {
    expect(barMax(list, 'ret', '20d')).toBe(4.1);
    expect(barMax(list, 'mcap', '20d')).toBe(2910);
  });

  it('期間摘要與缺報酬的原因（上市未滿期間，不是資料錯誤）', () => {
    expect(periodSummary(list, '20d')).toBe('20 日：上漲 1 檔・下跌 1 檔・中位數 −0.45%（1 檔上市未滿期間）');
    expect(periodSummary([], '5d')).toBe('5 日：資料累積中');
    expect(missingRetText(list[2], '20d')).toBe('上市未滿 20 個交易日（9/25 上市）');
    expect(missingRetText(list[1], 'ytd')).toBe('今年才上市（3/2 上市）');
  });

  it('副資訊：沒有持股時寫原因（不寫「無持股資料」），海外持股標檔數', () => {
    expect(rowSub(list[0], 'value')).toBe('A・市值 2,910 億・持股 50 檔');
    expect(rowSub(list[1], 'ret')).toBe('B・均額 6.6 億・市值 —・國泰投信官網擋本工具的自動抓取，沒有持股資料');
    expect(rowSub(list[2], 'mcap')).toBe('C・均額 —・持股 67 檔（海外 67）');
  });
});
