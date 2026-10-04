/**
 * 流程與遊戲化（原「紀律」）：每日三環、連續與寬限日、合規交易與違規標籤、經驗值、等級。全部是純函式。
 * 原則：只獎勵流程，不獎勵損益、交易次數、開啟次數；沒有任何扣分；不催促。
 *
 * 時間口徑：
 * - 「流程日」一律是交易日（交易日曆＝meta.json 的 calendar，見 tradingCalendar.ts）。休市日的行為歸到上一交易日（ritualDayOf）。
 * - 交易日 D 的期限＝下一交易日 09:00（台北）。期限前完成的行為才算 D 的流程；期限過後 D 才「結算」（寬限日、未完成）。
 * - 平倉後 3 個交易日內檢討：平倉日（流程日）之後第 3 個交易日的期限前寫下檢討。
 */
import type { Activity, ExitReason, Trade } from '../db/db';
import { uiConfig } from './config';
import { addDays, todayTpe } from './dates';
import { md } from './format';
import { checklistComplete } from './checklist';
import { tradePnl } from './sizing';
import { makeCalendar, type TradingCalendar } from './tradingCalendar';
import { DEFAULT_PORTFOLIO, riskLimitOf } from './settings';

type Gcfg = typeof uiConfig.gamification;
const EPS = 1e-6;

export interface FlowInput {
  cal: TradingCalendar;
  activities: Activity[];
  trades: Trade[];
  /** 目前設定的每筆風險上限（本金 × 每筆風險 %）；交易沒有 riskLimit 快照時使用 */
  riskLimit: number;
  /** 現在時間（ISO）：判斷期限、逾期檢討 */
  now: string;
  cfg?: Gcfg;
  /** 自選股檔數（步驟 3「看自選異動」：沒有自選股＝不適用）；未提供＝視為有自選 */
  watchCount?: number;
}

// ------------------------------------------------------------------ 日期工具
/** ISO 時間 → 台北日期 */
export function tpeDate(iso: string): string {
  return todayTpe(new Date(iso));
}
/** 日期所屬的流程日：交易日＝當天；休市日＝上一交易日 */
export function ritualDayOf(date: string, cal: TradingCalendar): string {
  return cal.isTradingDay(date) ? date : cal.previous(date);
}
export function nextTradingDay(day: string, cal: TradingCalendar): string {
  return cal.onOrAfter(addDays(day, 1));
}
export function addTradingDays(day: string, n: number, cal: TradingCalendar): string {
  let d = day;
  for (let i = 0; i < n; i++) d = nextTradingDay(d, cal);
  return d;
}
/** 交易日 D 的期限（毫秒）：下一交易日 09:00（台北） */
export function dayDeadline(day: string, cal: TradingCalendar, cfg: Gcfg = uiConfig.gamification): number {
  return Date.parse(`${nextTradingDay(day, cal)}T00:00:00+08:00`) + cfg.deadline_hour * 3600_000;
}
/** 該日所在週的週一 */
export function weekOf(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}
const tpeNoonMs = (day: string) => Date.parse(`${day}T12:00:00+08:00`);
const msOf = (iso: string | undefined, fallback: number): number => {
  const v = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(v) ? v : fallback;
};

// ------------------------------------------------------------------ 交易：檢查表、停損、計畫風險、檢討
export function hasReview(t: Trade): boolean {
  return !!t.review && t.review.trim().length > 0;
}
/** 有效停損：0 < 停損 < 進場價 */
export function hasStop(t: Pick<Trade, 'stop' | 'entry'>): boolean {
  return Number.isFinite(t.stop) && t.stop > 0 && t.stop < t.entry;
}
/** 計畫風險金額＝(進場價 − 停損價) × 股數；沒有有效停損時為 null */
export function plannedRiskOf(t: Trade): number | null {
  if (t.plannedRisk !== undefined && t.plannedRisk !== null && t.plannedRisk > 0) return t.plannedRisk;
  return hasStop(t) && t.shares > 0 ? (t.entry - t.stop) * t.shares : null;
}
export function tradeRiskLimit(t: Trade, fallback: number): number {
  return t.riskLimit !== undefined && t.riskLimit > 0 ? t.riskLimit : fallback;
}
/** 檢查表完成（違規「未檢查」用）：第 6 題停損另記「無停損」，這裡不重複計入 */
export function isChecklistDone(t: Trade): boolean {
  return t.checklistDone === true || checklistComplete(t, { skipStop: true });
}
/** 有停損且計畫風險 ≤ 上限 */
export function riskWithinLimit(t: Trade, fallbackLimit: number): boolean {
  const r = plannedRiskOf(t);
  return r !== null && r <= tradeRiskLimit(t, fallbackLimit) + EPS;
}
/** 第一次寫下檢討的時間（毫秒）；沒有檢討為 null。舊資料沒有 reviewedAt 時視為平倉日 12:00（台北） */
export function reviewedMs(t: Trade): number | null {
  if (!hasReview(t)) return null;
  return msOf(t.reviewedAt, t.closedAt ? tpeNoonMs(t.closedAt.slice(0, 10)) : NaN) || null;
}
/** 平倉的流程日 */
export function closeDayOf(t: Trade, cal: TradingCalendar): string | null {
  return t.status === 'closed' && t.closedAt ? ritualDayOf(t.closedAt.slice(0, 10), cal) : null;
}
/** 檢討到期的交易日：平倉流程日之後第 3 個交易日 */
export function reviewDueDay(t: Trade, cal: TradingCalendar, cfg: Gcfg = uiConfig.gamification): string | null {
  const c = closeDayOf(t, cal);
  return c ? addTradingDays(c, cfg.review_due_trading_days, cal) : null;
}
/** 平倉後 3 個交易日內完成檢討 */
export function reviewOnTime(t: Trade, cal: TradingCalendar, cfg: Gcfg = uiConfig.gamification): boolean {
  const due = reviewDueDay(t, cal, cfg);
  const rv = reviewedMs(t);
  return due !== null && rv !== null && rv < dayDeadline(due, cal, cfg);
}
/** 虧損出場時實際虧損（含費用）≤ 計畫風險 × 1.2；獲利或打平＝true；未平倉或沒有計畫風險（無法比較）＝null */
export function lossWithinPlan(t: Trade, cfg: Gcfg = uiConfig.gamification): boolean | null {
  if (t.status !== 'closed' || t.exit === undefined) return null;
  const pnl = tradePnl(t);
  if (pnl >= 0) return true;
  const plan = plannedRiskOf(t);
  if (plan === null) return null;
  return -pnl <= plan * cfg.loss_tolerance + EPS;
}

