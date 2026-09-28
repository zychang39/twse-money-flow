import { describe, expect, it } from 'vitest';
import type { StockHistory } from '../data/types';
import { CATS, crossAgo, evaluate, macdHist, rsi, summary, tally, title } from './bullbear';

function stock(closes: number[], metrics: Record<string, unknown>): StockHistory {
  const n = closes.length;
  const d = Array.from({ length: n }, (_, i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  const z = () => Array(n).fill(null);
  return {
    code: '2330', name: '台積電', market: 'twse', industry: null, shares: null,
    d, o: closes, h: closes, l: closes, c: closes, v: Array(n).fill(1000), val: z(), af: Array(n).fill(1),
    fn: z(), tn: z(), dn: z(), mb: z(), sb: z(), pe: z(), pb: z(), dy: z(), metrics,
    quarters: [{ period: '2025Q2', gross_margin: 50 }, { period: '2026Q1', gross_margin: 55 }, { period: '2026Q2', gross_margin: 53.5 }],
    dt: [12, 45],
  } as unknown as StockHistory;
}

const up = Array.from({ length: 80 }, (_, i) => 100 + i);

describe('多空對照', () => {
  it('RSI：一路上漲為 100、一路下跌為 0、資料不足為空值', () => {
    expect(rsi(up, 14)).toBe(100);
    expect(rsi([...up].reverse(), 14)).toBe(0);
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });

  it('MACD：上漲趨勢的柱狀體為正；翻正／翻負的天數', () => {
    const h = macdHist([...Array(40).fill(100), ...up]);
    expect(h[h.length - 1]).toBeGreaterThan(0);
    expect(crossAgo([-1, -0.5, 0.2, 0.4], 5)).toEqual({ days: 1, up: true });
    expect(crossAgo([1, 0.5, -0.2], 5)).toEqual({ days: 0, up: false });
    expect(crossAgo([1, 2, 3], 5)).toBeNull();
  });

  it('四個面向都有條件；依門檻分成多方／空方／中性，缺資料為「資料不足」', () => {
    const checks = evaluate(stock(up, {
      revenue_yoy_3m: 25, revenue_high_ratio: 100, revenue_growth_months: 8, roe: 2, pe_percentile: 85, fair_position: 40, dividend_yield: 1.2,
      foreign_streak: 4, trust_streak: -3, margin_change_5d: 6, price_change_5d: -2, whale_change: 0.1,
      volume_ratio_20: 1.5, dist_52w_high: -1, rs_percentile: 90, ma20_gap: 2, ma60_gap: 5, ma240_gap: -3,
    }));
    for (const c of CATS) expect(checks.some((x) => x.cat === c)).toBe(true);
    const side = (id: string) => checks.find((x) => x.id === id)?.side;
    expect(side('rev_yoy')).toBe('bull');
    expect(side('roe')).toBe('bear');
    expect(side('pe_pct')).toBe('bear');
    expect(side('fair')).toBe('neutral');
    expect(side('gm')).toBe('bull'); // 53.5 vs 去年同季 50 → +3.5 個百分點
    expect(side('foreign')).toBe('bull');
    expect(side('trust')).toBe('bear');
    expect(side('margin')).toBe('bear'); // 融資增加但股價下跌
    expect(side('insti')).toBe('na'); // 沒有 chip 區塊
    expect(side('pv')).toBe('bear'); // 下跌放量
    expect(side('high')).toBe('bull');
    expect(side('daytrade')).toBe('bear');
    expect(side('ma')).toBe('bull');
    expect(side('ma240')).toBe('bear');
    expect(side('align')).toBe('bull');
    expect(side('rsi')).toBe('bear'); // 一路上漲 → 過熱
    expect(checks.find((x) => x.id === 'margin')?.text).toBe('融資 5 日增加 6.0%，股價下跌 2.0%（融資增加但股價下跌）');
  });

  it('標題與結論句：只做條件統計，不用買賣字眼', () => {
    const checks = evaluate(stock(up, { revenue_yoy_3m: 25, ma20_gap: 2, ma60_gap: 5 }));
    const t = tally(checks);
    expect(t.bull + t.bear + t.neutral + t.na).toBe(checks.length);
    expect(title(t)).toBe(`多方 ${t.bull} 項、空方 ${t.bear} 項`);
    const s = summary(checks);
    expect(s).toMatch(/^有資料的 \d+ 項條件中，多方 \d+ 項、空方 \d+ 項、中性 \d+ 項/);
    expect(s).not.toMatch(/買進|賣出|建議/);
  });
});
