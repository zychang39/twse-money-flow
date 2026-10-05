/** 與 pipeline/derive 輸出的 JSON 對應的型別。 */

export interface Meta {
  generated_at: string;
  /** M3.4 分段更新：目標交易日與各段狀態（done／late）、完成時間 */
  stages?: ({ date: string } & Partial<Record<'close' | 'insti' | 'credit', { status: string; at: string; waited: number }>>) | null;
  schedule?: Record<'close' | 'insti' | 'credit', { label: string; time: string }>;
  /** 週資料（集保大戶）：資料基準日（每週最後營業日）、公布日（次一日）、涉及的欄位 */
  weekly?: { data_date: string; published: string; fields: string[] } | null;
  market_date: string | null;
  demo: boolean;
  status: 'ok' | 'no_data';
  sources_failed: string[];
  /** 影響最新資料的異常來源（回補歷史失敗不算） */
  sources_affected?: string[];
  stocks?: number;
  /** v3：長歷史股價檔（stocks/{code}.hist.json）的檔數與最早日期；沒有時前端不嘗試載入 */
  long_history?: { files: number; first_date?: string | null };
  /** 有 ANTHROPIC_API_KEY 時產生 ai_summary.json */
  ai_summary?: boolean;
  /** 還原價事件總數（官方＋推估） */
  adjust_events?: number;
  /** 以價格跳空推估的還原事件（沒有任何官方事件可以解釋的跳空） */
  adjust_inferred?: InferredEvent[];
  /** E-02：pipeline 的交易日曆（證交所休市日曆＋臨時休市日）；前端依此判斷休市、落後交易日 */
  calendar?: { closed: string[]; years?: number[] };
  /** 2026-10-02 健檢：各資料集最新資料日（鍵名見 lib/asof.ts） */
  asof?: Partial<Record<string, string | null>>;
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
  /** U-02：最新交易日沒有成交時為最後成交日；有成交為 null */
  last_trade_date?: string | null;
  /** U-02：no_trade＝有掛牌但今日無成交；halted＝今日不在行情表（暫停交易、停牌）；正常為 null */
  trade_status?: 'no_trade' | 'halted' | null;
  composite?: number | null;
  chip?: number | null;
  momentum?: number | null;
  fundamental?: number | null;
  valuation?: number | null;
  /** stock 2026-10-03：量比（當日成交量 ÷ 前 20 個交易日平均量，分母不含當日）與 20 日均量（張） */
  vol_ratio?: number | null;
  vol20_lots?: number | null;
  [key: string]: unknown;
}

export interface Summary {
  date: string;
  columns: string[];
  rows: unknown[][];
}

/** 注意／處置（2026-10；只呈現交易所公告的事實與次數） */
export interface StockAttnPeriod { start: string; end: string; interval: string | null }
export interface StockAttn {
  count10: number;
  count30: number;
  /** 近 30 個營業日每次注意（新→舊） */
  days: { date: string; reason: string }[];
  /** 近一年處置（新→舊）；interval 例「5 分鐘」 */
  disposition: (StockAttnPeriod & { reason: string | null; measure?: string | null })[];
  /** 處置期間涵蓋最新資料日 */
  active: StockAttnPeriod | null;
  /** 已公告、尚未開始 */
  upcoming?: StockAttnPeriod | null;
}
export interface StockHistory {
  attn?: StockAttn;
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
  /** M1.2：官方產業 › 細產業 › 題材 */
  sectors?: StockSectors | null;
  /** M1.2：走勢相近（近 60 日日報酬相關係數最高的 10 檔）[代號, 名稱, 相關係數] */
  similar?: [string, string, number][];
  /** M1.3：均線斜率、間距、排列、ATR、52 週、對 0050／細產業 */
  trend?: StockTrend | null;
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
  /** M3.4：分段更新實測的公布時間（最近 20 次；5 分鐘粒度） */
  publish?: { median: string; earliest: string; latest: string; days: number } | null;
}
export interface Health {
  market_date: string | null;
  sources: HealthSource[];
  closed_days: string[];
  runs: { task: string; at: string; requests: number; ok: number; failed: string[]; pending: string[] }[];
  trading_days: number;
  first_date: string | null;
  /** 2026-10-02 健檢：各資料集最新資料日（鍵名見 lib/asof.ts） */
  asof?: Partial<Record<string, string | null>>;
  /** 回補範圍（manifest coverage）：來源 id → { start, end } */
  coverage?: Record<string, { start?: string; end?: string }>;
  /** 集保全市場回補進度（manifest holders_backfill） */
  backfill?: { codes?: number; done?: number; total?: number; remaining?: number; eta?: string; oldest_week?: string; weeks?: number; started_at?: string; updated_at?: string; per_query_sec?: number };
  /** 月營收等依月份回補的進度：key → 已回補的月份 */
  backfilled?: Record<string, string[]>;
}

