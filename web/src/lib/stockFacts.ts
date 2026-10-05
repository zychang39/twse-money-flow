/**
 * 個股頁（SPEC §5，stock 2026-10-03）的每一個數字：純函式，輸入個股檔（stocks/{code}.json），輸出畫面要的值。
 * 只有需要全市場比較的數字由 pipeline 算（個股檔 `mom`：報酬全市場百分位、RS 20 日前、產業名次；
 * metrics.vol_ratio／vol20_lots：量比）；其餘都由個股檔的單檔序列在這裡算。
 *
 * 價格基準：均線、報酬、ATR、乖離一律用還原價（收盤 × 還原因子）；畫面上的價格（均線價、ATR、估計成本）換回
 * 「最新原始價」的基準（÷ 最新一日的還原因子，通常為 1），與參考價（最新收盤，未還原）同一基準。
 */
import type { StockHistory, StockRow } from '../data/types';
import { type ChipBlock, type FlowKey, chipRows, estimatedCost, recent, streak, sumConverted } from './chips';
import { deltaOver, shortRatio } from './credit';
import { ALIGN_NAME, type Alignment, MA_DAYS, high52w, revenueFacts, type RevenueFacts, type RevenueRow, smaLast } from './fundamentals';
import { type HolderBlock, tierName, tierStats, type Tier } from './holders';
import { percentileOfLast, rollingSum } from './insights';
import { atrLast } from './technical';
import type { TradingCalendar } from './tradingCalendar';
import { thresholds } from './config';
import { fmtLotsUnit } from './format';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const lastOk = (a: N[] | undefined): N => {
  if (!a) return null;
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return a[i];
  return null;
};

/** 還原收盤（缺值為 null）。 */
export function adjSeries(values: N[], af: number[]): N[] {
  return values.map((v, i) => (ok(v) ? v * (af[i] ?? 1) : null));
}
/** 最新一日的還原因子（換回最新原始價基準用；通常為 1）。 */
export function lastFactor(h: Pick<StockHistory, 'c' | 'af'>): number {
  for (let i = h.c.length - 1; i >= 0; i--) if (ok(h.c[i])) return ok(h.af[i]) && h.af[i] > 0 ? h.af[i] : 1;
  return 1;
}

// ------------------------------------------------------------------ 動能：報酬與相對強弱（pipeline mom）
export const RET_WINDOWS = ['1M', '3M', '6M', '12M'] as const;
export type RetWindow = (typeof RET_WINDOWS)[number];
/** 交易日數：1M＝21、3M＝63、6M＝126、12M＝252（pipeline/derive/momentum.py RETURN_WINDOWS） */
export const RET_DAYS: Record<RetWindow, number> = { '1M': 21, '3M': 63, '6M': 126, '12M': 252 };

/** 個股檔 `mom`（pipeline/derive/momentum.py） */
export interface MomBlock {
  date: string | null;
  /** 還原收盤報酬（%） */
  ret: Record<RetWindow, N>;
  /** 全市場普通股百分位（0–100）；ETF 等非普通股為 null */
  pct: Record<RetWindow, N>;
  /** 百分位的有效檔數 */
  n: Record<RetWindow, number>;
  /** RS 百分位（0–100）與 20 個交易日前的值 */
  rs: N;
  rs_prev: N;
  rs_prev_date: string | null;
  /** 所屬產業近 3 個月報酬中位數的名次（1＝最高）；成員 < 3 檔的產業 rank 為 null */
  industry: { name: string; median: N; members: number; rank: number | null; of: number; window: '3M' } | null;
}

export function momBlock(h: StockHistory): MomBlock | null {
  const m = h.mom as MomBlock | null | undefined;
  return m && typeof m === 'object' && m.ret ? m : null;
}

export interface ReturnRow { key: RetWindow; days: number; ret: N; pct: N }
export function returnRows(h: StockHistory): ReturnRow[] {
  const m = momBlock(h);
  return RET_WINDOWS.map((key) => ({ key, days: RET_DAYS[key], ret: m?.ret[key] ?? null, pct: m?.pct[key] ?? null }));
}

