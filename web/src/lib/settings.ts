import { thresholds } from './config';

export interface PortfolioSettings { capital: number; riskPct: number; oddLot: boolean }
export const DEFAULT_PORTFOLIO: PortfolioSettings = { capital: 1_000_000, riskPct: Number(thresholds.portfolio.default_risk_pct), oddLot: false };
