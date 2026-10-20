/**
 * 融資增減（2026-10-20；定義見 METHODOLOGY §4.7.8；資料 pipeline/derive/margin.py）。純函式，可測。
 * 上市＋上櫃融資金額（億元）、資減／資增家數；排行依期間（當日／5 日／20 日）、方向與排序。
 */
import type { MarginDay, MarginIndex, MarginIndexDay } from '../data/types';
import { type DayStatus, FRESH, dueDate, missingDayStatus, type TpeClock } from './freshness';
import type { TradingCalendar } from './tradingCalendar';

export type MarginKind = 'down_lots' | 'down_pct' | 'up_lots' | 'up_pct';
export const MARGIN_KINDS: readonly (readonly [MarginKind, string])[] = [
  ['down_lots', '資減張數'], ['down_pct', '資減幅度'], ['up_lots', '資增張數'], ['up_pct', '資增幅度'],
];
export const MARGIN_PERIODS: readonly (readonly ['1' | '5' | '20', string])[] = [['1', '當日'], ['5', '5 日'], ['20', '20 日']];
export type MarginPeriod = (typeof MARGIN_PERIODS)[number][0];

export interface MarginRow {
  code: string; name: string; market: string;
  /** 融資增減（張） */
  chg: number;
  /** 增減幅（%，相對期初餘額） */
  pct: number;
  /** 期末融資餘額（張） */
  balance: number;
  close: number | null;
  /** 期間漲跌（%，官方漲跌連乘：除權息不算下跌） */
  ret: number | null;
  /** 連 N 日資減（含當天；資增排行為 0） */
  streak: number;
}

/** 上市＋上櫃融資金額：增減與餘額（億元）；兩個市場都沒有 → null */
export function dayTotal(d: MarginIndexDay | undefined): { chg: number | null; amt: number | null } {
  if (!d) return { chg: null, amt: null };
  const ms = [d.twse, d.tpex].filter((m): m is NonNullable<typeof m> => !!m);
  if (!ms.length) return { chg: null, amt: null };
  const chgs = ms.map((m) => m.chg).filter((v): v is number => v !== null && Number.isFinite(v));
  return { chg: chgs.length ? round1(chgs.reduce((a, b) => a + b, 0)) : null, amt: round1(ms.reduce((a, m) => a + m.amt, 0)) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 近 n 個交易日的融資金額合計增減（期末餘額 − n 日前餘額；不足 n+1 天 → null） */
export function changeOver(ix: MarginIndex, n: number, end = ix.days.length - 1): number | null {
  const a = dayTotal(ix.days[end]).amt;
  const b = dayTotal(ix.days[end - n]).amt;
  return end - n >= 0 && a !== null && b !== null ? round1(a - b) : null;
}

export function marginRows(day: MarginDay | null | undefined, period: MarginPeriod, kind: MarginKind): MarginRow[] | null {
  const list = day?.lists[`${period}_${kind}`];
  if (!day || !list) return null;
  return list.map((r) => Object.fromEntries(day.columns.map((c, i) => [c, r[i]])) as unknown as MarginRow);
}

export type MarginCardState =
  | { kind: 'fresh'; day: MarginIndexDay }
  | { kind: 'waiting'; status: DayStatus; last: MarginIndexDay }
  | { kind: 'none' };

/**
 * 盤後簡報卡片的狀態。今天收盤資料已到（15:00 後）、融資還沒公布（20:50 前）→「尚未公布・約 20:45 公布」並附上前一天的數字
 * （其他卡片已是今天，不把前一天當成今天、也不留白）；預期時間已過仍沒有 →「尚未更新」；其餘（盤中、凌晨、假日）前一天就是最新。
 */
export function cardState(ix: MarginIndex | null, cal: TradingCalendar, clock: TpeClock): MarginCardState {
  if (!ix || !ix.days.length) return { kind: 'none' };
  const last = ix.days[ix.days.length - 1];
  const trading = cal.isTradingDay(clock.today);
  if (trading && last.date < clock.today && clock.hhmm >= FRESH.quotes.time && clock.hhmm < FRESH.margin_flash.time) {
    return { kind: 'waiting', status: missingDayStatus('margin_flash', clock.today, clock), last };
  }
  if (last.date >= dueDate('margin_flash', cal, clock)) return { kind: 'fresh', day: last };
  return { kind: 'waiting', status: 'not_updated', last };
}

/** 預期公布時間（設定的時間含 5 分鐘餘裕；顯示實測的公布時間） */
export function publishTime(): string {
  const [h, m] = FRESH.margin_flash.time.split(':').map(Number);
  const t = h * 60 + m - 5;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** 「連 N 日資減」：2 日以上才標 */
export function streakText(r: Pick<MarginRow, 'streak'>, cap = 20): string | null {
  if (r.streak < 2) return null;
  return r.streak >= cap ? `連 ${cap} 日以上資減` : `連 ${r.streak} 日資減`;
}