// ---------- lists.json（系統清單，依規則產生，非推薦） ----------
export interface HotItem {
  code: string; name: string | null; rs_percentile: number; value_rank: number; reason: string;
  /** M2（2026-10-03）：實際數值與標記（處置／注意股、20 日乖離 > 20%、漲停、流動性不足） */
  value_million?: number | null; change_pct?: number | null; ma20_gap?: number | null; marks?: string[];
}
export interface Lists {
  date: string;
  hot_momentum: {
    label: string;
    rule: { value_rank_top: number; min_rs_percentile: number; max_warn_flags: number; max_danger_flags: number; size: number; exclude_etf: boolean; mark_bias_above?: number; mark_limit_up_pct?: number; mark_low_value_million?: number };
    items: HotItem[];
  };
}

// ---------- market.json ----------
export type LightStateT = 'green' | 'yellow' | 'red' | 'gray';
export interface MarketLight { id: string; label: string; state: LightStateT; value: string; basis: string; /** 外資期貨淨未平倉：近 250 個交易日百分位（0–100） */ pct250?: number | null; /** 2026-10：右欄短數值（負號 U+2212；資料不足為「—」） */ short?: string; /** 2026-10：副資訊一行（資料不足時為原因） */ detail?: string }
export interface Sector { industry: string; count: number; up: number; down: number; foreign_1: number | null; trust_1: number | null; [k: string]: string | number | null }
/** 主動式 ETF 持股日變動分類（M2 2026-10-03）：new 新增（前次沒有）、add 加碼、reduce 減碼、exit 剔除（本次 0 股） */
export type EtfKind = 'new' | 'add' | 'reduce' | 'exit';
export const ETF_KIND_LABEL: Record<EtfKind, string> = { new: '新增', add: '加碼', reduce: '減碼', exit: '剔除' };
export const ETF_KINDS: EtfKind[] = ['new', 'add', 'reduce', 'exit'];
export interface EtfMove { code: string; name: string; etfs: number; net_shares: number; net_value: number | null; detail: string; /** 兩檔以上同向才算跨檔 */ cross?: boolean; /** 同向的 ETF 全是新增 → new、全是剔除 → exit，否則 add／reduce；舊版資料沒有 */ kind?: EtfKind }
/** §7（etf 2026-10-03）：主動式 ETF 跨檔排行的新契約 */
export type EtfSortMetric = 'value' | 'pct_avg20' | 'pct_mcap';
export interface EtfCoverage { covered: number; total: number; holdings_date: string | null; issuers: number; issuer_names?: string[]; etf_codes?: string[]; implemented_issuers?: number; implemented_etfs?: number; lagging?: { code: string; date: string }[]; units_missing?: string[] }
export interface EtfItemEtf { code: string; name: string; /** 扣除申購買回後的超額股數 */ d_shares: number | null; d_shares_raw?: number | null; /** 權重變化（百分點） */ d_weight: number | null; kind?: EtfKind; date?: string; value_yi?: number | null }
/** value_yi／pct_avg20／pct_mcap 帶正負號（減碼為負）；已過濾 |value_yi| < 0.3 */
export interface EtfItem { code: string; name: string; dir: 'add' | 'reduce'; kind: EtfKind; value_yi: number | null; pct_avg20: number | null; pct_mcap: number | null; etfs_same_dir: number; etfs: EtfItemEtf[] }
export interface EtfValidationRow { metric: EtfSortMetric; h: number; vs: '0050' | 'ew'; excess: number | null; t: number | null; n: number; days?: number }
export interface EtfValidation { verified: boolean; metric: EtfSortMetric | null; n: number; period: [string | null, string | null]; rows: EtfValidationRow[]; reason?: string; rule?: string; holdings_days?: number }
export interface TurnoverCell { value: number | null; ma20_ratio: number | null }
export interface TurnoverDay { date: string; total: TurnoverCell; twse: TurnoverCell; tpex: TurnoverCell }
export interface MarketData {
  date: string;
  taiex: { close: number | null; change: number | null; ma240: number | null };
  /** 市場寬度（M2，2026-10-03）：漲跌家數（官方漲跌）；站上 20／60／240 日線比例（普通股、還原價，分母 n_maN）；創 60 日新高／新低家數 */
  breadth: { up: number; down: number; flat: number; n?: number; /** 2026-10 改版：52 週（250 日）收盤新高／新低家數與差 */ high52?: number | null; low52?: number | null; net52?: number | null; n52?: number; above_ma20_pct?: number | null; above_ma60_pct?: number | null; above_ma240_pct?: number | null; n_ma20?: number; n_ma60?: number; n_ma240?: number; high60?: number | null; low60?: number | null };
  /** M2：最近 120 個交易日的站上 60 日線比例（%）與 52 週新高 − 新低家數 */
  breadth_hist?: { dates: string[]; above_ma60: (number | null)[]; net52: (number | null)[] };
  /** 三大法人買賣超金額（上市＋上櫃）；est＝當日取不到官方金額、以張數×收盤估算 */
  flows: { date: string; foreign: number | null; trust: number | null; dealer: number | null; est?: boolean }[];
  flows_source?: string;
  /** M2（2026-10-03）：上市＋上櫃每日成交金額（億元）與 ÷ 前 20 日平均倍數（分母不含當日；不足 20 日為 null） */
  turnover?: TurnoverDay[];
  sectors: Sector[];
  /** futures_series（M2 2026-10-03）：外資台指期淨未平倉（大台約當口數），近 60 個交易日 */
  env?: { summary: string; lights: MarketLight[]; futures_series?: { date: string; net: number | null }[]; validation?: import('../lib/envState').EnvValidation | null };
  /** retail：小台（mtx）與微台（tmf）散戶多空比 %；pc_series（M2 2026-10-03）：臺指選擇權 P/C 比 %（pc＝未平倉量比、vol＝成交量比），只呈現不判定 */
  temperature?: { lights: MarketLight[]; retail?: { date: string; mtx: number | null; tmf: number | null }[]; pc_series?: { date: string; pc: number | null; vol: number | null }[] };
  etf_ranking?: { date: string | null; add: EtfMove[]; reduce: EtfMove[]; status?: string; /** §7 起為物件；舊資料為字串 */ coverage?: string | EtfCoverage; coverage_text?: string; covered?: number; total?: number; /** 變動分類筆數（ETF × 股票；M2 2026-10-03；§7 起為扣除申購買回後的判定） */ kinds?: Partial<Record<EtfKind, number>>; /** 修正前（只看股數增減）的筆數 */ kinds_raw?: Partial<Record<EtfKind, number>>; items?: EtfItem[]; sort_default?: EtfSortMetric; validation?: EtfValidation; unverified_label?: string | null; method?: string };
  active_etfs?: { code: string; name: string; close: number; value_million_20d: number | null; has_holdings?: boolean; change_pct?: number | null }[];
}

