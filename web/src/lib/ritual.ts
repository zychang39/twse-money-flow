/**
 * 每晚儀式與遊戲化（只獎勵紀律，不獎勵交易）：三環、連續天數（休市日不中斷）、經驗值與等級、成就徽章。
 * 全部是純函式；資料來源為 IndexedDB 的 activity 與 trades。
 */
import type { Activity, ActivityType, Trade } from '../db/db';
import { uiConfig, type BadgeConfig } from './config';
import { addDays } from './dates';
import { md } from './format';

type Gcfg = typeof uiConfig.gamification;

export interface RingState {
  id: 'brief' | 'checklist' | 'review';
  label: string;
  progress: number;
  done: boolean;
  status: string;
  action?: { href: string; label: string };
}

export function hasReview(t: Trade): boolean {
  return !!t.review && t.review.trim().length > 0;
}

/** 三環：看完今晚簡報、新持倉都完成新增持倉前檢查表、平倉後完成檢討。day＝該晚對應的資料日期。 */
export function ritualRings(day: string, activities: Activity[], trades: Trade[], today: string, cfg: Gcfg = uiConfig.gamification): { rings: RingState[]; complete: boolean } {
  const brief = activities.some((a) => a.type === 'brief_read' && a.day === day);
  const newPositions = trades.filter((t) => t.openedAt >= day);
  const checked = newPositions.filter((t) => t.checklist && t.checklist.reason && t.checklist.reason.trim());
  const since = addDays(today, -cfg.review_window_days);
  const closed = trades.filter((t) => t.status === 'closed' && (t.closedAt ?? '') >= since);
  const reviewed = closed.filter(hasReview);
  const pending = closed.filter((t) => !hasReview(t)).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
  const rings: RingState[] = [
    {
      id: 'brief', label: '看完今晚簡報', progress: brief ? 1 : 0, done: brief,
      status: brief ? '已完成' : '捲到底即完成',
    },
    {
      id: 'checklist', label: '新持倉檢查表', progress: newPositions.length ? checked.length / newPositions.length : 1,
      done: checked.length === newPositions.length,
      status: newPositions.length ? `${checked.length} / ${newPositions.length}` : '今天沒有新持倉',
    },
    {
      id: 'review', label: '平倉後檢討', progress: closed.length ? reviewed.length / closed.length : 1,
      done: pending.length === 0,
      status: closed.length ? `${reviewed.length} / ${closed.length}` : '沒有待檢討',
      action: pending.length ? { href: `#/discipline/journal?review=${pending[0].id}`, label: `寫下${pending[0].name}的平倉檢討` } : undefined,
    },
  ];
  return { rings, complete: rings.every((r) => r.done) };
}

/**
 * 「我該記錄或檢討什麼？」的答案（今晚頁第四區塊、紀律頁標題；2026-10-02 健檢 M1-2）。
 * - 交易日：「今晚的紀律已完成」／「今晚的紀律：還差 N 項」
 * - 休市日：「今天休市，不計入連續天數；上一交易日 10/2 的紀律：已完成 X／3」，絕不寫「還差」。
 *   rings 是依資料日（＝上一交易日）計算的，所以 X 就是該日完成的環數。
 */
export function ritualAnswer(ritual: { rings: Pick<RingState, 'done'>[]; complete: boolean }, isTradingDay: boolean, lastTradingDate: string | null): string {
  const done = ritual.rings.filter((r) => r.done).length;
  const total = ritual.rings.length;
  if (!isTradingDay) {
    const when = lastTradingDate ? `上一交易日 ${md(lastTradingDate)} ` : '上一交易日';
    return `今天休市，不計入連續天數；${when}的紀律：已完成 ${done}／${total}`;
  }
  if (ritual.complete) return '今晚的紀律已完成';
  return `今晚的紀律：還差 ${total - done} 項`;
}

