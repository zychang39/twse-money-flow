/** 部位大小、風險報酬比、期望值、交易統計（純函式）。 */
import type { Trade } from '../db/db';

/** 張數 = floor(總資金 × 單筆風險% ÷ (進場價 − 停損價) ÷ 1000)；零股模式回傳股數。 */
export function positionSize(capital: number, riskPct: number, entry: number, stop: number, oddLot = false): { shares: number; lots: number; riskAmount: number } {
  const perShare = entry - stop;
  if (!(capital > 0) || !(riskPct > 0) || !(perShare > 0)) return { shares: 0, lots: 0, riskAmount: 0 };
  const budget = (capital * riskPct) / 100;
  const rawShares = budget / perShare;
  const shares = oddLot ? Math.floor(rawShares) : Math.floor(rawShares / 1000) * 1000;
  return { shares, lots: Math.floor(shares / 1000), riskAmount: shares * perShare };
}

/** 風險報酬比 = (目標 − 進場) ÷ (進場 − 停損)。 */
export function rewardRisk(entry: number, stop: number, target: number): number | null {
  const risk = entry - stop;
  if (!(risk > 0)) return null;
  return (target - entry) / risk;
}

/** 期望值 = 勝率 × 平均獲利 − 敗率 × 平均虧損（虧損以正數輸入）。 */
export function expectancy(winRate: number, avgWin: number, avgLoss: number): number {
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

/** R 倍數。平倉價是平倉當時的價格基準；進場價與停損依 adjFactor（D-01：期間的分割、除權息）換算後再比較。 */
export function rMultiple(t: Pick<Trade, 'entry' | 'stop' | 'exit' | 'adjFactor'>): number | null {
  const f = t.adjFactor ?? 1;
  const risk = (t.entry - t.stop) * f;
  if (!(risk > 0) || t.exit === undefined) return null;
  return (t.exit - t.entry * f) / risk;
}

export interface ClosedStats {
  n: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  evAmount: number | null;
  evR: number | null;
  avgHoldDays: number | null;
  totalPnl: number;
}

/** 已實現損益：(平倉價 − 進場價 × F) × 股數 ÷ F − 費用；F＝adjFactor（沒有公司行動＝1，公式退化為原本的價差 × 股數）。 */
export function tradePnl(t: Pick<Trade, 'entry' | 'shares' | 'fees' | 'exit' | 'adjFactor'>, sell = t.exit): number {
  if (sell === undefined) return 0;
  const f = t.adjFactor ?? 1;
  return (sell - t.entry * f) * (t.shares / f) - (t.fees ?? 0);
}

export function closedStats(trades: Trade[]): ClosedStats {
  const closed = trades.filter((t) => t.status === 'closed' && t.exit !== undefined);
  const n = closed.length;
  if (!n) return { n: 0, winRate: null, avgWin: null, avgLoss: null, payoff: null, evAmount: null, evR: null, avgHoldDays: null, totalPnl: 0 };
  const pnl = closed.map((t) => tradePnl(t));
  const wins = pnl.filter((p) => p > 0);
  const losses = pnl.filter((p) => p <= 0).map((p) => -p);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const winRate = wins.length / n;
  const rs = closed.map(rMultiple).filter((r): r is number => r !== null);
  const rWins = rs.filter((r) => r > 0);
  const rLoss = rs.filter((r) => r <= 0).map((r) => -r);
  const days = closed.map((t) => (Date.parse(t.closedAt ?? t.openedAt) - Date.parse(t.openedAt)) / 86400000);
  return {
    n,
    winRate,
    avgWin: wins.length ? mean(wins) : null,
    avgLoss: losses.length ? mean(losses) : null,
    payoff: wins.length && losses.length && mean(losses) > 0 ? mean(wins) / mean(losses) : null,
    evAmount: expectancy(winRate, mean(wins), mean(losses)),
    evR: rs.length ? expectancy(rWins.length / rs.length, mean(rWins), mean(rLoss)) : null,
    avgHoldDays: mean(days),
    totalPnl: pnl.reduce((s, x) => s + x, 0),
  };
}

export function countBy<T>(items: T[], key: (t: T) => string[] | string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    for (const x of Array.isArray(k) ? k : k ? [k] : []) out[x] = (out[x] ?? 0) + 1;
  }
  return out;
}

/** 依理由類型分組的績效。 */
export function byReason(trades: Trade[]): { reason: string; stats: ClosedStats }[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades.filter((x) => x.status === 'closed')) groups.set(t.reasonType, [...(groups.get(t.reasonType) ?? []), t]);
  return [...groups.entries()].map(([reason, ts]) => ({ reason, stats: closedStats(ts) }));
}

/** 全部觸及停損時的總虧損（只計停損價低於現價的持倉）。 */
export function lossIfAllStopped(open: { shares: number; stop: number; price: number }[]): number {
  return open.reduce((s, p) => s + (p.price > p.stop ? (p.price - p.stop) * p.shares : 0), 0);
}
