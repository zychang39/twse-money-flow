import { describe, expect, it } from 'vitest';
import { costLineFor, heroWindows, windowFor, withDaily } from './heroSeries';
import { rangeReturn } from './rangeReturn';
import { change, windowDayChange } from './periods';

// 除息日 2026-07-15（前收 100、現金股利 3 → 參考價 97，因子 0.97）與分割日 2026-08-20（1 拆 4，因子 0.25）
const d = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
const c = [99, 100, 97.5, 98, 200, 204, 51.5, 52];
// af[i]＝i 之後所有事件因子的乘積（最新一日＝1）
const af = [0.97 * 0.25, 0.97 * 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1];

describe('M5 還原／原始切換：主角數字、走勢、區間報酬同一組價格', () => {
  const ws = heroWindows(d, c, af, '1Y'); // 10Y、ALL 會改成週線取樣，這裡用日線
  it('原始價＝官方收盤；還原價＝收盤 × 還原因子，除息日與分割日前後的值', () => {
    expect(windowFor(ws, 'raw')!.values).toEqual(c);
    const adj = windowFor(ws, 'adj')!.values;
    expect(adj[1]).toBeCloseTo(100 * 0.97 * 0.25); // 除息前一日 24.25
    expect(adj[2]).toBeCloseTo(97.5 * 0.25); // 除息日 24.375
    expect(adj[5]).toBeCloseTo(204 * 0.25); // 分割前一日 51
    expect(adj[6]).toBeCloseTo(51.5); // 分割日
    // 最新一日兩者相同（主角數字最新值一樣，只有歷史不同）
    expect(adj[adj.length - 1]).toBe(c[c.length - 1]);
  });
  it('分割日前後：原始價是 −74.8% 的斷層，還原價是 +0.98%', () => {
    const raw = rangeReturn(d, windowFor(ws, 'raw')!.values, 5, 6)!;
    const adj = rangeReturn(d, windowFor(ws, 'adj')!.values, 5, 6)!;
    expect(raw.pct!).toBeCloseTo(((51.5 - 204) / 204) * 100);
    expect(adj.pct!).toBeCloseTo(((51.5 - 51) / 51) * 100);
  });
  it('除息日：原始價跌 2.5 元，還原價漲（相對參考價）', () => {
    const raw = windowFor(ws, 'raw')!.values;
    const adj = windowFor(ws, 'adj')!.values;
    expect(change(raw.slice(1, 3)).abs).toBeCloseTo(-2.5);
    expect(change(adj.slice(1, 3)).dir).toBe('up');
  });
  it('週線取樣：兩組價格的日期與點數完全相同', () => {
    const many = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
    const w = heroWindows(many, many.map((_, i) => 100 + i), many.map(() => 1), '10Y');
    expect(w.raw!.dates).toEqual(w.adj!.dates);
    expect(w.raw!.values.length).toBe(w.adj!.values.length);
  });
  it('成本線跟著基準換算（原始價算的成本線 × 還原因子）', () => {
    const line = [null, 100, 99, 98, 202, 203, 200, 52];
    expect(costLineFor(line, af, 'raw')).toBe(line);
    const adj = costLineFor(line, af, 'adj');
    expect(adj[5]).toBeCloseTo(203 * 0.25);
    expect(adj[7]).toBe(52);
    expect(adj[0]).toBeNull();
  });
});

describe('#3 「今日」漲跌與所選期間無關', () => {
  // 約 12 年的日資料（週一到週五），最後兩日 110.05 → 110.00（▼0.05）；一週前是 107.45
  const days: string[] = [];
  const t0 = Date.UTC(2014, 0, 6);
  for (let k = 0; days.length < 3000; k++) {
    const dt = new Date(t0 + k * 86400000);
    if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) days.push(dt.toISOString().slice(0, 10));
  }
  const closes = days.map((_, i) => 50 + i * 0.02);
  closes[closes.length - 2] = 110.05;
  closes[closes.length - 1] = 110;
  const factors = days.map(() => 1);

  it('1W～ALL（含週線取樣的 10Y、ALL）今日都是最後兩個交易日的差', () => {
    const periods = ['1W', '1M', '3M', 'YTD', '1Y', '5Y', '10Y', 'ALL'] as const;
    for (const p of periods) {
      for (const basis of ['adj', 'raw'] as const) {
        const w = windowFor(withDaily(heroWindows(days, closes, factors, p), days, closes, factors), basis)!;
        const t = windowDayChange(w)!;
        expect(t.abs, `${p} ${basis}`).toBeCloseTo(-0.05, 9);
        expect(t.pct!, `${p} ${basis}`).toBeCloseTo((-0.05 / 110.05) * 100, 9);
      }
    }
  });

  it('根本原因的對照：週線取樣的視窗，相鄰兩點相隔一週', () => {
    const w = windowFor(heroWindows(days, closes, factors, '10Y'), 'adj')!;
    const naive = windowDayChange(w)!; // 沒有日資料 → 用視窗相鄰兩點
    expect(Math.abs(naive.abs)).toBeGreaterThan(0.05);
  });

  it('查價到週線上的某一點：顯示該日相對前一個交易日的漲跌', () => {
    const w = windowFor(withDaily(heroWindows(days, closes, factors, 'ALL'), days, closes, factors), 'adj')!;
    const at = Math.floor(w.values.length / 2);
    const i = days.indexOf(w.dates[at]);
    expect(windowDayChange(w, at)!.abs).toBeCloseTo(closes[i] - closes[i - 1], 9);
  });
});