export const PLAN_EXITS: ExitReason[] = ['stop', 'time_stop', 'rule'];
export const EXIT_REASON_LABEL: Record<ExitReason, string> = { stop: '停損', time_stop: '時間停損', rule: '規則出場（含目標價）', other: '其他' };

/** 依計畫出場：出場原因為停損、時間停損或規則出場，且虧損時實際虧損 ≤ 計畫風險 × 1.2 */
export function planExit(t: Trade, cfg: Gcfg = uiConfig.gamification): boolean {
  return t.status === 'closed' && !!t.exitReason && PLAN_EXITS.includes(t.exitReason) && lossWithinPlan(t, cfg) === true;
}

/** 守住停損（舊規則；只用於沒有出場原因的舊交易）：虧損出場，且出場價在停損價附近。 */
export function stopRespected(t: Trade, tolPct = uiConfig.gamification.stop_respected_tolerance_pct): boolean {
  // D-01：平倉價是平倉當時的價格基準；進場價、停損依 adjFactor（持有期間的分割、除權息）換算
  const f = t.adjFactor ?? 1;
  const entry = t.entry * f, stop = t.stop * f;
  if (t.status !== 'closed' || t.exit === undefined || t.exit >= entry) return false;
  if (t.errorTags?.includes('未守停損')) return false;
  return t.exit <= stop * (1 + tolPct / 100) && t.exit >= stop * (1 - 2 * tolPct / 100);
}
/** 依計畫停損出場（成就 5）：出場原因＝停損且虧損在計畫內；舊交易（沒有出場原因）退回「守住停損」判斷 */
export function planStop(t: Trade, cfg: Gcfg = uiConfig.gamification): boolean {
  if (t.exitReason) return t.exitReason === 'stop' && planExit(t, cfg);
  return stopRespected(t, cfg.stop_respected_tolerance_pct);
}

// ------------------------------------------------------------------ 合規交易（§8.4）與違規標籤
export type ViolationTag = '未檢查' | '無停損' | '超過風險上限' | '虧損超出計畫' | '逾期檢討';
export const VIOLATION_TAGS: ViolationTag[] = ['未檢查', '無停損', '超過風險上限', '虧損超出計畫', '逾期檢討'];

/** 進場時就能判定的違規：未檢查、無停損、超過風險上限（無停損時風險無法計算，只記「無停損」） */
export function entryViolations(t: Trade, fallbackLimit: number): ViolationTag[] {
  const tags: ViolationTag[] = [];
  if (!isChecklistDone(t)) tags.push('未檢查');
  if (!hasStop(t)) tags.push('無停損');
  else if (!riskWithinLimit(t, fallbackLimit)) tags.push('超過風險上限');
  return tags;
}

export interface Compliance {
  /** compliant＝五項全過（已平倉且已檢討）；violation＝至少一項違規；pending＝尚未違規但還沒結束（持有中、檢討期限內） */
  status: 'compliant' | 'violation' | 'pending';
  tags: ViolationTag[];
}

export function tradeCompliance(t: Trade, input: Pick<FlowInput, 'cal' | 'riskLimit' | 'now' | 'cfg'>): Compliance {
  const cfg = input.cfg ?? uiConfig.gamification;
  const tags = entryViolations(t, input.riskLimit);
  if (t.status !== 'closed') return { status: tags.length ? 'violation' : 'pending', tags };
  if (lossWithinPlan(t, cfg) === false) tags.push('虧損超出計畫');
  const due = reviewDueDay(t, input.cal, cfg);
  const deadline = due ? dayDeadline(due, input.cal, cfg) : Infinity;
  const rv = reviewedMs(t);
  if (rv !== null ? rv >= deadline : Date.parse(input.now) >= deadline) tags.push('逾期檢討');
  if (tags.length) return { status: 'violation', tags };
  return { status: rv !== null ? 'compliant' : 'pending', tags };
}

