/** 與 pipeline/derive 輸出的 JSON 對應的型別。 */

export interface Meta {
  generated_at: string;
  market_date: string | null;
  demo: boolean;
  status: 'ok' | 'no_data';
  sources_failed: string[];
  stocks?: number;
}

export interface Factor {
  id: string;
  raw: number | null;
  score: number | null;
  detail?: string;
}
export interface ScoreDetail {
  composite: number | null;
  categories: Record<string, { score: number | null; factors: Factor[] }>;
}

export interface Flag {
  id: string;
  label: string;
  level: 'warn' | 'danger';
  detail?: string;
}

/** summary.json 的一列（轉為物件後）。欄位名稱同 pipeline 的 SUMMARY_COLUMNS。 */
export interface StockRow {
  code: string;
  name: string;
  market: 'twse' | 'tpex';
  industry: string | null;
  close: number | null;
  change: number | null;
  change_pct: number | null;
  volume_lots: number | null;
  value_million: number | null;
  foreign_net_lots: number | null;
  trust_net_lots: number | null;
  dealer_net_lots: number | null;
  foreign_streak: number | null;
  trust_streak: number | null;
  foreign_net_5d: number | null;
  trust_net_5d: number | null;
  margin_balance: number | null;
  margin_change: number | null;
  short_balance: number | null;
  pe: number | null;
  pb: number | null;
  dividend_yield: number | null;
  flags: Flag[];
  composite?: number | null;
  chip?: number | null;
  momentum?: number | null;
  fundamental?: number | null;
  valuation?: number | null;
  [key: string]: unknown;
}

export interface Summary {
  date: string;
  columns: string[];
  rows: unknown[][];
}

export interface StockHistory {
  code: string;
  name: string;
  market: string;
  industry: string | null;
  shares: number | null;
  d: string[];
  o: (number | null)[];
  h: (number | null)[];
  l: (number | null)[];
  c: (number | null)[];
  v: (number | null)[];
  val: (number | null)[];
  af: number[];
  fn: (number | null)[];
  tn: (number | null)[];
  dn: (number | null)[];
  mb: (number | null)[];
  sb: (number | null)[];
  pe: (number | null)[];
  pb: (number | null)[];
  dy: (number | null)[];
  metrics: Record<string, unknown>;
  scores?: ScoreDetail;
  [key: string]: unknown;
}

export interface HealthSource {
  id: string;
  label: string;
  tier: string;
  market: string;
  frequency: string;
  verified: string;
  last_success: string | null;
  last_status: string | null;
  last_message: string | null;
  last_attempt: string | null;
  rows: number | null;
  lag_days: number | null;
  consecutive_failures: number;
}
export interface Health {
  market_date: string | null;
  sources: HealthSource[];
  closed_days: string[];
  runs: { task: string; at: string; requests: number; ok: number; failed: string[]; pending: string[] }[];
  trading_days: number;
  first_date: string | null;
}
