/** 投資組合分析：權益曲線（計入除息現金股利與除權配股）、報酬、月報酬、最大回撤、相關性。 */
import type { Trade } from '../db/db';

export interface PriceSeries { dates: string[]; close: (number | null)[] }
export interface DividendEvent { date: string; cash: number; stockRatio: number }

export interface EquityPoint { date: string; equity: number; cash: number; holdings: number }

/**
 * 權益曲線：初始資金 capital；每筆交易於 openedAt 當日以進場價買入（扣手續費 fees 於平倉時計入），closedAt 賣出。
 * 持有期間遇除息日：現金 += 股數 × 現金股利；遇除權日：股數 += 股數 × 配股率。
 */
export function equityCurve(capital: number, trades: Trade[], prices: Record<string, PriceSeries>, divs: Record<string, DividendEvent[]>, calendar: string[]): EquityPoint[] {
  const out: EquityPoint[] = [];
  let cash = capital;
  const holdings = new Map<string, { shares: number; trade: Trade }>();
  const priceAt = new Map<string, Map<string, number>>();
  for (const [code, s] of Object.entries(prices)) {
    const m = new Map<string, number>();
    s.dates.forEach((d, i) => { const c = s.close[i]; if (c !== null && c !== undefined) m.set(d, c); });
    priceAt.set(code, m);
  }
  const lastPx = new Map<string, number>();
  const opens = [...trades].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  for (const d of calendar) {
    for (const t of opens) {
      if (t.openedAt.slice(0, 10) === d && !holdings.has(t.id)) {
        cash -= t.entry * t.shares;
        holdings.set(t.id, { shares: t.shares, trade: t });
        lastPx.set(t.code, t.entry);
      }
    }
    for (const [id, h] of holdings) {
      for (const ev of divs[h.trade.code] ?? []) {
        if (ev.date === d && d > h.trade.openedAt.slice(0, 10)) {
          cash += h.shares * ev.cash;
          h.shares += Math.floor(h.shares * ev.stockRatio);
        }
      }
      if (h.trade.status === 'closed' && h.trade.closedAt && h.trade.closedAt.slice(0, 10) === d && h.trade.exit !== undefined) {
        cash += h.trade.exit * h.shares - (h.trade.fees ?? 0);
        holdings.delete(id);
      }
    }
    let value = 0;
    for (const h of holdings.values()) {
      const p = priceAt.get(h.trade.code)?.get(d) ?? lastPx.get(h.trade.code) ?? h.trade.entry;
      lastPx.set(h.trade.code, p);
      value += p * h.shares;
    }
    out.push({ date: d, equity: cash + value, cash, holdings: value });
  }
  return out;
}

export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) mdd = Math.max(mdd, 1 - v / peak);
  }
  return mdd;
}

/** 月報酬（以每月最後一個權益值計）。 */
export function monthlyReturns(points: { date: string; equity: number }[]): { month: string; ret: number }[] {
  const lastByMonth = new Map<string, number>();
  for (const p of points) lastByMonth.set(p.date.slice(0, 7), p.equity);
  const months = [...lastByMonth.keys()].sort();
  const out: { month: string; ret: number }[] = [];
  let prev = points.length ? points[0].equity : 0;
  for (const m of months) {
    const v = lastByMonth.get(m)!;
    out.push({ month: m, ret: prev ? v / prev - 1 : 0 });
    prev = v;
  }
  return out;
}

/** 皮爾森相關係數（近 window 日還原日報酬；共同有效日不足 minObs 回傳 null）。 */
export function correlation(a: (number | null)[], b: (number | null)[], window = 60, minObs = 40): number | null {
  const ra: number[] = [];
  const rb: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = Math.max(1, n - window); i < n; i++) {
    const [a0, a1, b0, b1] = [a[i - 1], a[i], b[i - 1], b[i]];
    if (a0 && a1 && b0 && b1) { ra.push(a1 / a0 - 1); rb.push(b1 / b0 - 1); }
  }
  if (ra.length < minObs) return null;
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra), mb = mean(rb);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

/** 依日期對齊兩個序列（回傳 b 在 a 的日期上的值）。 */
export function alignTo(dates: string[], s: PriceSeries): (number | null)[] {
  const m = new Map(s.dates.map((d, i) => [d, s.close[i]]));
  return dates.map((d) => m.get(d) ?? null);
}

export function normalize(values: (number | null)[], base = 100): (number | null)[] {
  const first = values.find((v) => v !== null && v !== undefined && v > 0);
  return values.map((v) => (v === null || v === undefined || !first ? null : (v / first) * base));
}