/** 違規標籤發生的日期（週報統計用）：進場類＝進場日、虧損超出計畫＝平倉日、逾期檢討＝檢討到期日 */
export function violationEvents(t: Trade, input: Pick<FlowInput, 'cal' | 'riskLimit' | 'now' | 'cfg'>): { tag: ViolationTag; day: string }[] {
  const c = tradeCompliance(t, input);
  const opened = ritualDayOf(t.openedAt.slice(0, 10), input.cal);
  return c.tags.map((tag) => ({
    tag,
    day: tag === '虧損超出計畫' ? closeDayOf(t, input.cal) ?? opened : tag === '逾期檢討' ? reviewDueDay(t, input.cal, input.cfg) ?? opened : opened,
  }));
}

// ------------------------------------------------------------------ 遷移紀錄（既有經驗值）
export interface LegacyInfo { at: number; day: string; xp: number; level: number }
export function legacyOf(activities: Activity[]): LegacyInfo | null {
  const a = activities.find((x) => x.type === 'legacy_xp');
  if (!a) return null;
  return { at: msOf(a.at, 0), day: a.day, xp: Number(a.meta?.xp ?? 0) || 0, level: Number(a.meta?.level ?? 1) || 1 };
}

// ------------------------------------------------------------------ 索引（多日計算共用）
interface ClosedRef { t: Trade; closeDay: string; due: string; reviewed: number | null }
interface FlowIndex {
  brief: Map<string, number>;
  opened: Map<string, Trade[]>;
  closed: ClosedRef[];
  legacy: LegacyInfo | null;
  legacyDone: Set<string>;
  start: string | null;
  /** 每個流程日的行為（M6 步驟用） */
  acts: Map<string, Activity[]>;
  /** 第一次出現步驟行為（看大盤／看持倉／看自選異動）的流程日：之前的交易日沿用三環規則（既有連續與經驗值不變） */
  stepsSince: string | null;
}
const indexCache = new WeakMap<FlowInput, FlowIndex>();

function buildIndex(input: FlowInput): FlowIndex {
  const hit = indexCache.get(input);
  if (hit) return hit;
  const { cal } = input;
  const cfg = input.cfg ?? uiConfig.gamification;
  const brief = new Map<string, number>();
  for (const a of input.activities) {
    if (a.type !== 'brief_read') continue;
    const t = msOf(a.at, Infinity);
    if (t < (brief.get(a.day) ?? Infinity)) brief.set(a.day, t);
  }
  const opened = new Map<string, Trade[]>();
  for (const t of input.trades) {
    const d = ritualDayOf(t.openedAt.slice(0, 10), cal);
    opened.set(d, [...(opened.get(d) ?? []), t]);
  }
  const closed: ClosedRef[] = [];
  for (const t of input.trades) {
    const closeDay = closeDayOf(t, cal);
    if (!closeDay) continue;
    closed.push({ t, closeDay, due: addTradingDays(closeDay, cfg.review_due_trading_days, cal), reviewed: reviewedMs(t) });
  }
  const legacy = legacyOf(input.activities);
  const legacyDone = new Set(legacy ? input.activities.filter((a) => a.type === 'ritual_done' && a.day <= legacy.day).map((a) => a.day) : []);
  const days = [
    ...input.activities.filter((a) => a.type !== 'legacy_xp').map((a) => ritualDayOf(a.day, cal)),
    ...input.trades.map((t) => ritualDayOf(t.openedAt.slice(0, 10), cal)),
  ].sort();
  const acts = new Map<string, Activity[]>();
  let stepsSince: string | null = null;
  for (const a of input.activities) {
    const d = ritualDayOf(a.day, cal);
    acts.set(d, [...(acts.get(d) ?? []), a]);
    if ((STEP_ACTS as string[]).includes(a.type) && (stepsSince === null || d < stepsSince)) stepsSince = d;
  }
  const idx: FlowIndex = { brief, opened, closed, legacy, legacyDone, start: days[0] ?? null, acts, stepsSince };
  indexCache.set(input, idx);
  return idx;
}

// ------------------------------------------------------------------ 每日三環（§8.2）
export type RingId = 'brief' | 'entry' | 'review';
export type RingStatus = 'done' | 'todo' | 'na';
export const RING_LABEL: Record<RingId, string> = { brief: '簡報', entry: '進場', review: '檢討' };
export const RING_STATUS_TEXT: Record<RingStatus, string> = { done: '已完成', todo: '未完成', na: '不適用' };

export interface Ring {
  id: RingId;
  label: string;
  status: RingStatus;
  /** 0–1；不適用＝0（畫細底環加「—」） */
  progress: number;
  /** 已完成／未完成／不適用 */
  text: string;
  /** 補充（例：「1/2 筆符合」「待檢討 1 筆」）；只放事實，不催促 */
  detail?: string;
  action?: { href: string; label: string };
}

export interface DayRings {
  day: string;
  rings: Ring[];
  done: number;
  applicable: number;
  /** 所有適用的環都完成 */
  complete: boolean;
  /** 「1/1」「2/3」 */
  score: string;
}

function ring(id: RingId, status: RingStatus, progress: number, detail?: string, action?: Ring['action']): Ring {
  return { id, label: RING_LABEL[id], status, progress: status === 'na' ? 0 : Math.max(0, Math.min(1, progress)), text: RING_STATUS_TEXT[status], ...(detail ? { detail } : {}), ...(action ? { action } : {}) };
}