export interface RsFacts { now: N; prev: N; prevDate: string | null }
/** RS 百分位與 20 個交易日前；沒有 mom（舊版個股檔）時用 series.rs_percentile。 */
export function rsFacts(h: StockHistory): RsFacts {
  const m = momBlock(h);
  if (m) return { now: m.rs, prev: m.rs_prev, prevDate: m.rs_prev_date };
  const s = (h.series as Record<string, N[]> | undefined)?.rs_percentile;
  const i = s ? s.length - 1 : -1;
  return { now: i >= 0 && ok(s![i]) ? s![i] : null, prev: i >= 20 && ok(s![i - 20]) ? s![i - 20] : null, prevDate: i >= 20 ? h.d[i - 20] ?? null : null };
}

/** 產業名次「3/35」；沒有資料為 null。 */
export function industryRankText(h: StockHistory): string | null {
  const ind = momBlock(h)?.industry;
  return ind && ind.rank !== null ? `${ind.rank}/${ind.of}` : null;
}

// ------------------------------------------------------------------ 位置
export const HIGH_60_DAYS = 60;
export interface PositionFacts {
  /** 距 52 週（252 個交易日）最高收盤 %（≤ 0） */
  dist52: N;
  high52: { value: number; date: string } | null;
  /** 距 60 日最高收盤 %（≤ 0） */
  dist60: N;
  high60: { value: number; date: string } | null;
  /** 最新收盤 ≥ 近 60 個交易日（含當日）最高收盤 → 創 60 日收盤新高；不足 60 日為 null */
  newHigh60: boolean | null;
}
export function positionFacts(h: Pick<StockHistory, 'c' | 'af' | 'd'>): PositionFacts {
  const adj = adjSeries(h.c, h.af);
  const f = lastFactor(h);
  const hi52 = high52w(adj, h.d);
  const hi60 = high52w(adj, h.d, HIGH_60_DAYS);
  return {
    dist52: hi52 ? hi52.dist : null,
    high52: hi52 ? { value: hi52.value / f, date: hi52.date } : null,
    dist60: hi60 ? hi60.dist : null,
    high60: hi60 ? { value: hi60.value / f, date: hi60.date } : null,
    newHigh60: hi60 ? hi60.dist >= -1e-9 : null,
  };
}

// ------------------------------------------------------------------ 趨勢
export interface MaRow { n: number; value: N; gap: N }
export interface TrendFacts { close: N; ma: MaRow[]; alignment: Alignment; alignName: string }
/** 20／60／240 日均線（還原收盤簡單平均，換回最新原始價基準）與乖離 %＝收盤 ÷ 均線 − 1；排列：20 > 60 > 240 多頭、反之空頭、其餘糾結。 */
export function trendFacts(h: Pick<StockHistory, 'c' | 'af'>): TrendFacts {
  const adj = adjSeries(h.c, h.af);
  const f = lastFactor(h);
  const closeAdj = lastOk(adj);
  const ma = MA_DAYS.map((n) => {
    const v = smaLast(adj, n);
    return { n, value: v === null ? null : v / f, gap: v === null || closeAdj === null ? null : (closeAdj / v - 1) * 100 };
  });
  const [a, b, c] = ma.map((m) => m.value);
  const alignment: Alignment = a === null || b === null || c === null ? 'na' : a > b && b > c ? 'bull' : a < b && b < c ? 'bear' : 'mixed';
  return { close: closeAdj === null ? null : closeAdj / f, ma, alignment, alignName: ALIGN_NAME[alignment] };
}

// ------------------------------------------------------------------ 波動
export interface VolatilityFacts {
  /** ATR14（Wilder；還原價計算、換回最新原始價基準，與參考價同一基準） */
  atr: N;
  /** ATR14 ÷ 最新收盤（%） */
  atrPct: N;
  /** 20 日乖離的 ATR 倍數＝(收盤 − 20 日均線) ÷ ATR14 */
  biasAtr: N;
  /** 參考價：最新收盤（未還原） */
  price: N;
}
export function volatilityFacts(h: Pick<StockHistory, 'c' | 'h' | 'l' | 'af'>): VolatilityFacts {
  const C = adjSeries(h.c, h.af);
  const atrAdj = atrLast(adjSeries(h.h, h.af), adjSeries(h.l, h.af), C, 14);
  const closeAdj = lastOk(C);
  const ma20 = smaLast(C, 20);
  const f = lastFactor(h);
  return {
    atr: atrAdj === null ? null : atrAdj / f,
    atrPct: atrAdj !== null && closeAdj ? (atrAdj / closeAdj) * 100 : null,
    biasAtr: atrAdj && closeAdj !== null && ma20 !== null ? (closeAdj - ma20) / atrAdj : null,
    price: lastOk(h.c),
  };
}

