/**
 * 風險試算（M2，2026-10-03）：依本金、每筆風險比例、ATR 停損距離算對應股數，並列連續跌停 1～3 日的情境。純函式，可測。
 * - 停損價 ＝ 參考價 − k × ATR14（k 由使用者選；ATR 以還原價算，再換成參考價的比例：ATR% × 參考價）。
 * - 股數沿用 sizing.positionSize（總資金 × 風險% ÷ 每股風險，整張捨去；零股模式回傳股數）。
 * - 連續跌停 n 日：隔日起每天都以 −10% 收盤且賣不掉，第 n 天的價格 ＝ 參考價 × 0.9ⁿ；虧損 ＝ (參考價 − 價格) × 股數，
 *   另列佔本金 % 與相對計畫風險的倍數（R）。這是壓力情境，不是預測。
 */
import { positionSize } from './sizing';

export interface RiskInput {
  capital: number;
  riskPct: number;
  oddLot: boolean;
  /** 參考價（最新收盤，未還原） */
  price: number | null;
  /** ATR14 ÷ 股價（%） */
  atrPct: number | null;
  /** ATR 倍數 */
  k: number;
}

export interface LimitDownRow { days: number; price: number; loss: number; lossPct: number; r: number | null }

export interface RiskResult {
  ok: boolean;
  reason: string | null;
  atr: number | null;
  stop: number | null;
  perShare: number | null;
  shares: number;
  lots: number;
  /** 實際承擔的風險金額（股數 × 每股風險） */
  riskAmount: number;
  /** 計畫風險上限（本金 × 風險%） */
  budget: number;
  positionValue: number;
  scenarios: LimitDownRow[];
}

export const LIMIT_DOWN = 0.1;

export function riskCalc(i: RiskInput): RiskResult {
  const budget = i.capital > 0 && i.riskPct > 0 ? (i.capital * i.riskPct) / 100 : 0;
  const empty = (reason: string): RiskResult => ({ ok: false, reason, atr: null, stop: null, perShare: null, shares: 0, lots: 0, riskAmount: 0, budget, positionValue: 0, scenarios: [] });
  if (i.price === null || !(i.price > 0)) return empty('沒有收盤價');
  if (i.atrPct === null || !(i.atrPct > 0)) return empty('ATR 不足 15 日');
  if (!(i.capital > 0) || !(i.riskPct > 0)) return empty('請在設定填入本金與每筆風險比例');
  const atr = (i.atrPct / 100) * i.price;
  const stop = i.price - i.k * atr;
  if (!(stop > 0)) return empty(`${i.k} 倍 ATR 已超過股價，停損距離無意義`);
  const sized = positionSize(i.capital, i.riskPct, i.price, stop, i.oddLot);
  const perShare = i.price - stop;
  const scenarios: LimitDownRow[] = [1, 2, 3].map((days) => {
    const price = i.price! * Math.pow(1 - LIMIT_DOWN, days);
    const loss = (i.price! - price) * sized.shares;
    return { days, price, loss, lossPct: i.capital > 0 ? (loss / i.capital) * 100 : 0, r: sized.riskAmount > 0 ? loss / sized.riskAmount : null };
  });
  return {
    ok: sized.shares > 0,
    reason: sized.shares > 0 ? null : '依風險上限不足 1 張，可改用零股模式',
    atr,
    stop,
    perShare,
    shares: sized.shares,
    lots: sized.lots,
    riskAmount: sized.riskAmount,
    budget,
    positionValue: sized.shares * i.price,
    scenarios,
  };
}
