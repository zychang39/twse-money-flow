import { describe, expect, it } from 'vitest';
import type { MarketData, MarketLight, StockHistory, StockRow } from '../data/types';
import {
  AUTO_KEYS, autoItems, autoMarket, autoReason, autoRevenue, autoTrend, autoValuation, buildSnapshot, effectiveOf, itemDoc,
  presetReason, reasonDraft, shortOf, snapshotDone, stopRefs, topSummary,
} from './checklistAuto';
import { screenerConfig, thresholds, uiConfig } from './config';

const LATEST = '2026-10-05';
const light = (id: string, state: MarketLight['state']): MarketLight => ({ id, label: id, state, value: '', basis: '', date: LATEST });
const market = (states: MarketLight['state'][]): MarketData => ({
  date: LATEST,
  env: { summary: '', lights: states.map((s, i) => light(['futures', 'fx', 'ma240', 'm1b', 'ust'][i], s)) },
} as unknown as MarketData);

const ROW = {
  code: '2330', name: '台積電', market: 'twse', close: 1100, ma60_gap: 8.2, ma240_gap: 15.3, ma20_gap: 3,
  pe: 22.5, pe_percentile: 45, revenue_yoy_3m: 31, foreign_streak: 5, trust_streak: 1,
  chip: 72, momentum: 60, fundamental: 80, valuation: 40, value_million: 30000, flags: [],
} as unknown as StockRow;

const HIST = {
  code: '2330',
  revenue: [
    { ym: '2026-06', revenue: 1, yoy: 31.1, mom: null },
    { ym: '2026-07', revenue: 1, yoy: 35.0, mom: null },
    { ym: '2026-08', revenue: 1, yoy: 30.2, mom: null },
  ],
  l: Array.from({ length: 30 }, (_, i) => 1000 + i),
  af: Array.from({ length: 30 }, () => 1),
} as unknown as StockHistory;