// ------------------------------------------------------------------ 量比
export interface VolumeFacts {
  /** 量比＝當日成交量 ÷ 前 20 個交易日平均成交量（分母不含當日） */
  ratio: N;
  avg20Lots: N;
  todayLots: N;
}
/** 優先用 pipeline（metrics.vol_ratio／vol20_lots，以市場交易日計）；舊版個股檔退回用 v 序列（個股有成交的日子）。 */
export function volumeFacts(h: Pick<StockHistory, 'v' | 'metrics'>): VolumeFacts {
  const m = h.metrics ?? {};
  const today = ok(m.volume_lots) ? m.volume_lots : lastOk(h.v);
  if (ok(m.vol_ratio) || ok(m.vol20_lots)) return { ratio: ok(m.vol_ratio) ? m.vol_ratio : null, avg20Lots: ok(m.vol20_lots) ? m.vol20_lots : null, todayLots: today };
  const v = h.v;
  const prior = v.slice(-21, -1).filter(ok);
  const avg = prior.length >= 10 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  const last = v.length ? v[v.length - 1] : null;
  return { ratio: avg && ok(last) ? last / avg : null, avg20Lots: avg, todayLots: today };
}

// ------------------------------------------------------------------ 法人
export type InstParty = 'foreign' | 'trust' | 'dealer' | 'total';
export const INST_PARTIES: InstParty[] = ['foreign', 'trust', 'dealer', 'total'];
export const INST_LABEL: Record<InstParty, string> = { foreign: '外資', trust: '投信', dealer: '自營商', total: '合計' };
/** 外資＝外陸資＋外資自營商；自營商＝自行買賣＋避險；合計＝官方三大法人合計 */
const FLOW_OF: Record<InstParty, FlowKey> = { foreign: 'foreign', trust: 'trust', dealer: 'dealer', total: 'total' };

export interface InstCell {
  party: InstParty;
  label: string;
  /** 期間淨買賣超（張） */
  lots: N;
  /** 期間淨買賣超 ÷ 同期成交量（%；只計有資料的日子） */
  pctVolume: N;
  /** 由最新一日往回的連續買（正）／賣（負）日數；最多 chip 區塊的 60 日 */
  streak: number;
}
export interface InstTable { days: number; available: number; start: string | null; end: string | null; rows: InstCell[] }
export function instTable(chip: ChipBlock | null | undefined, days: number): InstTable | null {
  if (!chip || chip.d.length < 2) return null;
  const all = chipRows(chip);
  const rows = recent(all, days);
  return {
    days,
    available: rows.length,
    start: rows.length ? rows[rows.length - 1].date : null,
    end: rows.length ? rows[0].date : null,
    rows: INST_PARTIES.map((party) => ({
      party,
      label: INST_LABEL[party],
      lots: sumConverted(rows, FLOW_OF[party], 'lots'),
      pctVolume: sumConverted(rows, FLOW_OF[party], 'pct'),
      streak: streak(all.slice(1).map((r) => r[FLOW_OF[party]])),
    })),
  };
}

export interface InstDetail {
  party: InstParty;
  days: number;
  lots: N;
  /** 期間淨買賣超 ÷ 發行股數（%） */
  pctCapital: N;
  /** 估計成本（估；期間淨買超日的均價加權，還原後換回最新原始價基準）；期間合計非淨買超時為 null */
  cost: N;
  /** 現價 ÷ 估計成本 − 1（%） */
  costRel: N;
  /** 近 20 日買超在過去 1 年（250 個交易日）的百分位（0–100）；外資用個股檔 fn（外陸資，不含外資自營商） */
  pct1y: N;
  /** 自營商拆分（張）：自行買賣、避險；只有 party＝dealer */
  split: { self: N; hedge: N } | null;
}
const HIST_KEY: Record<InstParty, ('fn' | 'tn' | 'dn')[]> = { foreign: ['fn'], trust: ['tn'], dealer: ['dn'], total: ['fn', 'tn', 'dn'] };