/** 交易日 day 的三環。day 應為交易日（休市日請先用 ritualDayOf 換成上一交易日）。 */
export function dayRings(day: string, input: FlowInput): DayRings {
  const idx = buildIndex(input);
  const cfg = input.cfg ?? uiConfig.gamification;
  const deadline = dayDeadline(day, input.cal, cfg);
  // 簡報環：當日盤後簡報已讀（捲到底），且在下一交易日 09:00 前
  const read = (idx.brief.get(day) ?? Infinity) < deadline;
  const brief = ring('brief', read ? 'done' : 'todo', read ? 1 : 0);
  // 進場環：當日新增的每一筆持倉都完成檢查表、有停損、計畫風險 ≤ 上限；無新持倉＝不適用
  const news = idx.opened.get(day) ?? [];
  const okEntries = news.filter((t) => entryViolations(t, input.riskLimit).length === 0);
  const firstBad = news.find((t) => entryViolations(t, input.riskLimit).length > 0);
  const entry = news.length
    ? ring('entry', okEntries.length === news.length ? 'done' : 'todo', okEntries.length / news.length, `${okEntries.length}/${news.length} 筆符合`,
      firstBad ? { href: `#/discipline/journal?trade=${encodeURIComponent(firstBad.id)}`, label: `${firstBad.name}：${entryViolations(firstBad, input.riskLimit).join('、')}` } : undefined)
    : ring('entry', 'na', 0);
  // 檢討環：沒有逾期未檢討的部位，且當日到期的檢討已完成；近 3 個交易日無平倉且無逾期＝不適用
  const reviewedBy = (c: ClosedRef) => c.reviewed !== null && c.reviewed < deadline;
  const relevant = idx.closed.filter((c) => c.closeDay <= day);
  const overdue = relevant.filter((c) => c.due < day && !reviewedBy(c));
  const dueToday = relevant.filter((c) => c.due === day);
  const recent = relevant.filter((c) => c.due >= day);
  let review: Ring;
  if (!overdue.length && !recent.length) review = ring('review', 'na', 0);
  else {
    const need = [...overdue, ...dueToday];
    const ok = overdue.length === 0 && dueToday.every(reviewedBy);
    const pending = [...overdue, ...recent.filter((c) => !reviewedBy(c))].sort((a, b) => a.due.localeCompare(b.due))[0];
    review = ring('review', ok ? 'done' : 'todo', ok ? 1 : need.filter(reviewedBy).length / need.length,
      pending ? `待檢討 ${overdue.length + recent.filter((c) => !reviewedBy(c)).length} 筆` : undefined,
      pending ? { href: `#/discipline/journal?review=${encodeURIComponent(pending.t.id)}`, label: `${pending.t.name}的平倉檢討` } : undefined);
  }
  const rings = [brief, entry, review];
  const applicable = rings.filter((r) => r.status !== 'na').length;
  const done = rings.filter((r) => r.status === 'done').length;
  return { day, rings, done, applicable, complete: done === applicable, score: `${done}/${applicable}` };
}

// ------------------------------------------------------------------ 每日步驟（M6，2026-10）
/** 步驟行為：出現後（含當日）改用步驟規則判定完成 */
export const STEP_ACTS: Activity['type'][] = ['market_viewed', 'holdings_viewed', 'movers_viewed'];
export type StepId = 'market' | 'holdings' | 'movers' | 'screener' | 'entry' | 'review';
export type StepStatus = 'done' | 'todo' | 'na';
/** 當日完成要看的步驟（4 看新觸發是選做） */
export const REQUIRED_STEPS: StepId[] = ['market', 'holdings', 'movers', 'entry', 'review'];
export const STEP_DEF: Record<StepId, { n: number; title: string; what: string; href: string; optional?: boolean }> = {
  market: { n: 1, title: '看大盤', what: '簡報的市場分段：指數、環境燈號、寬度', href: '#/?seg=market' },
  holdings: { n: 2, title: '看持倉', what: '持股清單：損益、停損距離、警示', href: '#/mine?seg=hold' },
  movers: { n: 3, title: '看自選異動', what: '自選異動清單的每一檔都打開看過', href: '#/mine?seg=watch' },
  screener: { n: 4, title: '看新觸發', what: '選股頁的今日新觸發（選做）', href: '#/explore/screener', optional: true },
  entry: { n: 5, title: '進場前檢查', what: '每筆新持倉：檢查表、停損價、計畫風險 ≤ 上限', href: '#/discipline/checklist' },
  review: { n: 6, title: '平倉後檢討', what: '平倉後 3 個交易日內寫下檢討', href: '#/discipline/journal' },
};

export interface Step {
  id: StepId; n: number; title: string; what: string; href: string; optional: boolean;
  status: StepStatus;
  /** 不適用的原因、或進度（例：「已開 2／3 檔」） */
  note?: string;
  /** 完成的時間（毫秒）；經驗值的時間點 */
  at?: number;
  action?: { href: string; label: string };
}
export interface DaySteps {
  day: string;
  steps: Step[];
  done: number;
  applicable: number;
  complete: boolean;
  /** 「3/5」（必要步驟中適用者） */
  score: string;
  /** 步驟行為出現之前的交易日：完成沿用三環規則 */
  legacy: boolean;
}

function step(id: StepId, status: StepStatus, note?: string, at?: number, action?: Step['action']): Step {
  const d = STEP_DEF[id];
  return { id, n: d.n, title: d.title, what: d.what, href: d.href, optional: !!d.optional, status, ...(note ? { note } : {}), ...(at !== undefined ? { at } : {}), ...(action ? { action } : {}) };
}

