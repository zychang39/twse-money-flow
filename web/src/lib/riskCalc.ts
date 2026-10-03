/**
 * 風險試算（M2，2026-10-03；stock 2026-10-03 修訂）：依本金、每筆風險比例、ATR 停損距離算對應股數，並列連續跌停 1～3 日的情境。純函式，可測。
 * - 價格基準一律是原始價：參考價＝最新收盤（未還原）；ATR14 以還原價計算後換回最新原始價基準（÷ 最新還原因子，
 *   lib/stockFacts.volatilityFacts），兩者同一基準，停損價＝參考價 − k × ATR。
 * - 股數沿用 sizing.positionSize（總資金 × 風險% ÷ 每股風險）。整張模式算出 0 張但風險上限足夠買 1 股以上時，
 *   自動改用零股計算（mode＝'odd'），顯示股數與部位金額，不整表「—」。
 * - 部位佔本金 %＝股數 × 參考價 ÷ 本金。超過 100% 只標示（overCapital），不改股數。
 * - 連續跌停 n 日：每天以前一日價格 × 0.9 再依升降單位無條件進位（跌停價不低於 −10%），且賣不掉；
 *   虧損＝(參考價 − 價格) × 股數，另列佔本金 % 與相對計畫風險的倍數（R）。這是壓力情境，不是預測。
 * - 停損價相對一日跌停價的位置：above＝停損價高於一日跌停價（單日跌停的價格範圍內會觸及停損）；
 *   below＝停損價低於一日跌停價（單日最多跌到跌停價，要連續 limitDaysToStop 日跌停才觸及）；equal＝相同。
 */
import { positionSize } from './sizing';

export interface RiskInput {
  capital: number;
  riskPct: number;
  oddLot: boolean;
  /** 參考價（最新收盤，未還原） */
  price: number | null;
  /** ATR14（原始價基準，元）；優先使用 */
  atr?: number | null;
  /** ATR14 ÷ 股價（%）；沒有 atr 時用 atrPct × 參考價 */
  atrPct?: number | null;
  /** ATR 倍數 */
  k: number;
  /** ETF 的升降單位不同（50 元以下 0.01、以上 0.05） */
  etf?: boolean;
}

export interface LimitDownRow { days: number; price: number; perShare: number; loss: number; lossPct: number; r: number | null }

export type StopVsLimit = 'above' | 'below' | 'equal';

export interface RiskResult {
  ok: boolean;
  reason: string | null;
  atr: number | null;
  stop: number | null;
  perShare: number | null;
  /** lot＝整張；odd＝零股（使用者設定零股模式，或整張不足 1 張時自動改用） */
  mode: 'lot' | 'odd';
  /** 整張不足 1 張而自動改用零股 */
  autoOdd: boolean;
  shares: number;
  lots: number;
  /** 實際承擔的風險金額（股數 × 每股風險） */
  riskAmount: number;
  /** 計畫風險上限（本金 × 風險%） */
  budget: number;
  positionValue: number;
  /** 部位佔本金 % */
  positionPct: number | null;
  overCapital: boolean;
  scenarios: LimitDownRow[];
  /** 一日跌停價（參考價 × 0.9，依升降單位進位） */
  limitDown1: number | null;
  stopVsLimit: StopVsLimit | null;
  /** 連續跌停幾日的價格才會 ≤ 停損價（最多算到 10 日；超過為 null） */
  limitDaysToStop: number | null;
}

export const LIMIT_DOWN = 0.1;