/** 連續天數：只看交易日（休市日不在清單中，所以不會中斷）。今天尚未完成時，連續天數算到上一個交易日。 */
export function streaks(tradingDays: string[], activities: Activity[]): { current: number; best: number } {
  const done = new Set(activities.filter((a) => a.type === 'ritual_done').map((a) => a.day));
  const days = [...tradingDays].sort();
  let best = 0, run = 0;
  for (const d of days) {
    run = done.has(d) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && !done.has(days[i])) i--;
  for (; i >= 0 && done.has(days[i]); i--) current++;
  return { current, best };
}

/** 經驗值：依 config 計分並套用每日上限。 */
export function totalXp(activities: Activity[], cfg: Gcfg = uiConfig.gamification): number {
  const perDayCap: Partial<Record<ActivityType, number>> = { brief_read: 1, checklist_done: 1, review_done: 3, ritual_done: 1, backtest_own: 1 };
  const counted = new Map<string, number>();
  let xp = 0;
  let lastBackup = -Infinity;
  for (const a of [...activities].sort((x, y) => x.at.localeCompare(y.at))) {
    if (a.type === 'backup') {
      const t = Date.parse(a.at);
      if (t - lastBackup < 7 * 86400000) continue;
      lastBackup = t;
      xp += cfg.xp.backup;
      continue;
    }
    const key = `${a.type}:${a.day}`;
    const n = counted.get(key) ?? 0;
    if (n >= (perDayCap[a.type] ?? 1)) continue;
    counted.set(key, n + 1);
    xp += cfg.xp[a.type];
  }
  return xp;
}

/** 等級：升到第 n 級需累積 step × n(n−1)/2。 */
export function levelFor(xp: number, step = uiConfig.gamification.level_step): { level: number; floor: number; next: number; progress: number } {
  let n = 1;
  while (step * ((n + 1) * n) / 2 <= xp) n++;
  const floor = (step * n * (n - 1)) / 2;
  const next = (step * (n + 1) * n) / 2;
  return { level: n, floor, next, progress: (xp - floor) / (next - floor) };
}

/** 守住停損：虧損出場，且出場價不低於停損價過多（容忍度見 config）。 */
export function stopRespected(t: Trade, tolPct = uiConfig.gamification.stop_respected_tolerance_pct): boolean {
  // D-01：平倉價是平倉當時的價格基準；進場價、停損依 adjFactor（持有期間的分割、除權息）換算
  const f = t.adjFactor ?? 1;
  const entry = t.entry * f, stop = t.stop * f;
  if (t.status !== 'closed' || t.exit === undefined || t.exit >= entry) return false;
  if (t.errorTags?.includes('未守停損')) return false;
  return t.exit <= stop * (1 + tolPct / 100) && t.exit >= stop * (1 - 2 * tolPct / 100);
}

export interface BadgeState extends BadgeConfig { value: number; earned: boolean; progress: number }

export function badgeMetrics(activities: Activity[], trades: Trade[], best: number, hadBackup: boolean): Record<string, number> {
  const count = (t: ActivityType) => activities.filter((a) => a.type === t).length;
  return {
    rituals: new Set(activities.filter((a) => a.type === 'ritual_done').map((a) => a.day)).size,
    best_streak: best,
    reviews: trades.filter((t) => t.status === 'closed' && hasReview(t)).length,
    stops_respected: trades.filter((t) => stopRespected(t)).length,
    // U-11：只計實際完成的檢查表（建立持倉或決定不進場都算）；匯入或補登的交易不推進徽章
    checklists: count('checklist_done'),
    backtests_own: count('backtest_own'),
    backups: Math.max(count('backup'), hadBackup ? 1 : 0),
  };
}

export function badges(metrics: Record<string, number>, cfg: Gcfg = uiConfig.gamification): BadgeState[] {
  return cfg.badges.map((b) => {
    const value = metrics[b.metric] ?? 0;
    return { ...b, value, earned: value >= b.target, progress: Math.min(1, value / b.target) };
  });
}