export function instDetail(h: StockHistory, chip: ChipBlock | null | undefined, party: InstParty, days: number): InstDetail | null {
  if (!chip || chip.d.length < 2) return null;
  const all = chipRows(chip);
  const rows = recent(all, days);
  const key = FLOW_OF[party];
  const lots = sumConverted(rows, key, 'lots');
  const cost = lots !== null && lots > 0 ? estimatedCost(rows, key) : null;
  const f = lastFactor(h);
  const latest = rows[0];
  const adjClose = latest && latest.close !== null ? latest.close * (latest.af ?? 1) : null;
  // 1 年百分位：個股檔全期間的張數序列（20 日滾動加總）
  const keys = HIST_KEY[party];
  const series = h.d.map((_, i) => {
    let s = 0;
    for (const k of keys) {
      const v = (h[k] as N[])[i];
      if (!ok(v)) return null;
      s += v;
    }
    return s;
  });
  return {
    party,
    days,
    lots,
    pctCapital: lots !== null && h.shares ? ((lots * 1000) / h.shares) * 100 : null,
    cost: cost === null ? null : cost / f,
    costRel: cost && adjClose !== null ? (adjClose / cost - 1) * 100 : null,
    pct1y: percentileOfLast(rollingSum(series, 20), 250),
    split: party === 'dealer' ? { self: sumConverted(rows, 'dealerSelf', 'lots'), hedge: sumConverted(rows, 'dealerHedge', 'lots') } : null,
  };
}

/** 法人（三大法人合計）近 20 日買超佔同期成交量 %。 */
export function inst20PctVolume(chip: ChipBlock | null | undefined): N {
  return instTable(chip, 20)?.rows.find((r) => r.party === 'total')?.pctVolume ?? null;
}

/** 外資持股比（%）與 20 個交易日變化（百分點）。 */
export function foreignHolding(h: StockHistory): { pct: N; change20: N; date: string | null } {
  const q = h.qfii as N[] | undefined;
  if (!q) return { pct: null, change20: null, date: null };
  const d = deltaOver(h.d, q, 20);
  let date: string | null = null;
  for (let i = q.length - 1; i >= 0; i--) if (ok(q[i])) { date = h.d[i] ?? null; break; }
  return { pct: d.now, change20: d.abs, date };
}

// ------------------------------------------------------------------ 股權分散（集保週資料）
export interface HolderFacts {
  /** 資料日（集保週資料的基準日） */
  date: string | null;
  weeks: number;
  /** 四級（散戶 ≤ 5 張｜中實戶 5–400｜大戶 400–1,000｜千張大戶 ≥ 1,000；互斥）：比例 %、週變化（百分點） */
  tiers: { tier: Tier; name: string; pct: N; change: N }[];
  /** 千張大戶連續增加（正）／減少（負）週數 */
  whaleStreak: number;
  whaleChange: N;
}
export function holderFacts(h: StockHistory): HolderFacts | null {
  const b = h.holders as HolderBlock | null | undefined;
  if (!b || !b.d?.length) return null;
  const st = tierStats(b, 1000);
  const whale = st.find((s) => s.tier === 'whale');
  return {
    date: b.d[b.d.length - 1],
    weeks: b.d.length,
    tiers: st.map((s) => ({ tier: s.tier, name: tierName(s.tier, 1000), pct: s.pct, change: s.change })),
    whaleStreak: whale?.streak ?? 0,
    whaleChange: whale?.change ?? null,
  };
}

// ------------------------------------------------------------------ 信用交易
export interface CreditFacts {
  /** 融資餘額（張）、5／20 個交易日變化（張與 %） */
  marginBal: N;
  margin5: { abs: N; pct: N; thenDate: string | null };
  margin20: { abs: N; pct: N; thenDate: string | null };
  /** 融資使用率 %＝融資餘額 ÷ 融資限額 */
  usage: N;
  shortBal: N;
  /** 借券賣出餘額（張） */
  sblBal: N;
  /** 券資比 %＝融券餘額 ÷ 融資餘額 */
  shortRatio: N;
  /** 融券最後回補日（停止融券期間；沒有則 null） */
  lastCoverDate: string | null;
}
export function creditFacts(h: StockHistory): CreditFacts {
  const m5 = deltaOver(h.d, h.mb, 5);
  const m20 = deltaOver(h.d, h.mb, 20);
  const mb = lastOk(h.mb);
  const sb = lastOk(h.sb);
  const sh = h.short_halt as { last_cover_date?: string | null } | null | undefined;
  const usage = (h.metrics ?? {}).margin_usage;
  return {
    marginBal: mb,
    margin5: { abs: m5.abs, pct: m5.pct, thenDate: m5.thenDate },
    margin20: { abs: m20.abs, pct: m20.pct, thenDate: m20.thenDate },
    usage: ok(usage) ? usage : null,
    shortBal: sb,
    sblBal: lastOk(h.sbl as N[] | undefined),
    shortRatio: shortRatio(sb, mb),
    lastCoverDate: sh?.last_cover_date ?? null,
  };
}

