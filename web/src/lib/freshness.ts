/**
 * 資料新鮮度（2026-10-06；全站只用這一套，METHODOLOGY §12.1）。純函式，可測。
 *
 * - 時間一律用 Asia/Taipei；交易日曆＝meta.json `calendar`（週一到週五排除證交所休市日，與 pipeline 共用）。
 * - 每個資料集有一個「預期公布時間」（交易日當天，含保守餘裕），設定集中在 config/schedule.yml `freshness`，
 *   pipeline/freshness.py 讀同一張表決定補抓哪些資料集。
 * - D(X)＝最近一個「預期公布時間已經過了」的交易日。資料日 ≥ D(X) 為最新，否則落後（以交易日計）。
 * - 某一天沒有資料：那天的預期時間還沒到 →「尚未公布」；已經過了 →「尚未更新」（兩者分開）。
 *
 * 例：10/6（二）00:13 看 10/5（一）的資料 → D＝10/5 → 最新，不是落後；下次更新 10/6 15:00 後。
 */
import scheduleYml from '../../../config/schedule.yml';
import { md } from './format';
import type { TradingCalendar } from './tradingCalendar';

export interface FreshDef { label: string; time: string; sources: string[] }
interface FreshnessConfig { datasets: Record<string, FreshDef>; banner: string[]; catchup: { times: string[]; retry_minutes: number; max_retries: number } }

export const freshnessConfig = (scheduleYml as { freshness: FreshnessConfig }).freshness;
export type FreshKey = 'quotes' | 'index' | 'intraday' | 'insti' | 'insti_amount' | 'taifex' | 'valuation' | 'qfii' | 'credit' | 'margin_total' | 'sbl' | 'daytrade';
export const FRESH: Record<FreshKey, FreshDef> = freshnessConfig.datasets as Record<FreshKey, FreshDef>;
/** 頁首「資料至」與橫幅看的資料集 */
export const BANNER_KEYS = freshnessConfig.banner as FreshKey[];

export interface TpeClock { today: string; hhmm: string }

/** 台北時間的今天與時刻（不依賴裝置時區） */
export function tpeClock(now: Date = new Date()): TpeClock {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { today: t.toISOString().slice(0, 10), hhmm: t.toISOString().slice(11, 16) };
}

/** 「預期公布時間已經過了」：該交易日的預期時間 ≤ 現在 */
function passed(day: string, time: string, clock: TpeClock): boolean {
  return day < clock.today || (day === clock.today && clock.hhmm >= time);
}

/** D(X)：最近一個預期公布時間已過的交易日。 */
export function dueDate(key: FreshKey, cal: TradingCalendar, clock: TpeClock): string {
  const t = FRESH[key].time;
  if (cal.isTradingDay(clock.today) && clock.hhmm >= t) return clock.today;
  return cal.previous(clock.today);
}

export type DayStatus = 'unpublished' | 'not_updated';

/** 某資料集某交易日沒有資料時的狀態：預期時間未到 → unpublished（尚未公布）；已過 → not_updated（尚未更新）。 */
export function missingDayStatus(key: FreshKey, day: string, clock: TpeClock): DayStatus {
  return passed(day, FRESH[key].time, clock) ? 'not_updated' : 'unpublished';
}

export const DAY_STATUS_TEXT: Record<DayStatus, string> = { unpublished: '尚未公布', not_updated: '尚未更新' };

export interface Freshness {
  key: FreshKey;
  label: string;
  latest: string | null;
  due: string;
  state: 'fresh' | 'lag' | 'missing';
  /** 落後幾個交易日（最新為 0） */
  lag: number;
}

export function datasetFreshness(key: FreshKey, latest: string | null | undefined, cal: TradingCalendar, clock: TpeClock): Freshness {
  const due = dueDate(key, cal, clock);
  const base = { key, label: FRESH[key].label, latest: latest ?? null, due };
  if (!latest) return { ...base, state: 'missing', lag: 0 };
  if (latest >= due) return { ...base, state: 'fresh', lag: 0 };
  return { ...base, state: 'lag', lag: cal.tradingDaysBetween(latest, due) };
}

/** 下一次預期更新：今天是交易日且還有資料集的預期時間未到 → 其中最早的；否則 null。 */
export function nextUpdate(cal: TradingCalendar, clock: TpeClock, keys: FreshKey[] = BANNER_KEYS): { date: string; time: string } | null {
  if (!cal.isTradingDay(clock.today)) return null;
  const upcoming = keys.map((k) => FRESH[k].time).filter((t) => clock.hhmm < t).sort();
  return upcoming.length ? { date: clock.today, time: upcoming[0] } : null;
}

export interface FreshSummary {
  rows: Freshness[];
  /** 落後（或完全沒有資料）的資料集 */
  lagging: Freshness[];
  /** 「今天的資料尚未更新」：今天是交易日、至少一個資料集預期時間已過、該資料集資料日 < 今天 */
  todayNotUpdated: boolean;
  /** 「下次更新 10/6 15:00 後」 */
  next: { date: string; time: string } | null;
}

export function freshnessSummary(asof: Partial<Record<string, string | null>> | null | undefined, cal: TradingCalendar, clock: TpeClock, keys: FreshKey[] = BANNER_KEYS): FreshSummary {
  const rows = keys.filter((k) => FRESH[k]).map((k) => datasetFreshness(k, asof?.[k] ?? null, cal, clock));
  const lagging = rows.filter((r) => r.state !== 'fresh');
  const todayNotUpdated = cal.isTradingDay(clock.today) && rows.some((r) => r.due === clock.today && (r.latest ?? '') < clock.today);
  return { rows, lagging, todayNotUpdated, next: nextUpdate(cal, clock, keys) };
}

/** 「三大法人 10/2（落後 1 個交易日）」 */
export function lagText(f: Freshness): string {
  if (f.state === 'missing' || !f.latest) return `${f.label} 尚未取得`;
  return `${f.label} ${md(f.latest)}（落後 ${f.lag} 個交易日）`;
}

/** 橫幅一句：「資料落後 三大法人 10/2（落後 1 個交易日）・融資融券 10/2（落後 1 個交易日）」；全部最新 → null。 */
export function lagBanner(s: FreshSummary): string | null {
  return s.lagging.length ? `資料落後 ${s.lagging.map(lagText).join('・')}` : null;
}

/** 「下次更新 10/6 15:00 後」 */
export function nextText(n: { date: string; time: string } | null): string | null {
  return n ? `下次更新 ${md(n.date)} ${n.time} 後` : null;
}
