import { describe, expect, it } from 'vitest';
import type { MarketLight, StockHistory, StockRow } from '../data/types';
import { dateLabel, envSummary, isLagging, lightDoc, lightRow, stockFactDoc, stockFactRows } from './entryFacts';
import { envInfo } from './envState';
import { thresholds, uiConfig } from './config';

const LATEST = '2026-10-05';
const L = (id: string, state: MarketLight['state'], extra: Partial<MarketLight> = {}): MarketLight => ({ id, label: id, state, value: '', basis: '', short: 'x', date: LATEST, ...extra });

describe('2026-10-06 事實頁：資金環境總結（判定規則沿用 envInfo）', () => {
  it('總結的狀態與 envInfo 一致；依據寫出幾項中幾項與規則', () => {
    const cases: MarketLight['state'][][] = [
      ['red', 'green', 'green', 'yellow', 'gray'],
      ['green', 'green', 'green', 'yellow', 'yellow'],
      ['green', 'green', 'yellow', 'yellow', 'gray'],
      ['gray', 'gray'],
    ];
    for (const states of cases) {
      const lights = states.map((s, i) => L(`l${i}`, s));
      expect(envSummary(lights).state).toBe(envInfo(lights).state);
    }
    expect(envSummary(cases[0].map((s, i) => L(`l${i}`, s)))).toMatchObject({ label: '保守', basis: '5 項中 1 項偏空、1 項資料不足（任一項偏空即判定為保守）' });
    expect(envSummary(cases[1].map((s, i) => L(`l${i}`, s))).basis).toBe(`5 項中 3 項偏多、沒有偏空（沒有偏空且 ${uiConfig.env_state.aggressive_min_green} 項以上偏多即判定為積極）`);
    expect(envSummary(cases[2].map((s, i) => L(`l${i}`, s))).basis).toBe('5 項中 2 項偏多、沒有偏空、1 項資料不足（偏多未達 3 項，判定為中性）');
    expect(envSummary([]).basis).toBe('資金指標資料源待處理');
  });
});

describe('每項指標一列：數值、狀態、資料日期與「資料落後」', () => {
  it('日資料：早於最新交易日即落後；美國殖利率允許時差與週末；月資料允許落後一個月公布', () => {
    expect(isLagging('daily', '2026-10-02', LATEST)).toBe(true);
    expect(isLagging('daily', LATEST, LATEST)).toBe(false);
    expect(isLagging('ust', '2026-10-02', LATEST)).toBe(false); // 週一看上週五
    expect(isLagging('ust', '2026-09-30', LATEST)).toBe(true);
    expect(isLagging('monthly', '2026-08', LATEST)).toBe(false);
    expect(isLagging('monthly', '2026-07', LATEST)).toBe(true);
    expect(isLagging('revenue', '2026-08', '2026-10-09')).toBe(false); // 9 月營收 10/10 前公布
    expect(isLagging('revenue', '2026-08', '2026-10-12')).toBe(true);
    expect(isLagging('daily', null, LATEST)).toBe(false);
  });

  it('列：偏多／中性／偏空；資料不足的列顯示原因、不標落後', () => {
    const r = lightRow(L('futures', 'red', { short: '−35,000 口', date: '2026-10-02' }), LATEST);
    expect(r).toMatchObject({ value: '−35,000 口', tag: '偏空', stance: 'bear', dateText: '10/2', stale: true });
    expect(lightRow(L('m1b', 'green', { date: '2026-08' }), LATEST)).toMatchObject({ tag: '偏多', dateText: '2026/08', stale: false });
    const g = lightRow(L('ust', 'gray', { date: null, detail: '美國財政部 Par Yield Curve' }), LATEST);
    expect(g).toMatchObject({ value: '—', tag: '資料不足', stale: false, dateText: '美國財政部 Par Yield Curve' });
    // 舊版資料沒有 date
    expect(lightRow(L('fx', 'yellow', { date: undefined }), LATEST).dateText).toBe('日期未提供');
    expect(dateLabel('2026-10-05')).toBe('10/5');
  });

  it('股票事實：超過 config/ui.yml impulse 門檻才列出', () => {
    const row = { code: '2330', name: '台積電', ma20_gap: 12.3, price_change_5d: 3 } as unknown as StockRow;
    const rows = stockFactRows(row, LATEST);
    expect(rows.map((r) => r.id)).toEqual(['ma20_gap']);
    expect(rows[0]).toMatchObject({ value: '+12.3%', tag: '', note: `提醒門檻 +${uiConfig.impulse.ma20_gap_pct}%` });
    expect(stockFactRows({ ...row, ma20_gap: uiConfig.impulse.ma20_gap_pct } as StockRow, LATEST)).toEqual([]);
  });
});

