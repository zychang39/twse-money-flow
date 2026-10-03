/**
 * 信用與空方、外資持股（純函式；定義見 METHODOLOGY §4.7.5）。
 * 每個數字都帶「比較基準」：與 N 個交易日前（日期）相比。
 * 資料：個股檔的 d（交易日）、c（收盤）、mb／sb（融資／融券餘額，張）、sbl（借券賣出餘額，張）、qfii（外資持股比 %）。
 */
import { uiConfig } from './config';
import { numberFormat } from './format';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Delta {
  now: N;
  then: N;
  /** 比較基準的日期（N 個交易日前） */
  thenDate: string | null;
  days: number;
  abs: N;
  /** 變化率 %（基準為 0 或缺值 → null） */
  pct: N;
}

/** 最後一個有值的索引。 */
export function lastValid(a: N[] | undefined): number {
  if (!a) return -1;
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return i;
  return -1;
}

/** 以最後一個有值的交易日為準，與 days 個交易日前相比。 */
export function deltaOver(dates: string[], values: N[] | undefined, days: number): Delta {
  const i = lastValid(values);
  const j = i - days;
  const now = i >= 0 ? values![i] : null;
  const then = j >= 0 && ok(values?.[j]) ? values![j] : null;
  const abs = now !== null && then !== null ? now - then : null;
  return { now, then, thenDate: j >= 0 ? dates[j] ?? null : null, days, abs, pct: abs !== null && then ? (abs / then) * 100 : null };
}

/** 「與 5 個交易日前（9/17）相比」 */
export function basisText(d: Pick<Delta, 'days' | 'thenDate'>): string {
  if (!d.thenDate) return `與 ${d.days} 個交易日前相比（資料不足）`;
  return `與 ${d.days} 個交易日前（${Number(d.thenDate.slice(5, 7))}/${Number(d.thenDate.slice(8, 10))}）相比`;
}

// ------------------------------------------------------------------ 價量解讀（股價 × 融資，5 日方向）
export type PvKind = 'up_up' | 'up_down' | 'down_up' | 'down_down';
export interface PvLabel {
  kind: PvKind;
  /** 「價漲資增」 */
  label: string;
  /** 「散戶追價」 */
  tag: string;
  /** 一句中性說明 */
  note: string;
}

export const PV_LABELS: Record<PvKind, PvLabel> = {
  up_up: { kind: 'up_up', label: '價漲資增', tag: '散戶追價', note: '股價與融資同步增加，融資買盤跟進追價；融資增幅明顯大於股價時，籌碼較不安定。' },
  up_down: { kind: 'up_down', label: '價漲資減', tag: '籌碼沉澱', note: '股價上漲但融資減少，上漲不是由融資推動，信用籌碼相對沉澱。' },
  down_up: { kind: 'down_up', label: '價跌資增', tag: '散戶攤平', note: '股價下跌但融資增加，融資戶逢低承接或攤平；若續跌，融資追繳可能帶來賣壓。' },
  down_down: { kind: 'down_down', label: '價跌資減', tag: '融資退場', note: '股價與融資同步減少，融資部位退場，信用賣壓逐步宣洩。' },
};

/**
 * 依股價與融資餘額的 N 日方向（嚴格大於／小於 0）分成四種；任一方持平或缺資料 → null（不硬套標籤）。
 */
export function priceMarginLabel(priceChg: N, marginChg: N): PvLabel | null {
  if (!ok(priceChg) || !ok(marginChg) || priceChg === 0 || marginChg === 0) return null;
  const k = `${priceChg > 0 ? 'up' : 'down'}_${marginChg > 0 ? 'up' : 'down'}` as PvKind;
  return PV_LABELS[k];
}

// ------------------------------------------------------------------ 空方
/** 券資比 %＝融券餘額 ÷ 融資餘額 × 100（融資為 0 或缺值 → null）。 */
export function shortRatio(shortBal: N, marginBal: N): N {
  return ok(shortBal) && ok(marginBal) && marginBal > 0 ? (shortBal / marginBal) * 100 : null;
}

