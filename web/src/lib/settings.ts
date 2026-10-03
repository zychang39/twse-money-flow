import { thresholds } from './config';

export interface PortfolioSettings { capital: number; riskPct: number; oddLot: boolean }
export const DEFAULT_PORTFOLIO: PortfolioSettings = { capital: 1_000_000, riskPct: Number(thresholds.portfolio.default_risk_pct), oddLot: false };

/** 每筆風險上限（金額）＝本金 × 每筆風險 %（設定 → 部位；流程頁進場環、合規交易用）。設定缺漏時用預設值。 */
export function riskLimitOf(p: Partial<PortfolioSettings> | null | undefined): number {
  const capital = Number(p?.capital);
  const riskPct = Number(p?.riskPct);
  const c = Number.isFinite(capital) && capital > 0 ? capital : DEFAULT_PORTFOLIO.capital;
  const r = Number.isFinite(riskPct) && riskPct > 0 ? riskPct : DEFAULT_PORTFOLIO.riskPct;
  return (c * r) / 100;
}