/** 交易日 day 的六個步驟。day 應為交易日（休市日請先用 ritualDayOf 換成上一交易日）。 */
export function daySteps(day: string, input: FlowInput): DaySteps {
  const idx = buildIndex(input);
  const cfg = input.cfg ?? uiConfig.gamification;
  const deadline = dayDeadline(day, input.cal, cfg);
  const acts = (idx.acts.get(day) ?? []).filter((a) => msOf(a.at, Infinity) < deadline);
  const first = (type: Activity['type']) => acts.filter((a) => a.type === type).reduce<number | undefined>((m, a) => Math.min(m ?? Infinity, msOf(a.at, Infinity)), undefined);
  const rings = dayRings(day, input);
  const ringOf = (id: RingId) => rings.rings.find((r) => r.id === id) as Ring;
  // 1 看大盤：簡報的市場分段看過（舊紀錄：簡報讀完）
  const mAt = [first('market_viewed'), idx.brief.get(day)].filter((x): x is number => x !== undefined && x < deadline);
  const market = mAt.length ? step('market', 'done', undefined, Math.min(...mAt)) : step('market', 'todo');
  // 2 看持倉：當日有持倉才適用
  const held = input.trades.some((t) => ritualDayOf(t.openedAt.slice(0, 10), input.cal) <= day && (t.status === 'open' || (closeDayOf(t, input.cal) ?? '') >= day));
  const hAt = first('holdings_viewed');
  const holdings = !held ? step('holdings', 'na', '沒有持倉') : hAt !== undefined ? step('holdings', 'done', undefined, hAt) : step('holdings', 'todo');
  // 3 看自選異動：清單上（最後一次開清單時）的每一檔都開過；沒有異動＝開過清單即可；沒有自選＝不適用
  let movers: Step;
  if (input.watchCount === 0) movers = step('movers', 'na', '沒有自選股');
  else {
    const views = acts.filter((a) => a.type === 'movers_viewed').sort((a, b) => msOf(a.at, 0) - msOf(b.at, 0));
    const last = views[views.length - 1];
    if (!last) movers = step('movers', 'todo');
    else {
      const codes = String(last.meta?.codes ?? '').split(',').filter(Boolean);
      const opened = new Map<string, number>();
      for (const a of acts) if (a.type === 'stock_viewed' && a.meta?.code) opened.set(String(a.meta.code), Math.min(opened.get(String(a.meta.code)) ?? Infinity, msOf(a.at, Infinity)));
      const seen = codes.filter((c) => opened.has(c));
      const at = Math.max(msOf(views[0].at, 0), ...seen.map((c) => opened.get(c) as number));
      movers = seen.length === codes.length ? step('movers', 'done', codes.length ? `${codes.length} 檔都看過` : '今日沒有異動', at)
        : step('movers', 'todo', `已開 ${seen.length}／${codes.length} 檔`, undefined, { href: `#/stock/${codes.find((c) => !opened.has(c))}`, label: '下一檔異動' });
    }
  }
  // 4 看新觸發（選做）
  const sAt = first('screener_viewed');
  const screener = sAt !== undefined ? step('screener', 'done', undefined, sAt) : step('screener', 'todo', '選做');
  // 5、6 沿用三環的進場與檢討
  const e = ringOf('entry'), r = ringOf('review');
  const entry = step('entry', e.status, e.status === 'na' ? '沒有新持倉' : e.detail, undefined, e.action);
  const review = step('review', r.status, r.status === 'na' ? '沒有待檢討的平倉' : r.detail, undefined, r.action);
  const steps = [market, holdings, movers, screener, entry, review];
  const req = steps.filter((x) => REQUIRED_STEPS.includes(x.id) && x.status !== 'na');
  const done = req.filter((x) => x.status === 'done').length;
  const legacy = idx.stepsSince === null || day < idx.stepsSince;
  const complete = legacy ? rings.complete : done === req.length;
  return { day, steps, done, applicable: req.length, complete, score: `${done}/${req.length}`, legacy };
}

/** 步驟 1–3 適用者全部完成的時間（經驗值用）；未完成＝null */
export function steps123At(s: DaySteps): number | null {
  const xs = s.steps.filter((x) => (x.id === 'market' || x.id === 'holdings' || x.id === 'movers') && x.status !== 'na');
  if (!xs.length || xs.some((x) => x.status !== 'done')) return null;
  return Math.max(...xs.map((x) => x.at ?? 0));
}

/** 流程頁要顯示的交易日：今天是交易日＝今天；休市日＝上一交易日（並標日期） */
export function displayDay(cal: TradingCalendar, now: string): { day: string; isTradingDay: boolean } {
  const today = tpeDate(now);
  const isTradingDay = cal.isTradingDay(today);
  return { day: isTradingDay ? today : cal.previous(today), isTradingDay };
}

// ------------------------------------------------------------------ 連續與寬限日（§8.3）
/** done＝完成；grace＝寬限（空心）；missed＝未完成；open＝期限未到（未完成但不中斷、不套寬限）；na＝開始使用之前 */
export type DotState = 'done' | 'grace' | 'missed' | 'open' | 'na';
export interface DayDot { day: string; state: DotState; score: string }
export interface StreakInfo {
  current: number;
  best: number;
  /** 顯示日所在日曆月剩下的寬限日 */
  graceLeft: number;
  /** 近 N 個交易日（舊 → 新），N＝history_days */
  days: DayDot[];
  /** 顯示日（今天或上一交易日） */
  day: string;
  isTradingDay: boolean;
  /** 「連續 n 日・最佳 m 日・本月寬限剩 k」 */
  text: string;
}

