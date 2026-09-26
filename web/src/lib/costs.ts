/** 交易成本（與 pipeline 回測相同規則；參數來自 config/costs.yml，設定頁可覆寫折扣與最低手續費）。 */
import { costsConfig } from './config';

export interface CostSettings {
  discount: number;
  minimumEnabled: boolean;
}

export const DEFAULT_COSTS: CostSettings = {
  discount: costsConfig.commission.discount,
  minimumEnabled: costsConfig.commission.minimum_enabled,
};

export function commission(amount: number, s: CostSettings = DEFAULT_COSTS): number {
  const fee = amount * costsConfig.commission.rate * s.discount;
  const floor = s.minimumEnabled ? costsConfig.commission.minimum : 0;
  return Math.floor(Math.max(fee, amount > 0 ? floor : 0));
}

export function tax(amount: number, isEtf: boolean): number {
  return Math.floor(amount * (isEtf ? costsConfig.tax.etf : costsConfig.tax.stock));
}

export function isEtfCode(code: string): boolean {
  return code.startsWith('00');
}

/** 一買一賣的淨損益與淨報酬率。 */
export function roundTrip(entry: number, exit: number, shares: number, code: string, s: CostSettings = DEFAULT_COSTS) {
  const buy = entry * shares;
  const sell = exit * shares;
  const buyFee = commission(buy, s);
  const sellFee = commission(sell, s);
  const sellTax = tax(sell, isEtfCode(code));
  const pnl = sell - sellFee - sellTax - (buy + buyFee);
  return { pnl, ret: pnl / (buy + buyFee), costs: buyFee + sellFee + sellTax };
}