// ---------- index.json ----------
export interface IndexData { dates: string[]; series: Record<string, (number | null)[]> }
/** 首頁 1D（M2，2026-10-03）：最新一天的加權指數盤中走勢（證交所每 5 秒統計，pipeline 降採樣成每分鐘一點）。 */
export interface IntradayData {
  date: string; name: string; prev_close: number | null; prev_date: string | null; source: string; points: { t: string; v: number }[];
  /** 2026-10 改版：備援來源（證交所取不到時） */
  fallback?: boolean;
  /** 用了備援的日期（可能只有 1W 的較早日子） */
  fallback_dates?: string[];
  /** 最近交易日的開高低收 */
  ohlc?: { o: number | null; h: number | null; l: number | null; c: number | null };
  /** 最近 ≤5 個交易日的 5 分鐘走勢（舊→新），1W 用 */
  days?: { date: string; prev_close: number | null; points: { t: string; v: number }[] }[];
}
/** 個股 5 分 K（Yahoo Finance，非官方）：bars＝[時間 HH:MM, 開, 高, 低, 收, 量（股）] */
/** 個股 5 分 K（每檔一個小檔；M1.1：每一檔有個股頁的股票都有，當日無成交 no_trade、資料源缺漏 missing）。 */
export interface StockIntraday { code: string; date: string; source: string; days: { date: string; prev_close: number | null; bars: [string, number | null, number | null, number | null, number | null, number | null][]; no_trade?: boolean; missing?: boolean }[] }
/** missing＝來源無資料、failed＝抓取失敗、not_fetched＝還沒抓到（2026-10-06 分開；舊版只有 missing） */
export interface StockIntradayIndex { date: string; source: string; codes: string[]; no_trade?: string[]; missing?: string[]; failed?: string[]; not_fetched?: string[]; kbar_dates?: string[] }

