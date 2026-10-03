import { describe, expect, it } from 'vitest';
import { conclusionLine, momentumPhrase, momentumState, valuationPhrase } from './verdict';
import { type Alignment, type MomentumFacts, momentumAnswer, momentumFacts, profitAnswer, profitFacts, revenueAnswer, revenueFacts, smaLast } from './fundamentals';
import { PV_LABELS } from './credit';
import { SECTION_ORDER, STYLE_PERIOD, parseStyle } from './style';

const ramp = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);

describe('動能', () => {
  it('均線（手算）：[1..5] 的 3 日均線＝(3+4+5)/3＝4；不足天數 → null', () => {
    expect(smaLast([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(smaLast([1, null, 3], 3)).toBeNull();
  });
  it('一路上漲 → 站上全部均線、多頭排列；「RS 87，站上全部均線」', () => {
    const f = momentumFacts(ramp(300, 100, 1), { rs_percentile: 87.4, dist_52w_high: 0, volume_ratio_20: 1.2 });
    expect(f.alignment).toBe('bull');
    expect(f.ma.every((m) => m.above)).toBe(true);
    expect(momentumAnswer(f)).toBe('RS 87，站上全部均線');
    expect(momentumState(f)).toEqual({ long: '強', short: 'up' });
  });
  it('一路下跌 → 空頭排列、跌破全部均線；資料不足 240 日 → 只看有的', () => {
    const f = momentumFacts(ramp(300, 400, -1), { rs_percentile: 12 });
    expect(f.alignment).toBe('bear');
    expect(momentumAnswer(f)).toBe('RS 12，跌破全部均線');
    // 手算：前 100 日 100→199、最後一日 185：MA20＝(181…199 去頭補 185)≈189.75 > 185（跌破）、MA60≈170.25 < 185（站上）
    const g = momentumFacts([...ramp(100, 100, 1), 185], { rs_percentile: 50 });
    expect(g.ma[2].value).toBeNull();
    expect(g.alignment).toBe('na');
    expect(momentumAnswer(g)).toBe('RS 50，跌破 20 日線');
  });
});

describe('#7 動能結論：長期強度與短期位置分開描述', () => {
  const mk = (rs: number, a20: boolean, a60: boolean, a240: boolean, alignment: Alignment): MomentumFacts => ({
    close: 100, rs, dist52: null, high52: null, volRatio: null, alignment,
    ma: [{ n: 20, value: 1, above: a20 }, { n: 60, value: 1, above: a60 }, { n: 240, value: 1, above: a240 }],
  });
  const cases: [string, MomentumFacts, string][] = [
    // RS 高 × 站上／跌破短均線
    ['RS 高、站上 20／60', mk(87, true, true, true, 'bull'), '動能偏強（RS 87、均線多頭排列）'],
    ['RS 高、跌破 20（5314 的情況）', mk(88, false, true, true, 'bull'), '長期動能強（RS 88、均線多頭排列），短期轉弱（跌破 20 日線）'],
    ['RS 高、跌破 20／60', mk(95, false, false, true, 'mixed'), '長期動能強（RS 95），短期轉弱（跌破 20／60 日線）'],
    ['RS 高、站上 20 但在 60 之下', mk(80, true, false, true, 'mixed'), '長期動能強（RS 80），短期回升（站上 20 日線）'],
    // RS 低 × 站上／跌破短均線
    ['RS 低、跌破 20／60', mk(12, false, false, false, 'bear'), '動能偏弱（RS 12、均線空頭排列）'],
    ['RS 低、站上 20／60', mk(20, true, true, false, 'mixed'), '長期動能弱（RS 20），短期偏強（站上 20／60 日線）'],
    ['RS 低、站上 20', mk(25, true, false, false, 'bear'), '長期動能弱（RS 25、均線空頭排列），短期回升（站上 20 日線）'],
    ['RS 低、跌破 20', mk(28, false, true, false, 'mixed'), '長期動能弱（RS 28），短期轉弱（跌破 20 日線）'],
    // RS 中段
    ['RS 中段、站上 20／60', mk(55, true, true, true, 'bull'), '長期動能中性（RS 55、均線多頭排列），短期偏強（站上 20／60 日線）'],
    ['RS 中段、跌破 20／60', mk(50, false, false, true, 'mixed'), '長期動能中性（RS 50），短期轉弱（跌破 20／60 日線）'],
    // RS 高但跌破年線且非多頭排列 → 長期不算強
    ['RS 高、跌破年線', mk(75, true, true, false, 'mixed'), '長期動能中性（RS 75），短期偏強（站上 20／60 日線）'],
  ];
  for (const [name, f, text] of cases) {
    it(name, () => {
      expect(momentumPhrase(f)).toBe(text);
      expect(text).not.toMatch(/買進|賣出|建議|(^|[^期])動能中性/);
    });
  }
  it('長短期一致時才合成一句；RS 缺值 → 不寫動能', () => {
    expect(momentumPhrase({ ...mk(87, true, true, true, 'bull'), rs: null })).toBeNull();
    const na = mk(87, true, true, true, 'bull');
    na.ma = na.ma.map((m) => (m.n === 60 ? { ...m, above: null } : m));
    expect(momentumPhrase(na)).toBe('長期動能強（RS 87、均線多頭排列）');
  });
});

describe('營收成長與獲利品質', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ ym: `2025-${String(i + 1).padStart(2, '0')}`.replace('2025-13', '2026-01').replace('2025-14', '2026-02'), revenue: 100 + i, yoy: i >= 4 ? 5 + i : -2, mom: 1 }));
  it('創 12 個月新高、連續成長月數（手算：第 5 個月起年增 > 0 → 連 10 個月）', () => {
    const f = revenueFacts(rows);
    expect(f.newHigh).toBe(true);
    expect(f.growthMonths).toBe(10);
    expect(f.yoy3m).toBeCloseTo((16 + 17 + 18) / 3);
    expect(revenueAnswer(f)).toBe('2 月營收年增 18.0%，創 12 個月新高，連續 10 個月成長');
    expect(revenueFacts([]).latest).toBeNull();
  });
  it('EPS 近四季合計、ROE、毛利率年增（手算）', () => {
    const q = ['2024Q3', '2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2'].map((p, i) => ({ period: p, revenue: 100, gross_margin: 40 + i * 0.5, net_income: 10, eps: 1 + i * 0.25, roe: 15 }));
    const f = profitFacts(q);
    expect(f.eps4).toBeCloseTo(2 + 2.25 + 2.5 + 2.75); // 9.5
    expect(f.eps4Prev).toBeCloseTo(1 + 1.25 + 1.5 + 1.75); // 5.5
    expect(f.gmYoY).toBeCloseTo(2); // 43.5 − 41.5
    expect(profitAnswer(f)).toBe('近四季 EPS 9.50 元（去年同期 5.50），ROE 15.0%，毛利率較去年同季 +2.0 個百分點');
  });
});