// ------------------------------------------------------------------ 基本面
export interface RevenueSummary extends RevenueFacts {
  /** 近 12 個月年增率（舊到新） */
  yoy12: { ym: string; yoy: N }[];
}
export function revenueSummary(h: StockHistory): RevenueSummary {
  const rows = (h.revenue as RevenueRow[] | undefined) ?? [];
  const f = revenueFacts(rows);
  return { ...f, yoy12: f.last12.map((r) => ({ ym: r.ym, yoy: r.yoy })) };
}

/** 本益比百分位的回看期（交易日）：config/thresholds.yml indicators.valuation_percentile.lookback_days（756 ≈ 3 年） */
export const PE_LOOKBACK_DAYS = Number(thresholds.indicators?.valuation_percentile?.lookback_days ?? 756);
export interface ValuationFacts { pe: N; pePct3y: N; pb: N; dy: N; date: string | null }
export function valuationFacts(h: StockHistory): ValuationFacts {
  const s = (h.series as Record<string, N[]> | undefined)?.pe_percentile;
  let date: string | null = null;
  for (let i = h.pe.length - 1; i >= 0; i--) if (ok(h.pe[i]) || ok(h.pb[i]) || ok(h.dy[i])) { date = h.d[i] ?? null; break; }
  const pe = lastOk(h.pe);
  return { pe: pe !== null && pe > 0 ? pe : null, pePct3y: pe !== null && pe > 0 ? lastOk(s) : null, pb: lastOk(h.pb), dy: lastOk(h.dy), date };
}

// ------------------------------------------------------------------ 事件
export type UpcomingKind = 'revenue' | 'exright' | 'conference' | 'short_cover';
export interface UpcomingEvent { date: string; kind: UpcomingKind; label: string; text: string; /** 期限已過仍未公布（只有月營收） */ overdue?: boolean }