// ---------------------------------------------------------------- M1.2 族群三層
export type SectorLayer = 'official' | 'fine' | 'theme' | 'chain';
export interface SectorStats {
  members: number;
  live: number;
  med: Record<'1M' | '3M' | '6M' | '12M', number | null>;
  rank: number | null;
  of: number | null;
  rank_prev: number | null;
  /** 成員不足 5 檔：名次以這個上層計算 */
  merged: string | null;
  above60: number | null;
  high60: number;
  insti5: number | null;
  insti20: number | null;
  new: number | null;
}
export interface SectorRow extends SectorStats { id: string; layer: SectorLayer; name: string; path: string[]; parent: string | null; streams: boolean }
export interface SectorsIndex {
  date: string;
  min_ranked: number;
  rank_window: string;
  unassigned: string[];
  groups: SectorRow[];
  stock_cols: string[];
  /** 代號 → [細產業 id[], 官方產業 id, 題材 id[], r1m, r3m, r6m, rs, above60, high60, inst20（法人 20 日買超 ÷ 成交金額 %，M4 起）] */
  stocks: Record<string, [string[], string | null, string[], number | null, number | null, number | null, number | null, number | null, number | null, (number | null)?]>;
}
export interface SectorMember { code: string; name: string; close: number | null; chg: number | null; chg_pct?: number | null; rs: number | null; r1m: number | null; r3m: number | null; stream: string | null; new?: boolean; inst20?: number | null }
export interface SectorDetail {
  id: string; layer: SectorLayer; name: string; path: string[]; parent: string | null; parent_name: string | null;
  basis: string; updated: string; date: string;
  stats: SectorStats;
  members: SectorMember[];
  streams: Record<string, string[]>;
  index: { dates: string[]; values: (number | null)[] };
  history: { dates: string[]; rank?: (number | null)[]; breadth?: (number | null)[]; median3m?: (number | null)[] };
}
export interface StockSectorItem {
  id: string; name: string; path: string[]; layer: SectorLayer; stream: string | null;
  rank: number | null; of: number | null; rank_prev: number | null; merged: string | null; merged_name: string | null;
  med3m: number | null; members: number | null; pos: number | null; pos_of: number;
}
export interface StockSectors { date: string; official: StockSectorItem | null; fine: StockSectorItem[]; themes: StockSectorItem[] }