/**
 * 從開始使用的第一個交易日逐日結算到顯示日：
 * - 完成：連續 +1；期限未到：不變；未完成且連續中、本月寬限未用完：自動套用寬限（不中斷、不加日數）；否則歸零。
 * - 寬限日每個日曆月 2 個、不累積；連續為 0 時不套用（沒有可保護的連續）。
 * - 遷移前的交易日：有 v4 的 ritual_done 紀錄也算完成（既有連續不因新規則中斷）。
 */
export function flowStreak(input: FlowInput): StreakInfo {
  const cfg = input.cfg ?? uiConfig.gamification;
  const idx = buildIndex(input);
  const { day: ref, isTradingDay } = displayDay(input.cal, input.now);
  const nowMs = Date.parse(input.now);
  const states = new Map<string, DayDot>();
  let run = 0, best = 0;
  const graceUsed = new Map<string, number>();
  if (idx.start && idx.start <= ref) {
    let d = input.cal.onOrAfter(idx.start);
    for (let i = 0; i < 20000 && d <= ref; i++, d = nextTradingDay(d, input.cal)) {
      const r = daySteps(d, input);
      const complete = r.complete || idx.legacyDone.has(d);
      let state: DotState;
      if (complete) { run++; state = 'done'; }
      else if (nowMs < dayDeadline(d, input.cal, cfg)) state = 'open';
      else {
        const m = d.slice(0, 7);
        const used = graceUsed.get(m) ?? 0;
        if (run > 0 && used < cfg.grace_days_per_month) { graceUsed.set(m, used + 1); state = 'grace'; }
        else { run = 0; state = 'missed'; }
      }
      best = Math.max(best, run);
      states.set(d, { day: d, state, score: complete && !r.complete ? '1/1' : r.score });
    }
  }
  const days: DayDot[] = [];
  let d = ref;
  for (let i = 0; i < cfg.history_days; i++) {
    days.unshift(states.get(d) ?? { day: d, state: 'na', score: '' });
    d = input.cal.previous(d);
  }
  const graceLeft = cfg.grace_days_per_month - (graceUsed.get(ref.slice(0, 7)) ?? 0);
  return { current: run, best, graceLeft, days, day: ref, isTradingDay, text: `連續 ${run} 日・最佳 ${best} 日・本月寬限剩 ${graceLeft}` };
}

/** 一段交易日的流程完成率：完成 ÷（已結算的交易日）。寬限日算未完成；期限未到與開始使用前不計入分母。 */
export function completionRate(days: DayDot[]): { done: number; total: number; rate: number | null } {
  const counted = days.filter((d) => d.state === 'done' || d.state === 'grace' || d.state === 'missed');
  const done = counted.filter((d) => d.state === 'done').length;
  return { done, total: counted.length, rate: counted.length ? done / counted.length : null };
}

// ------------------------------------------------------------------ 經驗值（§8.5）
export type XpKind = 'legacy' | 'brief' | 'screener' | 'term' | 'onboard' | 'entry' | 'review' | 'plan_exit' | 'weekly_review' | 'backup' | 'backtest_own';
export const XP_LABEL: Record<XpKind, string> = {
  legacy: '既有經驗值',
  brief: '步驟 1–3 完成',
  screener: '看新觸發（步驟 4）',
  term: '首次讀完一個名詞',
  onboard: '新手導覽任務',
  entry: '符合條件的新持倉',
  review: '平倉後 3 個交易日內完成檢討',
  plan_exit: '依計畫出場',
  weekly_review: '週檢討',
  backup: '備份',
  backtest_own: '回測自己的條件',
};
export interface XpEntry { kind: XpKind; xp: number; at: number; day: string; ref?: string }

/** 經驗值表（等級卡 ⓘ 用）：每項的點數與限制 */
export function xpTable(cfg: Gcfg = uiConfig.gamification): { kind: XpKind; label: string; xp: number; limit: string }[] {
  return [
    { kind: 'brief', label: XP_LABEL.brief, xp: cfg.xp.brief, limit: '每交易日 1 次' },
    { kind: 'screener', label: XP_LABEL.screener, xp: cfg.xp.screener, limit: '每交易日 1 次' },
    { kind: 'entry', label: XP_LABEL.entry, xp: cfg.xp.entry, limit: `每交易日最多 ${cfg.caps.entry_per_day} 筆` },
    { kind: 'review', label: XP_LABEL.review, xp: cfg.xp.review, limit: `每筆；每日最多 ${cfg.caps.review_per_day} 筆` },
    { kind: 'plan_exit', label: XP_LABEL.plan_exit, xp: cfg.xp.plan_exit, limit: `每筆；每日最多 ${cfg.caps.plan_exit_per_day} 筆` },
    { kind: 'weekly_review', label: XP_LABEL.weekly_review, xp: cfg.xp.weekly_review, limit: '每週 1 次' },
    { kind: 'backup', label: XP_LABEL.backup, xp: cfg.xp.backup, limit: '每日曆月 1 次' },
    { kind: 'backtest_own', label: XP_LABEL.backtest_own, xp: cfg.xp.backtest_own, limit: '每週 1 次' },
    { kind: 'term', label: XP_LABEL.term, xp: cfg.xp.term, limit: `每個名詞 1 次；每日最多 ${cfg.caps.term_per_day} 個` },
    { kind: 'onboard', label: XP_LABEL.onboard, xp: cfg.xp.onboard, limit: '每項 1 次' },
  ];
}