export function shortRatioHigh(ratio: N, cfg = uiConfig.credit): boolean {
  return ok(ratio) && ratio >= cfg.short_ratio_high;
}

// ------------------------------------------------------------------ 文字
const INT = numberFormat(0);
const F1 = numberFormat(1);
const F2 = numberFormat(2);

/** 「▲1,234 張（+3.2%）」；沒有資料「—」。 */
export function lotsDelta(d: Delta): string {
  if (d.abs === null) return '—';
  const arrow = d.abs > 0 ? '▲' : d.abs < 0 ? '▼' : '';
  const pct = d.pct === null ? '' : `（${d.pct > 0 ? '+' : d.pct < 0 ? '−' : ''}${F1.format(Math.abs(d.pct))}%）`;
  return `${arrow}${INT.format(Math.abs(Math.round(d.abs)))} 張${pct}`;
}

/** 百分點變化：「▲0.35 個百分點」 */
export function ppDelta(v: N): string {
  if (v === null) return '—';
  const arrow = v > 0.005 ? '▲' : v < -0.005 ? '▼' : '';
  return `${arrow}${F2.format(Math.abs(v))} 個百分點`;
}

/**
 * 外資持股比的一行（#5）：「69.20%」＋「▲0.35 百分點」／「持平」／「變化：資料累積中」。
 * 沒有 N 個交易日前的持股比時不能顯示持平的「—」（那是沒有資料，不是沒有變化）。
 */
export function foreignHoldLine(d: Delta): { value: string; change: string; dir: 'up' | 'down' | 'flat' | 'na' } | null {
  if (!ok(d.now)) return null;
  const value = `${F2.format(d.now)}%`;
  if (!ok(d.abs)) return { value, change: '變化：資料累積中', dir: 'na' };
  if (Math.abs(d.abs) < 0.005) return { value, change: '持平', dir: 'flat' };
  return { value, change: `${d.abs > 0 ? '▲' : '▼'}${F2.format(Math.abs(d.abs))} 百分點`, dir: d.abs > 0 ? 'up' : 'down' };
}

/**
 * 融資使用率＝融資餘額 ÷ 融資限額；取不到時說明原因。
 * 2026-10-02 健檢 #5：pipeline 已改用最近 5 個交易日內最後一筆有限額的資料補 margin_usage，所以還是 null 時不是「當日未公布」，
 * 而是這一檔不是融資標的，或官方根本沒有提供融資限額。
 */
export const MARGIN_USAGE_MISSING = '非融資標的或官方未提供融資限額';
export function marginUsageText(usage: N): { text: string; reason: string | null } {
  if (!ok(usage)) return { text: `—（${MARGIN_USAGE_MISSING}）`, reason: MARGIN_USAGE_MISSING };
  return { text: `${F1.format(usage)}%`, reason: null };
}

/**
 * 變化值缺值的原因（畫面上的「—」一律附原因）：沒有這個序列的資料／基準日（N 個交易日前）無資料／資料不足 N 日。
 */
export function deltaMissingReason(d: Delta, name = ''): string {
  if (d.now === null) return `沒有${name}資料`;
  if (d.then === null) return d.thenDate ? `${mdText(d.thenDate)} 無${name}資料` : `${name}資料不足 ${d.days} 日`;
  return '資料不足';
}

// ------------------------------------------------------------------ 個股頁彙整
export interface CreditInput {
  d: string[];
  /** 還原收盤（價量解讀用還原價，避免除權息當天被當成下跌） */
  adj: N[];
  mb: N[];
  sb: N[];
  /** 借券賣出餘額（張） */
  sbl?: N[];
  /** 外資持股比 % */
  qfii?: N[];
  /** 融資使用率 %（summary 的 margin_usage） */
  marginUsage?: N;
  /** 融券最後回補日 */
  lastCover?: string | null;
}

