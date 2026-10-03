/**
 * 成就（§8.7）：維持 8 個，只看流程（合規、連續、依計畫停損、檢討、風險上限），不看損益或交易次數。
 * 每個成就顯示條件文字與進度 n/N；遷移前已取得的舊成就依 LEGACY_BADGE_MAP 對應到最接近的新成就並保留。
 */
import type { Activity } from '../db/db';
import { uiConfig, type BadgeConfig } from './config';
import { hasReview, legacyOf, nextTradingDay, planStop, reviewedMs, riskWithinLimit, stopRespected, tradeCompliance, type FlowInput } from './ritual';

type Gcfg = typeof uiConfig.gamification;

/**
 * 舊成就（v4，id）→ 新成就（id）。原則：同類行為對應同類；與損益、交易次數掛鉤的舊成就改成流程成就。
 * - first_ritual（第一次今晚儀式）→ streak_5（連續 5 個交易日）：同為每日流程
 * - streak_7（連續 7 天）→ streak_5；streak_30（連續 30 天）→ streak_20：連續天數取不超過原門檻的最近一級
 * - reviews_20（完成 20 筆檢討）→ reviews_10（完成 10 筆檢討）
 * - stops_10（守住停損 10 次；與虧損交易次數掛鉤）→ first_plan_stop（首次依計畫停損出場）
 * - checklists_10（完成 10 份檢查表；含建立持倉的次數）→ first_compliant（第一筆合規交易）：檢查表是合規的第一項
 * - backtest_own（回測過自己的條件）、first_backup（首次備份）→ first_compliant：新的 8 項沒有對應的單次行為，
 *   取「進場前流程」最接近的一項（這兩項行為仍各有經驗值）
 */
export const LEGACY_BADGE_MAP: Record<string, string> = {
  first_ritual: 'streak_5',
  streak_7: 'streak_5',
  streak_30: 'streak_20',
  reviews_20: 'reviews_10',
  stops_10: 'first_plan_stop',
  checklists_10: 'first_compliant',
  backtest_own: 'first_compliant',
  first_backup: 'first_compliant',
};

/** v4 成就門檻（凍結；只用來判斷遷移前已取得哪些） */
const V4_TARGETS: Record<string, [metric: string, target: number]> = {
  first_ritual: ['rituals', 1],
  streak_7: ['best_streak', 7],
  streak_30: ['best_streak', 30],
  reviews_20: ['reviews', 20],
  stops_10: ['stops_respected', 10],
  checklists_10: ['checklists', 10],
  backtest_own: ['backtests_own', 1],
  first_backup: ['backups', 1],
};

/**
 * 遷移前已取得的舊成就：只用遷移時間（含）之前的紀錄，依 v4 規則計算。
 * v4 的連續天數＝連續有 ritual_done 的交易日（交易日曆）。lastBackupAt：設定裡的上次備份時間（v4 也算備份）。
 */
export function legacyEarned(input: FlowInput, lastBackupAt?: string | null): string[] {
  const legacy = legacyOf(input.activities);
  if (!legacy) return [];
  const before = (a: Activity) => Date.parse(a.at) <= legacy.at && a.type !== 'legacy_xp';
  const acts = input.activities.filter(before);
  const count = (type: Activity['type']) => acts.filter((a) => a.type === type).length;
  const ritualDays = new Set(acts.filter((a) => a.type === 'ritual_done').map((a) => a.day));
  let best = 0;
  if (ritualDays.size) {
    const first = [...ritualDays].sort()[0];
    let run = 0;
    for (let d = input.cal.onOrAfter(first), i = 0; d <= legacy.day && i < 20000; d = nextTradingDay(d, input.cal), i++) {
      run = ritualDays.has(d) ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  const closedBefore = input.trades.filter((t) => t.status === 'closed' && Date.parse(t.closedRecordedAt ?? '') <= legacy.at);
  const metrics: Record<string, number> = {
    rituals: ritualDays.size,
    best_streak: best,
    reviews: closedBefore.filter((t) => hasReview(t) && (reviewedMs(t) ?? Infinity) <= legacy.at).length,
    stops_respected: closedBefore.filter((t) => stopRespected(t)).length,
    checklists: count('checklist_done'),
    backtests_own: count('backtest_own'),
    backups: Math.max(count('backup'), lastBackupAt && Date.parse(lastBackupAt) <= legacy.at ? 1 : 0),
  };
  return Object.entries(V4_TARGETS).filter(([, [m, target]]) => (metrics[m] ?? 0) >= target).map(([id]) => id);
}

/** 新成就的指標。best＝最佳連續（flowStreak().best）。 */
export function badgeMetrics(input: FlowInput, best: number, cfg: Gcfg = uiConfig.gamification): Record<string, number> {
  const closed = input.trades.filter((t) => t.status === 'closed');
  const ordered = [...input.trades].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  let run = 0, riskRun = 0;
  for (const t of ordered) {
    run = riskWithinLimit(t, input.riskLimit) ? run + 1 : 0;
    riskRun = Math.max(riskRun, run);
  }
  return {
    compliant: closed.filter((t) => tradeCompliance(t, input).status === 'compliant').length,
    best_streak: best,
    plan_stops: closed.filter((t) => planStop(t, cfg)).length,
    reviews: closed.filter(hasReview).length,
    risk_run: riskRun,
  };
}

export interface BadgeState extends BadgeConfig {
  value: number;
  earned: boolean;
  progress: number;
  /** 「3/5」；已取得時為「5/5」 */
  progressText: string;
  /** 由遷移前的舊成就保留（條件未達也算已取得） */
  retained: boolean;
  /** 對應過來的舊成就 id */
  retainedFrom: string[];
}

export function badges(metrics: Record<string, number>, legacy: string[] = [], cfg: Gcfg = uiConfig.gamification): BadgeState[] {
  return cfg.badges.map((b) => {
    const value = metrics[b.metric] ?? 0;
    const retainedFrom = legacy.filter((old) => LEGACY_BADGE_MAP[old] === b.id);
    const reached = value >= b.target;
    const earned = reached || retainedFrom.length > 0;
    return {
      ...b, value, earned,
      progress: earned ? 1 : Math.min(1, value / b.target),
      progressText: `${Math.min(earned ? b.target : value, b.target)}/${b.target}`,
      retained: !reached && retainedFrom.length > 0,
      retainedFrom,
    };
  });
}

/** 成就頁：新指標＋保留的舊成就 */
export function flowBadges(input: FlowInput, best: number, lastBackupAt?: string | null): BadgeState[] {
  const cfg = input.cfg ?? uiConfig.gamification;
  return badges(badgeMetrics(input, best, cfg), legacyEarned(input, lastBackupAt), cfg);
}