/**
 * 經驗值明細。只有上表各項計分，其他行為一律 0；上限依時間順序套用（含遷移前的行為，避免同一天、同一月重複計）。
 * 有既有經驗值紀錄時：遷移時間（含）之前的行為不重算，只計那筆既有經驗值。
 */
export function xpLedger(input: FlowInput): XpEntry[] {
  const cfg = input.cfg ?? uiConfig.gamification;
  const { cal } = input;
  const idx = buildIndex(input);
  const out: XpEntry[] = [];
  // 步驟 1–3（步驟行為出現前的交易日：簡報環）
  for (const [day, at] of idx.brief) {
    if (!cal.isTradingDay(day) || at >= dayDeadline(day, cal, cfg)) continue;
    if (idx.stepsSince === null || day < idx.stepsSince) out.push({ kind: 'brief', xp: cfg.xp.brief, at, day });
  }
  if (idx.stepsSince !== null) {
    for (const day of idx.acts.keys()) {
      if (day < idx.stepsSince || !cal.isTradingDay(day)) continue;
      const st = daySteps(day, input);
      const at = steps123At(st);
      if (at !== null) out.push({ kind: 'brief', xp: cfg.xp.brief, at, day });
      const sc = st.steps.find((x) => x.id === 'screener');
      if (sc?.status === 'done' && sc.at !== undefined) out.push({ kind: 'screener', xp: cfg.xp.screener, at: sc.at, day });
    }
  }
  // 新手導覽（每項一次）、名詞（每個一次、每日最多 term_per_day 個）
  const onboardSeen = new Set<string>();
  const termSeen = new Set<string>();
  const termItems: { at: number; day: string; ref: string }[] = [];
  for (const a of [...input.activities].sort((x, y) => msOf(x.at, 0) - msOf(y.at, 0))) {
    const at = msOf(a.at, NaN);
    if (!Number.isFinite(at)) continue;
    if (a.type === 'onboard' && a.meta?.task && !onboardSeen.has(String(a.meta.task))) {
      onboardSeen.add(String(a.meta.task));
      out.push({ kind: 'onboard', xp: cfg.xp.onboard, at, day: tpeDate(a.at), ref: String(a.meta.task) });
    }
    if (a.type === 'term_read' && a.meta?.id && !termSeen.has(String(a.meta.id))) {
      termSeen.add(String(a.meta.id));
      termItems.push({ at, day: tpeDate(a.at), ref: String(a.meta.id) });
    }
  }
  // 進場：每筆符合條件的新持倉，每交易日最多 2 筆
  const capped = (items: { at: number; day: string; ref: string }[], kind: XpKind, xp: number, cap: number) => {
    const n = new Map<string, number>();
    for (const it of [...items].sort((a, b) => a.at - b.at)) {
      const c = n.get(it.day) ?? 0;
      if (c >= cap) continue;
      n.set(it.day, c + 1);
      out.push({ kind, xp, ...it });
    }
  };
  capped(input.trades.filter((t) => entryViolations(t, input.riskLimit).length === 0)
    .map((t) => ({ at: msOf(t.createdAt, Date.parse(`${t.openedAt.slice(0, 10)}T00:00:00+08:00`)), day: ritualDayOf(t.openedAt.slice(0, 10), cal), ref: t.id })),
  'entry', cfg.xp.entry, cfg.caps.entry_per_day);
  // 平倉後 3 個交易日內完成檢討
  capped(input.trades.filter((t) => reviewOnTime(t, cal, cfg))
    .map((t) => { const at = reviewedMs(t) as number; return { at, day: tpeDate(new Date(at).toISOString()), ref: t.id }; }),
  'review', cfg.xp.review, cfg.caps.review_per_day);
  // 依計畫出場
  capped(input.trades.filter((t) => planExit(t, cfg))
    .map((t) => ({ at: msOf(t.closedRecordedAt, tpeNoonMs((t.closedAt ?? t.openedAt).slice(0, 10))), day: closeDayOf(t, cal) ?? t.openedAt, ref: t.id })),
  'plan_exit', cfg.xp.plan_exit, cfg.caps.plan_exit_per_day);
  capped(termItems, 'term', cfg.xp.term, cfg.caps.term_per_day);
  // 週檢討（每週）、備份（每日曆月）、回測自己的條件（每週）
  const once = (type: Activity['type'], kind: XpKind, xp: number, key: (day: string) => string) => {
    const seen = new Set<string>();
    for (const a of input.activities.filter((x) => x.type === type).sort((x, y) => msOf(x.at, 0) - msOf(y.at, 0))) {
      const at = msOf(a.at, NaN);
      if (!Number.isFinite(at)) continue;
      const day = tpeDate(a.at);
      const k = key(day);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ kind, xp, at, day, ref: a.id });
    }
  };
  once('weekly_review', 'weekly_review', cfg.xp.weekly_review, weekOf);
  once('backup', 'backup', cfg.xp.backup, (d) => d.slice(0, 7));
  once('backtest_own', 'backtest_own', cfg.xp.backtest_own, weekOf);
  const legacy = idx.legacy;
  const kept = legacy ? out.filter((e) => e.at > legacy.at) : out;
  if (legacy) kept.unshift({ kind: 'legacy', xp: legacy.xp, at: legacy.at, day: legacy.day });
  return kept.sort((a, b) => a.at - b.at);
}