describe('2026-10-06 檢查表 1–5 自動帶出', () => {
  it('驗收 a：資料完整的股票 → 1–5 全部帶出，沒有「資料不足」', () => {
    const items = autoItems({ row: ROW, hist: HIST, market: market(['green', 'yellow', 'green', 'red', 'yellow']), latest: LATEST });
    for (const k of AUTO_KEYS) {
      expect(items[k].value, k).not.toBeNull();
      expect(items[k].short).not.toBe('資料不足');
    }
    const snap = buildSnapshot(items, {}, LATEST, '2026-10-05T12:00:00Z');
    expect(snapshotDone(snap)).toBe(true);
  });

  it('1. 市場燈號：沿用資金環境（任一偏空 → 偏空；≥ 3 偏多且無偏空 → 偏多；其餘中性），附簡報日期', () => {
    expect(autoMarket(market(['red', 'green', 'green', 'green', 'green']), LATEST).value).toBe('偏空');
    expect(autoMarket(market(['green', 'green', 'green', 'yellow', 'gray']), LATEST).value).toBe('偏多');
    expect(autoMarket(market(['green', 'green', 'yellow', 'yellow', 'gray']), LATEST).value).toBe('中性');
    const m = autoMarket(market(['red', 'yellow']), LATEST);
    expect(m.main).toBe('1 項偏空');
    expect(m.dateText).toBe('簡報 10/5');
    expect(autoMarket(null, LATEST).short).toBe('資料不足');
    expect(autoMarket(market(['gray', 'gray']), LATEST).value).toBeNull();
    // 簡報資料日早於最新交易日 → 資料落後
    expect(autoMarket({ ...market(['green']), date: '2026-10-02' }, LATEST).stale).toBe(true);
  });

  it('2. 趨勢：收盤、季線、年線、乖離；季線價 = 收盤 ÷ (1 + 乖離)', () => {
    const t = autoTrend(ROW, LATEST);
    expect(t.value).toBe('多頭（年線、季線之上）');
    expect(t.numbers.ma60).toBeCloseTo(1100 / 1.082, 2);
    expect(t.numbers.ma240).toBeCloseTo(1100 / 1.153, 2);
    expect(t.main).toBe('1,100');
    expect(t.basis).toBe('季線 1,017 (+8.2%)・年線 954.0 (+15.3%)');
    expect(autoTrend({ ...ROW, ma60_gap: -3 }, LATEST).value).toBe('年線之上、短線整理');
    expect(autoTrend({ ...ROW, ma240_gap: -0.1 }, LATEST).value).toBe('年線之下');
    expect(autoTrend({ ...ROW, ma240_gap: null }, LATEST).missing).toMatch(/240/);
    // 今日無成交（停牌等）不是資料落後
    expect(autoTrend({ ...ROW, last_trade_date: '2026-09-30' }, LATEST).stale).toBe(false);
  });

  it('3. 營收：逐月列出近 3 個月年增率與平均，依 config 分級', () => {
    const r = autoRevenue(ROW, HIST, LATEST);
    expect(r.value).toBe(`高成長（近 3 月年增 ≥ ${uiConfig.checklist.revenue_high_growth_pct}%）`);
    expect(r.main).toBe('+32.1%');
    expect(r.basis).toBe('8 月 +30.2%・7 月 +35.0%・6 月 +31.1%');
    expect(r.date).toBe('2026-08');
    expect(r.stale).toBe(false);
    const low = { ...HIST, revenue: (HIST.revenue as { yoy: number }[]).map((x) => ({ ...x, yoy: 5 })) } as StockHistory;
    expect(autoRevenue(ROW, low, LATEST).value).toBe('成長');
    const neg = { ...HIST, revenue: (HIST.revenue as { yoy: number }[]).map((x) => ({ ...x, yoy: -1 })) } as StockHistory;
    expect(autoRevenue(ROW, neg, LATEST).value).toBe('衰退');
    // 個股檔還沒載入：退回 summary 的近 3 月平均
    expect(autoRevenue(ROW, undefined, LATEST).main).toBe('+31.0%');
    // 10 月 15 日還沒有 9 月營收 → 資料落後（次月 10 日後）
    expect(autoRevenue(ROW, HIST, '2026-10-15').stale).toBe(true);
    // ETF：不適用；一般股票沒有資料：資料不足
    expect(autoRevenue({ ...ROW, code: '0050', revenue_yoy_3m: null }, null, LATEST).value).toBe('不適用');
    expect(autoRevenue({ ...ROW, revenue_yoy_3m: null }, null, LATEST).short).toBe('資料不足');
  });

  it('4. 估值：本益比與自身歷史百分位（估值環同定義）；虧損或無本益比 → 不適用；歷史不足 → 資料不足', () => {
    const c = uiConfig.checklist;
    expect(autoValuation({ ...ROW, pe_percentile: c.valuation_low_max }, LATEST).value).toBe('本益比位置低');
    expect(autoValuation({ ...ROW, pe_percentile: c.valuation_mid_max }, LATEST).value).toBe('本益比位置中');
    expect(autoValuation({ ...ROW, pe_percentile: c.valuation_mid_max + 0.1 }, LATEST).value).toBe('本益比位置高');
    const v = autoValuation(ROW, LATEST);
    expect(v.main).toBe('22.5 倍');
    expect(v.basis).toBe(`歷史第 45 百分位（近 ${Math.round(thresholds.indicators.valuation_percentile.lookback_days / 252)} 年）`);
    const loss = autoValuation({ ...ROW, pe: null, pe_percentile: null }, LATEST);
    expect(loss.value).toBe('不適用');
    expect(loss.basis).toBe('虧損或沒有本益比');
    const short = autoValuation({ ...ROW, pe_percentile: null }, LATEST);
    expect(short.value).toBeNull();
    expect(short.main).toBe('22.5 倍');
    // 修正：原本用合理價位置（fair_position）當成「本益比位置」
    expect(autoValuation({ ...ROW, fair_position: 95 } as StockRow, LATEST).value).toBe('本益比位置中');
  });

  it('5. 理由類型：符合的內建條件（依條件欄位分組）→ 否則四環最高', () => {
    const byId = Object.fromEntries(screenerConfig.presets.map((p) => [p.id, presetReason(p.conditions)]));
    expect(byId).toMatchObject({ chip_concentration: '籌碼', revenue_acceleration: '營收', strong_breakout: '動能', value_income: '估值' });
    const three = { ...ROW, trust_streak: 3, foreign_net_5d: 100, whale_change: 0.2, value_million: 30 } as StockRow;
    const a = autoReason(three, LATEST);
    expect(a.value).toBe('籌碼');
    expect(a.basis).toMatch(/^符合內建條件「三方同買」/);
    const r = autoReason(ROW, LATEST);
    expect(r.value).toBe('營收'); // fundamental 80 最高 → 營收
    expect(r.main).toBe('80 分');
    expect(autoReason({ ...ROW, chip: null, momentum: null, fundamental: null, valuation: null }, LATEST).value).toBeNull();
  });

  it('理由草稿只寫事實，不出現建議用語', () => {
    const items = autoItems({ row: ROW, hist: HIST, market: market(['green', 'yellow', 'green', 'red', 'yellow']), latest: LATEST });
    const d = reasonDraft(ROW, items);
    expect(d).toBe('外資連 5 日買超；資金環境保守；站上季線，乖離 +8%；站上年線，乖離 +15%；近 3 月營收年增 +32%；本益比 22.5 倍，歷史第 45 百分位');
    expect(d).not.toMatch(/買進|賣出|推薦|建議|應該|可以進場|加碼|減碼/);
  });

  it('停損參考價：季線、近 20 日低點（還原價換算）、進場價 −7%', () => {
    const refs = stopRefs(ROW, HIST, 1100);
    expect(refs.map((r) => r.id)).toEqual(['ma60', 'low', 'pct']);
    expect(refs[1].price).toBe(1010); // 近 20 日：索引 10–29 → 最低 1010
    expect(refs[1].label).toBe(`近 ${uiConfig.checklist.stop_low_days} 日低點`);
    expect(refs[2].price).toBe(1023);
    expect(refs[2].label).toBe(`進場價 −${Math.abs(thresholds.backtest.stop_loss_pct)}%`);
    // 分割後：舊的低點依還原因子換算到目前價格基準
    const split = { ...HIST, l: [...HIST.l.slice(0, 29), 500], af: [...Array(29).fill(0.5), 1] } as unknown as StockHistory;
    expect(stopRefs(ROW, split, null).find((r) => r.id === 'low')!.price).toBe(500);
    expect(stopRefs(undefined, null, null)).toEqual([]);
  });

  it('手動調整：快照標記 source；還原後回到 auto；資料不足且沒選 → 結果為 null、檢查表未完成', () => {
    const items = autoItems({ row: ROW, hist: HIST, market: market(['green']), latest: LATEST });
    const snap = buildSnapshot(items, { trend: '年線之下' }, LATEST, 'now');
    expect(snap.items.trend).toMatchObject({ source: 'manual', result: '年線之下', auto: '多頭（年線、季線之上）' });
    expect(snap.items.market).toMatchObject({ source: 'auto', result: items.market.value });
    expect(snap.items.trend!.numbers.gap60).toBe(8.2);
    expect(effectiveOf(items, {}, 'trend')).toBe('多頭（年線、季線之上）');
    const lacking = autoItems({ row: { ...ROW, pe_percentile: null }, hist: HIST, market: null, latest: LATEST });
    const s2 = buildSnapshot(lacking, {}, LATEST, 'now');
    expect(s2.items.market!.result).toBeNull();
    expect(snapshotDone(s2)).toBe(false);
    expect(snapshotDone(buildSnapshot(lacking, { market: '中性', valuation: '本益比位置中' }, LATEST, 'now'))).toBe(true);
  });

  it('頂部中性摘要：只在環境偏空或估值位置高時出現，只寫事實', () => {
    const calm = autoItems({ row: ROW, hist: HIST, market: market(['green', 'yellow']), latest: LATEST });
    expect(topSummary(calm)).toBeNull();
    const hot = autoItems({ row: { ...ROW, pe_percentile: 90 }, hist: HIST, market: market(['red', 'yellow']), latest: LATEST });
    expect(topSummary(hot)).toBe('資金環境保守（1 項偏空）・本益比 22.5 倍，歷史第 90 百分位（近 3 年）');
    expect(topSummary(hot)).not.toMatch(/建議|注意|小心|避免/);
  });

  it('說明頁四段齊全，門檻文字與設定一致', () => {
    for (const k of AUTO_KEYS) {
      const d = itemDoc(k, ROW);
      expect(d.what.length, k).toBeGreaterThan(5);
      expect(d.why.length, k).toBeGreaterThan(5);
      expect(d.rules.length, k).toBeGreaterThan(0);
      expect(d.source.length, k).toBeGreaterThan(0);
    }
    expect(itemDoc('revenue', ROW).rules[0]).toBe(`3 個月平均 ≥ ${uiConfig.checklist.revenue_high_growth_pct}% → 高成長`);
    expect(itemDoc('valuation', ROW).rules.slice(0, 3)).toEqual([
      `百分位 ≤ ${uiConfig.checklist.valuation_low_max} → 本益比位置低`,
      `≤ ${uiConfig.checklist.valuation_mid_max} → 本益比位置中`,
      `> ${uiConfig.checklist.valuation_mid_max} → 本益比位置高`,
    ]);
    expect(itemDoc('market', ROW).rules[1]).toBe(`沒有偏空且 ${uiConfig.env_state.aggressive_min_green} 項以上偏多 → 資金環境積極 → 偏多`);
    expect(shortOf('trend', '年線之上、短線整理')).toBe('整理');
    expect(shortOf('market', '舊紀錄的自由文字')).toBe('舊紀錄的自由文字');
  });
});
