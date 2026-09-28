/**
 * 法人買賣超報表（純函式，定義見 METHODOLOGY §4.7.2）。
 * 資料：個股檔的 chip 區塊（近 60 個交易日＋前一日種子列）；買張、賣張、買賣超皆由股數換算（÷ 1,000）。
 * - 外資＝外陸資（不含外資自營商）＋外資自營商；自營商＝自行買賣＋避險；三大法人＝三者相加（買賣超為官方合計）。
 * - 舊資料只保存買賣超時，買張、賣張為空值（「—」），買賣超照常顯示。
 */
import type { ChipBlock } from './chips';
import { spokenDate } from './chips';
import { numberFormat } from './format';

type N = number | null;

export type Party = 'foreign' | 'trust' | 'dealer' | 'total';
export const PARTIES: Party[] = ['foreign', 'trust', 'dealer', 'total'];
export const PARTY_NAME: Record<Party, string> = { foreign: '外資', trust: '投信', dealer: '自營商', total: '三大法人' };
/** 期間：1／2／3 個月（以 20 個交易日為一個月） */
export const MONTHS = [1, 2, 3] as const;
export type Months = (typeof MONTHS)[number];
export const DAYS_PER_MONTH = 20;

const num = (v: unknown): N => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const at = (a: N[] | undefined, i: number): N => num(a?.[i]);

/** 全部有值才相加（任何一項缺漏 → null）。 */
function sumAll(...vs: N[]): N {
  let s = 0;
  for (const v of vs) {
    if (v === null) return null;
    s += v;
  }
  return s;
}

/** 一個交易日、一個法人的買進、賣出與買賣超（股）。 */
export interface Flow {
  buy: N;
  sell: N;
  net: N;
}

export function partyFlow(b: ChipBlock, party: Party, i: number): Flow {
  const fn = at(b.fn, i);
  const foreign: Flow = { buy: at(b.fb, i), sell: at(b.fs, i), net: fn === null ? null : fn + (at(b.ffd, i) ?? 0) };
  const trust: Flow = { buy: at(b.tb, i), sell: at(b.ts, i), net: at(b.tn, i) };
  const dn = at(b.dn, i);
  const dealer: Flow = {
    buy: sumAll(at(b.dsb, i), at(b.dhb, i)),
    sell: sumAll(at(b.dss, i), at(b.dhs, i)),
    net: dn ?? sumAll(at(b.dself, i), at(b.dhedge, i)),
  };
  if (party === 'foreign') return foreign;
  if (party === 'trust') return trust;
  if (party === 'dealer') return dealer;
  return {
    buy: sumAll(foreign.buy, trust.buy, dealer.buy),
    sell: sumAll(foreign.sell, trust.sell, dealer.sell),
    net: at(b.tot, i) ?? sumAll(foreign.net, trust.net, dealer.net),
  };
}

/** 報表的一列（張；舊到新）。 */
export interface ReportRow {
  date: string;
  close: N;
  chgPct: N;
  /** 成交量（張） */
  volume: N;
  buy: N;
  sell: N;
  net: N;
  /** 期間起點累計到當天的買賣超（張） */
  cum: N;
}

const lots = (s: N): N => (s === null ? null : s / 1000);

/** 最近 days 個交易日（不含種子列），舊到新。 */
export function reportRows(b: ChipBlock, party: Party, days: number): ReportRow[] {
  const n = b.d.length;
  const start = Math.max(1, n - days);
  const out: ReportRow[] = [];
  let cum = 0;
  let any = false;
  for (let i = start; i < n; i++) {
    const f = partyFlow(b, party, i);
    if (f.net !== null) { cum += f.net; any = true; }
    const v = at(b.v, i);
    out.push({
      date: b.d[i],
      close: at(b.c, i),
      chgPct: at(b.chg, i),
      volume: lots(v),
      buy: lots(f.buy),
      sell: lots(f.sell),
      net: lots(f.net),
      cum: any ? cum / 1000 : null,
    });
  }
  return out;
}

export interface PartyTotal {
  party: Party;
  /** 區間買張、賣張：只加總「買張與賣張都有資料」的日子（天數見 bsDays） */
  buy: N;
  sell: N;
  bsDays: number;
  net: N;
  /** 買賣超佔區間成交量 % */
  pctVolume: N;
  /** 參與度：(買張＋賣張) ÷ 2 ÷ 同期成交量 % */
  share: N;
  /** 連買（正）／連賣（負）天數 */
  streak: number;
  /** 買賣超有資料的天數 */
  days: number;
}

/** 區間合計（張）。 */
export function partyTotal(rows: ReportRow[], party: Party): PartyTotal {
  let buy = 0;
  let sell = 0;
  let bsDays = 0;
  let bsVol = 0;
  let net = 0;
  let vol = 0;
  let days = 0;
  for (const r of rows) {
    if (r.buy !== null && r.sell !== null) {
      buy += r.buy;
      sell += r.sell;
      bsDays += 1;
      bsVol += r.volume ?? 0;
    }
    if (r.net !== null) {
      net += r.net;
      days += 1;
      vol += r.volume ?? 0;
    }
  }
  return {
    party,
    buy: bsDays ? buy : null,
    sell: bsDays ? sell : null,
    bsDays,
    net: days ? net : null,
    pctVolume: days && vol ? (net / vol) * 100 : null,
    share: bsDays && bsVol ? ((buy + sell) / 2 / bsVol) * 100 : null,
    streak: streakOf(rows.map((r) => r.net)),
    days,
  };
}

