/** 與 pipeline/derive 輸出的 JSON 對應的型別。 */

export interface Meta {
  generated_at: string;
  market_date: string | null;
  demo: boolean;
  status: 'ok' | 'no_data';
  sources_failed: string[];
  /** 影響最新資料的異常來源（回補歷史失敗不算） */
  sources_affected?: string[];
  stocks?: number;
  /** 有 ANTHROPIC_API_KEY 時產生 ai_summary.json */
  ai_summary?: boolean;
  /** 還原價事件總數（官方＋推估） */
  adjust_events?: number;
  /** 以價格跳空推估的還原事件（沒有任何官方事件可以解釋的跳空） */
  adjust_inferred?: InferredEvent[];
}

export interface InferredEvent { date: string; code: string; name: string; factor: number }

export interface AiSummary { date: string; lines: string[]; model: string; generated_at: string }

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
  /** 失敗是否影響最新資料（每日型：落後才算；回補歷史日期失敗不影響） */
  affects_latest?: boolean;
  /** 格式變動警告（欄位改名、缺少選用欄位…）；有值＝相容模式 */
  format_warnings?: string[];
  format_warning_date?: string | null;
}
export interface Health {
  market_date: string | null;
  sources: HealthSource[];
  closed_days: string[];
  runs: { task: string; at: string; requests: number; ok: number; failed: string[]; pending: string[] }[];
  trading_days: number;
  first_date: string | null;
}

// ---------- lists.json（系統清單，依規則產生，非推薦） ----------
export interface HotItem { code: string; name: string | null; rs_percentile: number; value_rank: number; reason: string }
export interface Lists {
  date: string;
  hot_momentum: {
    label: string;
    rule: { value_rank_top: number; min_rs_percentile: number; max_warn_flags: number; max_danger_flags: number; size: number; exclude_etf: boolean };
    items: HotItem[];
  };
}

// ---------- market.json ----------
export type LightStateT = 'green' | 'yellow' | 'red' | 'gray';
export interface MarketLight { id: string; label: string; state: LightStateT; value: string; basis: string }
export interface Sector { industry: string; count: number; up: number; down: number; foreign_1: number | null; trust_1: number | null; [k: string]: string | number | null }
export interface EtfMove { code: string; name: string; etfs: number; net_shares: number; net_value: number | null; detail: string }
export interface MarketData {
  date: string;
  taiex: { close: number | null; change: number | null; ma240: number | null };
  breadth: { up: number; down: number; flat: number };
  flows: { date: string; foreign: number | null; trust: number | null; dealer: number | null }[];
  sectors: Sector[];
  env?: { summary: string; lights: MarketLight[] };
  temperature?: { lights: MarketLight[]; retail?: { date: string; mtx: number | null; tmf: number | null }[] };
  etf_ranking?: { date: string | null; add: EtfMove[]; reduce: EtfMove[]; status?: string; coverage?: string };
  active_etfs?: { code: string; name: string; close: number; value_million_20d: number | null }[];
}

// ---------- index.json ----------
export interface IndexData { dates: string[]; series: Record<string, (number | null)[]> }
export const TAIEX = '發行量加權股價指數';
export const TAIEX_TR = '發行量加權股價報酬指數';
export const TPEX = '櫃買指數';
