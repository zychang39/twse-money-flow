/**
 * 個人統計（§8.8）與週報的流程統計：以 R 計（R＝實現損益 ÷ 計畫風險金額）。純函式。
 * - 實現損益含手續費與證交稅、依 adjFactor 換算（sizing.tradePnl）；計畫風險＝(進場價 − 停損價) × 股數。
 * - 沒有計畫風險（無停損）的交易無法換算 R，不納入 R 的平均，但仍計入筆數。
 */
import type { Trade } from '../db/db';
import { uiConfig } from './config';
import { tradePnl } from './sizing';
import { completionRate, flowStreak, plannedRiskOf, tradeCompliance, VIOLATION_TAGS, violationEvents, weekOf, type DayDot, type FlowInput, type ViolationTag } from './ritual';

export function rOf(t: Trade): number | null {
  if (t.status !== 'closed' || t.exit === undefined) return null;
  const plan = plannedRiskOf(t);
  return plan ? tradePnl(t) / plan : null;
}

export interface RSummary {
  /** 已平倉筆數 */
  n: number;
  /** 可換算 R 的筆數 */
  rN: number;
  /** 勝率（實現損益 > 0 的比例；分母＝n） */
  winRate: number | null;
  avgWinR: number | null;
  /** 平均虧損 R（負數） */
  avgLossR: number | null;
  /** 期望值 R＝平均 R */
  expectancyR: number | null;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function rSummary(trades: Trade[]): RSummary {
  const closed = trades.filter((t) => t.status === 'closed' && t.exit !== undefined);
  const rs = closed.map(rOf).filter((r): r is number => r !== null);
  return {
    n: closed.length,
    rN: rs.length,
    winRate: closed.length ? closed.filter((t) => tradePnl(t) > 0).length / closed.length : null,
    avgWinR: mean(rs.filter((r) => r > 0)),
    avgLossR: mean(rs.filter((r) => r <= 0)),
    expectancyR: mean(rs),
  };
}

export type GroupStat =
  | { n: number; enough: true; avgR: number | null; winRate: number | null; rN: number }
  | { n: number; enough: false; text: string };

function group(trades: Trade[], min: number): GroupStat {
  if (trades.length < min) return { n: trades.length, enough: false, text: `樣本不足（${trades.length}/${min}）` };
  const s = rSummary(trades);
  return { n: s.n, enough: true, avgR: s.expectancyR, winRate: s.winRate, rN: s.rN };
}

/** 合規 vs 不合規（已平倉）：任一組 < 20 筆時該組只顯示「樣本不足（n/20）」。尚未結算的（檢討期限內）不列入兩組。 */
export function compliantSplit(input: FlowInput): { compliant: GroupStat; violation: GroupStat; pending: number } {
  const min = (input.cfg ?? uiConfig.gamification).min_group_sample;
  const closed = input.trades.filter((t) => t.status === 'closed' && t.exit !== undefined);
  const st = closed.map((t) => ({ t, s: tradeCompliance(t, input).status }));
  return {
    compliant: group(st.filter((x) => x.s === 'compliant').map((x) => x.t), min),
    violation: group(st.filter((x) => x.s === 'violation').map((x) => x.t), min),
    pending: st.filter((x) => x.s === 'pending').length,
  };
}

const zeroCounts = (): Record<ViolationTag, number> => Object.fromEntries(VIOLATION_TAGS.map((t) => [t, 0])) as Record<ViolationTag, number>;

/** 違規標籤次數（近 20 筆交易，依進場日由新到舊；含持有中）。 */
export function recentViolations(input: FlowInput): { trades: number; counts: Record<ViolationTag, number>; total: number } {
  const n = (input.cfg ?? uiConfig.gamification).recent_trades;
  const recent = [...input.trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, n);
  const counts = zeroCounts();
  for (const t of recent) for (const tag of tradeCompliance(t, input).tags) counts[tag]++;
  return { trades: recent.length, counts, total: Object.values(counts).reduce((s, x) => s + x, 0) };
}

/** 近 20 個交易日流程完成率 */
export function recentCompletion(input: FlowInput, days: DayDot[] = flowStreak(input).days): { done: number; total: number; rate: number | null } {
  return completionRate(days);
}

/**
 * 週報：本週（顯示日所在週，週一到週日）的流程完成率與違規標籤次數。
 * 違規標籤依發生日歸週：進場類＝進場日、虧損超出計畫＝平倉日、逾期檢討＝檢討到期日。
 */
export function weeklyFlow(input: FlowInput): { week: string; completion: { done: number; total: number; rate: number | null }; counts: Record<ViolationTag, number>; total: number } {
  const st = flowStreak(input);
  const week = weekOf(st.day);
  const completion = completionRate(st.days.filter((d) => weekOf(d.day) === week));
  const counts = zeroCounts();
  for (const t of input.trades) for (const e of violationEvents(t, input)) if (weekOf(e.day) === week) counts[e.tag]++;
  return { week, completion, counts, total: Object.values(counts).reduce((s, x) => s + x, 0) };
}