/** 「9/25」 */
function mdText(iso: string): string { return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`; }
const pctText = (v: N): string => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${F2.format(Math.abs(v))}%`);

/**
 * 不套用價量標籤的原因（2026-10-02 健檢 #5）：寫出是哪一邊、哪一天的資料缺、或哪一邊持平，不寫籠統的「持平或資料不足」。
 * 例：「股價 5 日 0.00%（持平）、融資 5 日 −6.40%」「融資 9/25 無資料」「股價資料不足 5 日」。
 */
export function pvReason(price: Delta, margin: Delta): string {
  const side = (name: string, d: Delta): string => {
    if (d.now === null) return `沒有${name}資料`;
    if (d.then === null) return d.thenDate ? `${name} ${mdText(d.thenDate)} 無資料` : `${name}資料不足 ${d.days} 日`;
    const flat = d.abs === 0 ? '（持平）' : '';
    const v = d.pct === null ? (name === '融資' ? lotsDelta(d) : '—') : pctText(d.pct);
    return `${name} ${d.days} 日 ${v}${flat}`;
  };
  return `${side('股價', price)}、${side('融資', margin)}`;
}

export interface CreditSummary {
  margin: { d5: Delta; d20: Delta; usage: N };
  /** label 為 null 時 reason 說明是哪一邊持平或缺哪一天的資料 */
  pv: { label: PvLabel | null; price: Delta; margin: Delta; reason: string | null };
  short: { bal: Delta; sbl: Delta; ratio: N; high: boolean; lastCover: string | null };
  foreign: { chg: Delta };
}

export function creditSummary(x: CreditInput, cfg = uiConfig.credit): CreditSummary {
  const [a, b] = cfg.compare_days;
  const mb5 = deltaOver(x.d, x.mb, a);
  const price = deltaOver(x.d, x.adj, cfg.pv_days);
  const mbPv = deltaOver(x.d, x.mb, cfg.pv_days);
  const sbNow = deltaOver(x.d, x.sb, a);
  const ratio = shortRatio(sbNow.now, mb5.now);
  return {
    margin: { d5: mb5, d20: deltaOver(x.d, x.mb, b), usage: x.marginUsage ?? null },
    pv: (() => { const label = priceMarginLabel(price.abs, mbPv.abs); return { label, price, margin: mbPv, reason: label ? null : pvReason(price, mbPv) }; })(),
    short: { bal: sbNow, sbl: deltaOver(x.d, x.sbl, a), ratio, high: shortRatioHigh(ratio, cfg), lastCover: x.lastCover ?? null },
    foreign: { chg: deltaOver(x.d, x.qfii, cfg.foreign_change_days) },
  };
}

/** 區塊標題的一句結論（問題由頁面給）。 */
export function creditAnswer(s: CreditSummary): string {
  if (s.margin.d5.now === null) return '沒有融資資料（非信用交易標的）';
  const pv = s.pv.label ? `${s.pv.label.label}（${s.pv.label.tag}）` : '價量不套用標籤';
  const d = s.margin.d5.pct;
  return d === null ? pv : `${pv}，融資 5 日 ${d >= 0 ? '+' : '−'}${F1.format(Math.abs(d))}%`;
}

export function shortAnswer(s: CreditSummary, cfg = uiConfig.credit): string {
  if (s.short.ratio === null && s.short.sbl.now === null) return '沒有融券與借券資料';
  const r = s.short.ratio === null ? '券資比 —' : `券資比 ${F1.format(s.short.ratio)}%`;
  return s.short.high ? `${r}，偏高（≥ ${cfg.short_ratio_high}%），留意軋空` : `${r}，空方壓力${s.short.ratio !== null && s.short.ratio < 5 ? '輕' : '一般'}`;
}