export function flowXp(input: FlowInput): number {
  return xpLedger(input).reduce((s, e) => s + e.xp, 0);
}

// ------------------------------------------------------------------ 等級（§8.6）
/** 升到等級 n 所需累計經驗值＝100 × (2^(n−1) − 1)：等級 2：100、3：300、4：700、5：1,500… */
export function levelThreshold(n: number, base = uiConfig.gamification.level_base): number {
  return base * (2 ** (n - 1) - 1);
}

export interface LevelInfo { level: number; xp: number; floor: number; next: number | null; progress: number; max: boolean }

/** 等級（上限 10、不會下降：minLevel＝遷移前的等級或曾達到的等級）。不解鎖或鎖住任何功能。 */
export function levelFor(xp: number, minLevel = 1, cfg: Gcfg = uiConfig.gamification): LevelInfo {
  let n = 1;
  while (n < cfg.level_max && levelThreshold(n + 1, cfg.level_base) <= xp) n++;
  const level = Math.min(cfg.level_max, Math.max(n, Math.floor(minLevel) || 1));
  const floor = levelThreshold(level, cfg.level_base);
  if (level >= cfg.level_max) return { level, xp, floor, next: null, progress: 1, max: true };
  const next = levelThreshold(level + 1, cfg.level_base);
  return { level, xp, floor, next, progress: Math.max(0, Math.min(1, (xp - floor) / (next - floor))), max: false };
}

/** 流程頁等級卡：經驗值、等級、「60 / 100」 */
export function flowLevel(input: FlowInput): LevelInfo & { text: string } {
  const xp = flowXp(input);
  const lv = levelFor(xp, legacyOf(input.activities)?.level ?? 1, input.cfg);
  return { ...lv, text: lv.next === null ? `${xp.toLocaleString('en-US')}` : `${xp.toLocaleString('en-US')} / ${lv.next.toLocaleString('en-US')}` };
}

// ------------------------------------------------------------------ 儲存交易時補上 v5 欄位
/**
 * saveTrade 前補欄位（只補缺少的，不覆蓋已有值）：
 * createdAt、checklistDone（依 7 題答案）、plannedRisk、riskLimit（當下設定的快照）、
 * reviewedAt（第一次寫下檢討的時間）、closedRecordedAt（第一次標為平倉的時間）。
 */
export function prepareTrade(prev: Trade | undefined, next: Trade, limit: number, nowIso: string): Trade {
  const t: Trade = { ...next };
  t.createdAt ??= prev?.createdAt ?? nowIso;
  t.checklistDone ??= prev?.checklistDone ?? checklistComplete(t);
  if (t.plannedRisk === undefined) {
    const p = prev?.plannedRisk ?? (hasStop(t) && t.shares > 0 ? (t.entry - t.stop) * t.shares : undefined);
    if (p !== undefined) t.plannedRisk = p;
  }
  t.riskLimit ??= prev?.riskLimit ?? limit;
  if (hasReview(t) && !t.reviewedAt) t.reviewedAt = (prev && hasReview(prev) ? prev.reviewedAt : undefined) ?? nowIso;
  if (t.status === 'closed' && !t.closedRecordedAt) t.closedRecordedAt = prev?.closedRecordedAt ?? nowIso;
  return t;
}

// ------------------------------------------------------------------ 相容層（第二階段改版流程頁後移除）
/** @deprecated 舊頁面用的環狀態（Ritual.tsx）。不適用的環視為完成。 */
export interface RingState {
  id: string;
  label: string;
  progress: number;
  done: boolean;
  status: string;
  action?: { href: string; label: string };
}

/** 沒有交易日曆或設定時的輸入（只用週末判斷交易日、預設風險上限）；相容層與尚未改版的頁面用。 */
export function defaultFlowInput(activities: Activity[], trades: Trade[], cal: TradingCalendar = makeCalendar(null), riskLimit = riskLimitOf(DEFAULT_PORTFOLIO)): FlowInput {
  return { cal, activities, trades, riskLimit, now: new Date().toISOString() };
}

/** @deprecated 改用 dayRings。舊簽章：只用週末判斷交易日、預設風險上限。 */
export function ritualRings(day: string, activities: Activity[], trades: Trade[], _today?: string): { rings: RingState[]; complete: boolean } {
  const r = dayRings(day, defaultFlowInput(activities, trades));
  return {
    rings: r.rings.map((x) => ({ id: x.id, label: x.label, progress: x.status === 'na' ? 1 : x.progress, done: x.status !== 'todo', status: x.text, action: x.action })),
    complete: r.complete,
  };
}

/** @deprecated 第二階段改寫文案。休市日不寫「還差」。 */
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

/** @deprecated 改用 flowStreak。舊規則：只看 ritual_done。 */
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

/** @deprecated 改用 flowXp（需要交易日曆與交易紀錄）。 */
export function totalXp(activities: Activity[], trades: Trade[] = []): number {
  return flowXp(defaultFlowInput(activities, trades));
}
