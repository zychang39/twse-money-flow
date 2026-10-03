/**
 * 資料層遷移 v5（流程頁與遊戲化）：純函式，IndexedDB 升級（db.ts MIGRATIONS[5]）與舊備份匯入（backup.ts EXPORT_MIGRATIONS[5]）共用。
 *
 * 1. 既有經驗值與等級原樣保留：用 v4 的計分規則（下方 legacyXp，數值凍結、不再跟 config 變動）算出遷移當下的總額，
 *    寫成一筆 legacy_xp 紀錄（id 'legacy-xp'，at＝遷移時間，meta: { xp, level }）。之後只有發生在這個時間之後的行為
 *    依新規則累加，遷移前的行為不重算，所以畫面上的「60 / 100」不會因為新規則改變。
 * 2. 交易補上 v5 欄位（只補缺少的，既有值一律不動）：
 *    - createdAt：進場日 00:00（台北），不晚於遷移時間 → 舊持倉不再計進場經驗值（已含在既有經驗值內）
 *    - checklistDone：依已存的 7 題答案推得（checklistComplete）
 *    - plannedRisk：(進場價 − 停損價) × 股數；沒有有效停損時不補（＝違規「無停損」）
 *    - riskLimit：遷移當下設定的本金 × 每筆風險 %（舊交易沒有進場當時的設定，只能用目前設定）
 *    - reviewedAt：有檢討時，取該筆最早的 review_done 紀錄時間；沒有紀錄時用平倉日 12:00（台北）
 *    - closedRecordedAt：平倉日 12:00（台北），不晚於遷移時間 → 舊平倉不再計「依計畫出場」經驗值
 *    - exitReason：舊交易沒有出場原因，維持空值（未知；成就「首次依計畫停損出場」對舊交易改用停損價附近出場判斷）
 * 3. 不刪除任何資料；ritual_done、checklist_done、review_done 等舊紀錄全部保留。
 */
import type { Activity, Trade } from './db';
import { checklistComplete } from '../lib/checklist';
import { riskLimitOf, type PortfolioSettings } from '../lib/settings';
import { todayTpe } from '../lib/dates';

export const LEGACY_XP_ID = 'legacy-xp';

/** v4 的經驗值規則（凍結）：簡報 10／日、檢查表 20／日、檢討 30（每日 3 筆）、三環 20／日、回測 15／日、備份 20（7 天一次）。 */
const V4_XP: Record<string, number> = { brief_read: 10, checklist_done: 20, review_done: 30, ritual_done: 20, backup: 20, backtest_own: 15 };
const V4_CAP: Record<string, number> = { brief_read: 1, checklist_done: 1, review_done: 3, ritual_done: 1, backtest_own: 1 };

/** v4 的經驗值總額（與 v4 lib/ritual.totalXp 相同）。 */
export function legacyXp(activities: Activity[]): number {
  const counted = new Map<string, number>();
  let xp = 0;
  let lastBackup = -Infinity;
  for (const a of [...activities].sort((x, y) => x.at.localeCompare(y.at))) {
    if (!(a.type in V4_XP)) continue;
    if (a.type === 'backup') {
      const t = Date.parse(a.at);
      if (t - lastBackup < 7 * 86400000) continue;
      lastBackup = t;
      xp += V4_XP.backup;
      continue;
    }
    const key = `${a.type}:${a.day}`;
    const n = counted.get(key) ?? 0;
    if (n >= (V4_CAP[a.type] ?? 1)) continue;
    counted.set(key, n + 1);
    xp += V4_XP[a.type];
  }
  return xp;
}

/** v4 的等級：升到第 n 級需累積 100 × n(n−1)/2。 */
export function legacyLevel(xp: number): number {
  let n = 1;
  while ((100 * (n + 1) * n) / 2 <= xp) n++;
  return n;
}

const tpeNoon = (day: string) => new Date(`${day}T12:00:00+08:00`).toISOString();
const tpeMidnight = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();
const notAfter = (iso: string, cutoff: string) => (Date.parse(iso) > Date.parse(cutoff) ? cutoff : iso);
const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));

/** 補上 v5 欄位（只補缺少的）。 */
export function migrateTradeV5(t: Trade, activity: Activity[], limit: number, cutoff: string): Trade {
  const out: Trade = { ...t };
  const opened = validDay(t.openedAt) ? t.openedAt.slice(0, 10) : todayTpe(new Date(cutoff));
  if (out.createdAt === undefined) out.createdAt = notAfter(tpeMidnight(opened), cutoff);
  if (out.checklistDone === undefined) out.checklistDone = checklistComplete(t);
  if (out.plannedRisk === undefined && Number.isFinite(t.stop) && t.stop > 0 && t.stop < t.entry && t.shares > 0) out.plannedRisk = (t.entry - t.stop) * t.shares;
  if (out.riskLimit === undefined) out.riskLimit = limit;
  const closedDay = validDay(t.closedAt) ? t.closedAt.slice(0, 10) : opened;
  if (out.reviewedAt === undefined && t.review && t.review.trim()) {
    const logged = activity.filter((a) => a.type === 'review_done' && a.meta?.trade === t.id).map((a) => a.at).sort()[0];
    out.reviewedAt = notAfter(logged ?? tpeNoon(closedDay), cutoff);
  }
  if (out.closedRecordedAt === undefined && t.status === 'closed') out.closedRecordedAt = notAfter(tpeNoon(closedDay), cutoff);
  return out;
}

export interface V5Input { trades: Trade[]; activity: Activity[]; portfolio?: Partial<PortfolioSettings> | null }

/**
 * v4 → v5。cutoff＝遷移時間（IndexedDB 升級＝現在；舊備份匯入＝備份的匯出時間）。
 * 回傳補完欄位的交易與要新增的 activity（只有 legacy_xp 一筆；已存在或完全沒有使用紀錄時不新增）。
 */
export function migrateV5(input: V5Input, cutoff: string): { trades: Trade[]; addedActivity: Activity[] } {
  const limit = riskLimitOf(input.portfolio);
  const trades = input.trades.map((t) => migrateTradeV5(t, input.activity, limit, cutoff));
  const addedActivity: Activity[] = [];
  const used = input.activity.length > 0 || input.trades.length > 0;
  if (used && !input.activity.some((a) => a.type === 'legacy_xp')) {
    const xp = legacyXp(input.activity);
    addedActivity.push({ id: LEGACY_XP_ID, type: 'legacy_xp', day: todayTpe(new Date(cutoff)), at: cutoff, meta: { xp, level: legacyLevel(xp), from: 'v4' } });
  }
  return { trades, addedActivity };
}