describe('說明頁四段：這是什麼／為什麼進場前要看／目前數值與判定門檻／近期走勢與資料來源', () => {
  const e = thresholds.market_env;
  const series = Array.from({ length: 20 }, (_, i) => ({ d: `2026-09-${String(i + 1).padStart(2, '0')}`, v: -20000 - i * 100, x: 4 + i * 0.01 }));

  it('五項指標都有完整內容；門檻與 thresholds.yml 一致', () => {
    for (const id of ['futures', 'fx', 'ma240', 'm1b', 'ust']) {
      const d = lightDoc(L(id, 'yellow', { series }), LATEST);
      expect(d.what.length, id).toBeGreaterThan(10);
      expect(d.why.length, id).toBeGreaterThan(10);
      expect(d.rules.length, id).toBeGreaterThan(1);
      expect(d.source, id).not.toMatch(/沒有登錄/);
      expect(d.table?.rows.length, id).toBe(20);
    }
    expect(lightDoc(L('futures', 'yellow'), LATEST).rules).toEqual([`≥ ${e.futures_net_oi.bullish_above} 口：偏多`, '≤ −30,000 口：偏空', '介於兩者之間：中性']);
    expect(lightDoc(L('fx', 'yellow'), LATEST).rules[0]).toBe(`20 日變化 ≤ −${Math.abs(e.usd_twd_change_20d_pct.inflow_below)}%（新台幣升值）：偏多`);
    expect(lightDoc(L('ma240', 'yellow'), LATEST).rules).toEqual([`乖離 > +${e.index_vs_ma240_pct.neutral_band}%：偏多`, `乖離 < −${e.index_vs_ma240_pct.neutral_band}%：偏空`, `±${e.index_vs_ma240_pct.neutral_band}% 以內（年線附近）：中性`]);
    expect(lightDoc(L('m1b', 'yellow'), LATEST).rules[0]).toBe(`M1B 年增率 − M2 年增率 > ${e.m1b_m2_gap.bullish_above} 個百分點：偏多`);
    expect(lightDoc(L('ust', 'yellow'), LATEST).rules[0]).toBe(`20 日變化 ≥ +${e.us10y_change_20d_bp.tightening_above}bp（資金成本上升）：偏空`);
  });

  it('原始數值表新到舊；沒有歷史資料時說明原因（不畫空圖）', () => {
    const d = lightDoc(L('ust', 'yellow', { series }), LATEST);
    expect(d.table!.rows[0].d).toBe('9/20');
    expect(d.table!.cols).toEqual(['日期', '20 日變化', '殖利率']);
    const none = lightDoc(L('ust', 'gray', { detail: '資料源待處理' }), LATEST);
    expect(none.chart).toEqual([]);
    expect(none.noHistory).toBe('目前沒有資料：資料源待處理');
  });

  it('股票事實說明頁：由個股檔 trend.series 算出乖離與 5 日漲跌', () => {
    const n = 30;
    const hist = { trend: { series: { dates: Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`), close: Array.from({ length: n }, (_, i) => 100 + i), ma20: Array.from({ length: n }, () => 100) } } } as unknown as StockHistory;
    const row = { code: '2330', name: '台積電', market: 'twse', ma20_gap: 29, price_change_5d: 4 } as unknown as StockRow;
    const g = stockFactDoc('ma20_gap', row, hist, LATEST);
    expect(g.chart).toHaveLength(20);
    expect(g.chart[g.chart.length - 1]).toBeCloseTo(29);
    expect(g.rules[0]).toBe(`> +${uiConfig.impulse.ma20_gap_pct}%：列入這一頁（提醒門檻，不影響其他判定）`);
    const p = stockFactDoc('price_change_5d', row, hist, LATEST);
    expect(p.table!.rows[0].cells[0]).toBe(`+${((129 / 124 - 1) * 100).toFixed(1)}%`);
    expect(stockFactDoc('ma20_gap', row, null, LATEST).chart).toEqual([]);
  });
});