describe('一句話結論依風格調整側重點', () => {
  const mom = momentumFacts(ramp(300, 100, 1), { rs_percentile: 87 });
  const rev = revenueFacts(Array.from({ length: 13 }, (_, i) => ({ ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`, revenue: 100 + i, yoy: 10, mom: 1 })));
  const profit = profitFacts([{ period: '2026Q2', revenue: 1, gross_margin: 50, net_income: 1, eps: 1, roe: 22.4 }]);
  const x = { mom, foreignStreak: 5, trustStreak: -1, pv: PV_LABELS.up_down, rev, profit, pePct: 85 };
  it('波段：動能 → 法人 → 融資', () => {
    expect(conclusionLine('swing', x)).toBe('動能偏強（RS 87、均線多頭排列），外資連買 5 日，價漲資減（籌碼沉澱）。');
  });
  it('長期：營收 → ROE → 估值', () => {
    expect(conclusionLine('long', x)).toBe('營收連續 13 個月年增、創 12 個月新高，ROE 22.4%，本益比位於 3 年第 85 百分位（高區間；低 ≤ 20、高 ≥ 80）。');
    // 2026-10-02 健檢：低／中／高區間（不用偏低／中段／偏高），並寫出門檻
    expect(valuationPhrase(10)).toBe('本益比位於 3 年第 10 百分位（低區間；低 ≤ 20、高 ≥ 80）');
    expect(valuationPhrase(50)).toContain('中區間');
    expect(valuationPhrase(78)).toContain('中區間');
    expect(valuationPhrase(80)).toContain('高區間');
    for (const p of [10, 50, 90]) expect(valuationPhrase(p)).not.toMatch(/偏低|中段|偏高/);
  });
  it('不含買賣建議字眼', () => {
    for (const s of [conclusionLine('swing', x), conclusionLine('long', x)]) expect(s).not.toMatch(/買進|賣出|建議/);
  });
});

describe('投資風格', () => {
  it('預設波段動能、1Y；長期投資 5Y；區塊順序', () => {
    expect(parseStyle(null)).toBe('swing');
    expect(STYLE_PERIOD).toEqual({ swing: '1Y', long: '5Y' });
    // M3 波段動能：結論 → 有效訊號面板 → 四環分數 → 動能 → 法人 → 信用與空方 → 籌碼結構 → 營收與基本面 → 估值 → 事件
    expect(SECTION_ORDER.swing).toEqual(['conclusion', 'signals', 'scores', 'momentum', 'institutional', 'credit', 'structure', 'revenue', 'valuation', 'events']);
    expect(SECTION_ORDER.long).toEqual(['conclusion', 'scores', 'revenue', 'profit', 'valuation', 'structure', 'institutional', 'credit', 'signals', 'events']);
  });
});

import { peRiver, percentile } from './fundamentals';
describe('本益比河流', () => {
  it('百分位（手算，線性內插）：[10, 20, 30, 40, 50] 第 20 百分位＝18、第 50＝30', () => {
    expect(percentile([10, 20, 30, 40, 50], 20)).toBeCloseTo(18);
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
  it('每日股價線＝倍數 × 隱含 EPS（收盤 ÷ 本益比）；資料少於 20 日 → null', () => {
    const n = 30;
    const dates = Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const pe = Array.from({ length: n }, (_, i) => 10 + i); // 10..39
    const close = pe.map((x) => x * 5); // 隱含 EPS 固定 5 元
    const r = peRiver(dates, close, pe)!;
    const p50 = percentile(pe.slice().sort((a, b) => a - b), 50); // 24.5
    expect(r.bands[1].pe).toBeCloseTo(24.5);
    expect(r.bands[1].values[0]).toBeCloseTo(p50 * 5);
    expect(peRiver(dates.slice(0, 10), close.slice(0, 10), pe.slice(0, 10))).toBeNull();
  });
});