/** 升降單位（臺灣證券交易所／櫃買中心）：股票 10／50／100／500／1000 元分段；ETF 50 元以下 0.01、以上 0.05。 */
export function tickSize(price: number, etf = false): number {
  if (etf) return price < 50 ? 0.01 : 0.05;
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

/** 跌停價：前一日價格 × 0.9，依該價位的升降單位無條件進位（跌幅不超過 10%）。 */
export function limitDownPrice(prev: number, etf = false): number {
  const raw = prev * (1 - LIMIT_DOWN);
  const t = tickSize(raw, etf);
  return Math.round(Math.ceil(raw / t - 1e-9) * t * 100) / 100;
}

export function riskCalc(i: RiskInput): RiskResult {
  const budget = i.capital > 0 && i.riskPct > 0 ? (i.capital * i.riskPct) / 100 : 0;
  const empty = (reason: string): RiskResult => ({
    ok: false, reason, atr: null, stop: null, perShare: null, mode: i.oddLot ? 'odd' : 'lot', autoOdd: false, shares: 0, lots: 0,
    riskAmount: 0, budget, positionValue: 0, positionPct: null, overCapital: false, scenarios: [], limitDown1: null, stopVsLimit: null, limitDaysToStop: null,
  });
  if (i.price === null || !(i.price > 0)) return empty('沒有收盤價');
  const price = i.price;
  const atr = i.atr !== null && i.atr !== undefined && i.atr > 0 ? i.atr : i.atrPct !== null && i.atrPct !== undefined && i.atrPct > 0 ? (i.atrPct / 100) * price : null;
  if (atr === null) return empty('ATR 不足 15 日');
  if (!(i.capital > 0) || !(i.riskPct > 0)) return empty('請在設定填入本金與每筆風險比例');
  const stop = price - i.k * atr;
  if (!(stop > 0)) return empty(`${i.k} 倍 ATR 已超過股價，停損距離無意義`);
  let sized = positionSize(i.capital, i.riskPct, price, stop, i.oddLot);
  let mode: 'lot' | 'odd' = i.oddLot ? 'odd' : 'lot';
  let autoOdd = false;
  if (!i.oddLot && sized.shares === 0) {
    const odd = positionSize(i.capital, i.riskPct, price, stop, true);
    if (odd.shares > 0) { sized = odd; mode = 'odd'; autoOdd = true; }
  }
  const perShare = price - stop;
  const scenarios: LimitDownRow[] = [];
  let p = price;
  for (let days = 1; days <= 3; days++) {
    p = limitDownPrice(p, i.etf);
    const loss = (price - p) * sized.shares;
    scenarios.push({ days, price: p, perShare: price - p, loss, lossPct: (loss / i.capital) * 100, r: sized.riskAmount > 0 ? loss / sized.riskAmount : null });
  }
  const limitDown1 = scenarios[0].price;
  const eps = 1e-9;
  const stopVsLimit: StopVsLimit = Math.abs(stop - limitDown1) < eps ? 'equal' : stop > limitDown1 ? 'above' : 'below';
  let limitDaysToStop: number | null = null;
  let q = price;
  for (let d = 1; d <= 10; d++) {
    q = limitDownPrice(q, i.etf);
    if (q <= stop + eps) { limitDaysToStop = d; break; }
  }
  const positionValue = sized.shares * price;
  return {
    ok: sized.shares > 0,
    reason: sized.shares > 0 ? null : '風險上限低於 1 股的停損距離',
    atr,
    stop,
    perShare,
    mode,
    autoOdd,
    shares: sized.shares,
    lots: sized.lots,
    riskAmount: sized.riskAmount,
    budget,
    positionValue,
    positionPct: (positionValue / i.capital) * 100,
    overCapital: positionValue > i.capital,
    scenarios,
    limitDown1,
    stopVsLimit,
    limitDaysToStop,
  };
}

/** 「停損價高於一日跌停價(90.00)」／「停損價低於一日跌停價(90.00)，連續 2 日跌停才觸及」（與數字相鄰的括號用半形） */
export function stopVsLimitText(r: Pick<RiskResult, 'stopVsLimit' | 'limitDown1' | 'limitDaysToStop'>, fmt: (v: number) => string = (v) => v.toFixed(2)): string {
  if (r.stopVsLimit === null || r.limitDown1 === null) return '';
  const lim = `一日跌停價(${fmt(r.limitDown1)})`;
  if (r.stopVsLimit === 'equal') return `停損價等於${lim}`;
  if (r.stopVsLimit === 'above') return `停損價高於${lim}`;
  return `停損價低於${lim}${r.limitDaysToStop ? `，連續 ${r.limitDaysToStop} 日跌停才觸及` : ''}`;
}