function nextYm(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
/**
 * 下一次月營收公布期限：最新已公布月份的下一個月，期限＝其次月 10 日，遇休市日順延到下一個交易日。
 * latestYm 為 null（沒有營收資料）時以 today 的前一個月為待公布月份。
 */
export function revenueDeadline(latestYm: string | null, today: string, cal: TradingCalendar): { ym: string; date: string; overdue: boolean } {
  const prevMonth = (() => {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();
  const ym = latestYm ? nextYm(latestYm) : prevMonth;
  const date = cal.onOrAfter(`${nextYm(ym)}-10`);
  return { ym, date, overdue: date < today };
}

interface EvLike { date: string; type: string; text: string }
interface ConfLike { date: string; time?: string | null; place?: string | null; text: string; host?: string | null }

/** 即將發生（today 當日含以後，舊到新）：月營收公布期限、除權息（含預告）、法說會、融券最後回補日。 */
export function upcomingEvents(h: StockHistory, today: string, cal: TradingCalendar): UpcomingEvent[] {
  const out: UpcomingEvent[] = [];
  const rev = (h.revenue as RevenueRow[] | undefined) ?? [];
  const isStock = h.industry !== 'ETF';
  if (isStock) {
    const dl = revenueDeadline(rev.length ? rev[rev.length - 1].ym : null, today, cal);
    out.push({ date: dl.date, kind: 'revenue', label: '月營收', text: `${Number(dl.ym.slice(5, 7))} 月營收公布期限`, overdue: dl.overdue });
  }
  const seen = new Set<string>();
  for (const e of (h.events as EvLike[] | undefined) ?? []) {
    if (e.date < today || (e.type !== '預告' && e.type !== '除權息')) continue;
    if (seen.has(e.date)) continue;
    seen.add(e.date);
    out.push({ date: e.date, kind: 'exright', label: '除權息', text: e.text });
  }
  for (const c of (h.conferences as ConfLike[] | undefined) ?? []) {
    if (c.date >= today) out.push({ date: c.date, kind: 'conference', label: '法說會', text: [c.time, c.place].filter(Boolean).join('・') || c.text });
  }
  const cover = (h.short_halt as { last_cover_date?: string | null } | null | undefined)?.last_cover_date;
  if (cover && cover >= today) out.push({ date: cover, kind: 'short_cover', label: '融券回補', text: '融券最後回補日' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 近一年法說會（today 以前，新到舊）。 */
export function pastConferences(h: StockHistory, today: string): ConfLike[] {
  return ((h.conferences as ConfLike[] | undefined) ?? []).filter((c) => c.date < today).sort((a, b) => b.date.localeCompare(a.date));
}

// ------------------------------------------------------------------ 摘要格（2 欄 × 3 列）
export interface SummaryGrid {
  rs: N;
  dist52: N;
  biasAtr: N;
  volRatio: N;
  inst20Pct: N;
  /** 千張大戶週變化（百分點） */
  whaleWeek: N;
}
export function summaryGrid(h: StockHistory): SummaryGrid {
  return {
    rs: rsFacts(h).now,
    dist52: positionFacts(h).dist52,
    biasAtr: volatilityFacts(h).biasAtr,
    volRatio: volumeFacts(h).ratio,
    inst20Pct: inst20PctVolume(h.chip as ChipBlock | null | undefined),
    whaleWeek: holderFacts(h)?.whaleChange ?? null,
  };
}

// ------------------------------------------------------------------ 簡報頁自選股列（summary.json）
export interface WatchLine {
  /** 當日外資＋投信淨買賣超（張） */
  instLots: N;
  /** ÷ 20 日均量（%；分母不含當日） */
  instPctAvg20: N;
  /** 量比（倍） */
  volRatio: N;
  rs: N;
}
/**
 * 舊版「外資＋投信 −2.4 萬張・量 70%」的「量 70%」＝當日外資＋投信淨買賣超 ÷ 當日成交量（lib/changes.instReasonText）。
 * 新版拆成兩個數字：「外資+投信 +5,887 張（佔 20 日均量 12%）」與「量 1.32×」（當日量 ÷ 20 日均量）。
 */
export function watchLine(r: StockRow): WatchLine {
  const f = r.foreign_net_lots;
  const t = r.trust_net_lots;
  const inst = ok(f) || ok(t) ? (f ?? 0) + (t ?? 0) : null;
  const avg = ok(r.vol20_lots) ? r.vol20_lots : null;
  return {
    instLots: inst,
    instPctAvg20: inst !== null && avg ? (inst / avg) * 100 : null,
    volRatio: ok(r.vol_ratio) ? r.vol_ratio : null,
    rs: ok(r.rs_percentile) ? r.rs_percentile : null,
  };
}
/** 「外資+投信 +5,887 張（佔 20 日均量 12%）・量 1.32×」 */
export function watchLineText(w: WatchLine): string {
  const parts: string[] = [];
  if (w.instLots !== null) parts.push(`外資+投信 ${fmtLotsUnit(w.instLots).replace(' ', '\u00a0')}${w.instPctAvg20 === null ? '' : `（佔 20 日均量 ${Math.round(Math.abs(w.instPctAvg20))}%）`}`);
  if (w.volRatio !== null) parts.push(`量\u00a0${w.volRatio.toFixed(2)}×`);
  return parts.join('・');
}

// ------------------------------------------------------------------ 狀態標籤（§5.3；注意／處置由 data 代理的 attn 提供）
export interface StatusTag { kind: 'short_cover' | 'exright'; date: string; /** 距今的交易日數（今天之後、到該日含） */ days: number; text: string }
export const SHORT_COVER_TAG_DAYS = 10;
export const EXRIGHT_TAG_DAYS = 5;
/** 融券最後回補日 ≤ 10 個營業日、除權息 ≤ 5 個營業日（以交易日曆計，today 當天為 0）。 */
export function statusTags(h: StockHistory, today: string, cal: TradingCalendar): StatusTag[] {
  const out: StatusTag[] = [];
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const cover = (h.short_halt as { last_cover_date?: string | null } | null | undefined)?.last_cover_date;
  if (cover && cover >= today) {
    const days = cal.tradingDaysBetween(today, cover);
    if (days <= SHORT_COVER_TAG_DAYS) out.push({ kind: 'short_cover', date: cover, days, text: `融券最後回補 ${md(cover)}` });
  }
  const ex = upcomingEvents(h, today, cal).find((e) => e.kind === 'exright');
  if (ex) {
    const days = cal.tradingDaysBetween(today, ex.date);
    if (days <= EXRIGHT_TAG_DAYS) out.push({ kind: 'exright', date: ex.date, days, text: `除權息 ${md(ex.date)}` });
  }
  return out;
}