// ---------------------------------------------------------------- M1.3 個股衍生指標
export interface TrendMa { v: number | null; bias: number | null; slope: number | null; slope_prev: number | null }
export interface StockTrend {
  date: string;
  close: number | null;
  ma: Record<'20' | '60' | '240', TrendMa>;
  gap: { now: number | null; prev: number | null };
  align: { state: 'bull' | 'bear' | 'mixed' | null; days: number };
  atr: { v: number | null; pct: number | null; rank: number | null };
  bias_atr: number | null;
  y52?: { hi: number | null; hi_date: string; lo: number | null; lo_date: string; from_hi: number | null; from_lo: number | null; at_high: boolean; days: number };
  d60?: { hi: number | null; lo: number | null };
  new_high60_20d: number;
  vs?: Record<'1M' | '3M' | '6M' | '12M', { ret: number | null; bench: number | null; fine: number | null; vs_bench: number | null; vs_fine: number | null }>;
  series: { dates: string[]; close: (number | null)[]; ma20: (number | null)[]; ma60: (number | null)[]; ma240: (number | null)[]; gap: (number | null)[] };
}

// ---------------------------------------------------------------- M1.5 策略期間檢視（strategy/{id}.json）
export type BenchKey = 'ew' | '0050' | 'tr' | '00631L';
export interface CardBench { excess: number | null; t: number | null; win: number | null; median: number | null; n: number }
export type PeriodCard = { n: number } & Record<BenchKey, CardBench>;
export interface PerfBrief { cagr: number | null; sharpe: number | null; mdd: number | null; total: number | null }
export interface Quant { p5: number | null; p50: number | null; p95: number | null }
export interface PeriodView {
  from: string; to: string; days: number;
  card: PeriodCard;
  multi: Record<string, PeriodCard>;
  port: PerfBrief;
  bench: Partial<Record<'tr' | '0050' | '00631L', PerfBrief>>;
  random: { cagr?: Quant; sharpe?: Quant; mdd?: Quant; runs?: number; band?: { p5: number[]; p50: number[]; p95: number[] }; dates?: string[] };
  weekly?: { dates: string[]; port: number[]; tr?: (number | null)[]; '0050'?: (number | null)[]; '00631L'?: (number | null)[]; held?: string[][]; drawdown?: number[] };
  curve?: Partial<Record<BenchKey, { mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }>>;
}
export interface YearRow { year: string; n: number; excess: Record<BenchKey, number | null>; port: number | null; bench: Partial<Record<'tr' | '0050' | '00631L', number | null>> }
export interface StrategyPack {
  start: string; end: string; horizon: number; slots: number;
  periods: Record<string, PeriodView>;
  years: YearRow[];
  signals: { n: number; signal?: string[]; entry?: (string | null)[]; code?: string[]; name?: string[] } & Record<string, unknown>;
  monthly: { month?: string[]; n?: number[] } & Partial<Record<BenchKey, (number | null)[]>>;
  rolling3y: { month?: string[] } & Partial<Record<BenchKey, { mean: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }>>;
  screen: { date: string; cols: string[]; rows: [string, string, number, number | null][]; new: string[] };
  exits?: Record<string, { date: string[]; code: string[]; net: (number | null)[]; exc_0050: (number | null)[] }>;
}
export const TAIEX = '發行量加權股價指數';
export const TAIEX_TR = '發行量加權股價報酬指數';
export const TPEX = '櫃買指數';

/** v3：長歷史股價（收盤回補 10 年；日期、收盤、還原因子），5Y／10Y／ALL 才載入。 */
export interface LongHistory {
  code: string;
  d: string[];
  c: (number | null)[];
  af: number[];
}

/** U-01：沒有個股檔的證券（近 20 個交易日無成交） */
export interface InactiveRow { code: string; name: string; market: 'twse' | 'tpex' | null; last_trade_date: string | null; status: 'halted' | 'inactive' }
export interface InactiveList { date: string; rows: InactiveRow[] }