/** 連買（正）／連賣（負）：由最新一天往回數同方向天數。 */
export function streakOf(values: N[]): number {
  let n = 0;
  let sign = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v === null || v === 0) break;
    const s = v > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    if (s !== sign) break;
    n += 1;
  }
  return n * sign;
}

/** 第一個有買張資料的日期（舊資料只存買賣超；沒有任何買張資料 → null）。 */
export function buySellSince(rows: ReportRow[]): string | null {
  return rows.find((r) => r.buy !== null)?.date ?? null;
}

const INT = numberFormat(0);

/** 張數文字：≥ 100,000 縮寫為「12.3 萬」；其餘千分位整數。 */
export function lotsText(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e5) return `${(a / 1e4).toFixed(a >= 1e6 ? 0 : 1)}\u00a0萬`;
  return INT.format(Math.round(a));
}

/** 張數加單位：「12,345 張」「15.1 萬張」 */
export function lotsUnit(v: number): string {
  const t = lotsText(v);
  return t.endsWith('萬') ? `${t}張` : `${t} 張`;
}

/** 有正負的張數：▲／▼＋絕對值（四捨五入後為 0 → 不加符號）。 */
export function signedLots(v: N): { text: string; dir: 'up' | 'down' | 'flat' | 'none' } {
  if (v === null) return { text: '—', dir: 'none' };
  if (Math.round(v) === 0) return { text: '0', dir: 'flat' };
  return { text: `${v > 0 ? '▲' : '▼'}${lotsText(v)}`, dir: v > 0 ? 'up' : 'down' };
}

function netPhrase(v: number): string {
  const r = Math.round(v);
  if (r === 0) return '買賣超持平';
  return `${r > 0 ? '買超' : '賣超'} ${INT.format(Math.abs(r))} 張`;
}

/**
 * 結論句（規則式、中性字眼）：「外資近 60 日累計買超 12,345 張（佔成交量 3.2%）；近 10 日轉為賣超 2,000 張」。
 * 近 10 日與整段方向不同才寫「轉為」；同向寫「近 10 日也是…」；最後附連買／連賣天數。
 */
export function headline(rows: ReportRow[], party: Party, recentDays = 10): string {
  const name = PARTY_NAME[party];
  const t = partyTotal(rows, party);
  if (t.net === null) return `${name}近 ${rows.length} 日沒有買賣超資料`;
  const pct = t.pctVolume === null ? '' : `（佔成交量 ${Math.abs(t.pctVolume).toFixed(1)}%）`;
  let s = `${name}近 ${rows.length} 日累計${netPhrase(t.net)}${Math.round(t.net) === 0 ? '' : pct}`;
  if (rows.length > recentDays * 1.5) {
    const r = partyTotal(rows.slice(-recentDays), party);
    if (r.net !== null && Math.round(r.net) !== 0) {
      const same = Math.sign(Math.round(r.net)) === Math.sign(Math.round(t.net));
      s += `；近 ${recentDays} 日${same ? '也是' : '轉為'}${netPhrase(r.net)}`;
    }
  }
  if (Math.abs(t.streak) >= 3) s += `，已連${t.streak > 0 ? '買' : '賣'} ${Math.abs(t.streak)} 日`;
  return s;
}

/** 報表的一列給螢幕閱讀器的句子。 */
export function reportSentence(r: ReportRow, party: Party): string {
  const name = PARTY_NAME[party];
  const bs = r.buy === null || r.sell === null ? '買張賣張沒有資料' : `買 ${INT.format(Math.round(r.buy))} 張、賣 ${INT.format(Math.round(r.sell))} 張`;
  const net = r.net === null ? '買賣超沒有資料' : netPhrase(r.net);
  const cum = r.cum === null ? '' : `，期間累計${netPhrase(r.cum)}`;
  const close = r.close === null ? '' : `；收盤 ${r.close} 元`;
  return `${spokenDate(r.date)}，${name}${bs}，${net}${cum}${close}`;
}

function csvN(v: N, digits = 0): string {
  return v === null ? '' : v.toFixed(digits);
}

/** CSV：四個法人的買張、賣張、買賣超（張），逐日（新到舊），第一列為區間合計。數字不含千分位。 */
export function reportCsv(b: ChipBlock, days: number, meta: { code: string; name: string }): string {
  const byParty = Object.fromEntries(PARTIES.map((p) => [p, reportRows(b, p, days)])) as Record<Party, ReportRow[]>;
  const base = byParty.foreign;
  const head = ['日期', '收盤', '成交量(張)', ...PARTIES.flatMap((p) => [`${PARTY_NAME[p]}買張`, `${PARTY_NAME[p]}賣張`, `${PARTY_NAME[p]}買賣超`])];
  const lines = [`# ${meta.name} ${meta.code} 法人買賣超（張），近 ${base.length} 個交易日；外資含外資自營商，自營商含自行買賣與避險`, head.join(',')];
  const vol = base.reduce((s, r) => s + (r.volume ?? 0), 0);
  lines.push([`區間合計(${base.length}日)`, '', csvN(vol), ...PARTIES.flatMap((p) => { const t = partyTotal(byParty[p], p); return [csvN(t.buy), csvN(t.sell), csvN(t.net)]; })].join(','));
  for (let i = base.length - 1; i >= 0; i--) {
    const r = base[i];
    lines.push([r.date, csvN(r.close, 2), csvN(r.volume), ...PARTIES.flatMap((p) => { const x = byParty[p][i]; return [csvN(x.buy), csvN(x.sell), csvN(x.net)]; })].join(','));
  }
  return lines.join('\n') + '\n';
}
