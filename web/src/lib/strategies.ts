/** 策略庫（M2）：strategies.json 的型別與顯示用的純函式。清單依規則產生，非推薦。 */
import type { PortfolioStats, TradeStats, LeverageRules } from './leverage';

export interface ExitRow { rule: string; param: string; label: string; chosen: boolean; n: number; ev: number | null; exc_idx: number | null; win: number | null; hold: number | null; mae: number | null; locked: number }

export interface StrategyItem {
  id: string;
  test: string;
  label: string;
  subtitle: string;
  verdict: string;
  enabled: boolean;
  reasons: string[];
  env: { dim: string; side: string; label: string; today: boolean } | null;
  param?: string | null;
  definition?: string;
  coverage?: import('./evidence').Coverage;
  data_start?: string | null;
  signal_start?: string | null;
  signal_end?: string | null;
  h?: Record<string, { n?: number; mean_excess?: number | null; t?: number | null; bench?: Record<string, { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null } | null> }>;
  years?: Record<string, number | null>;
  env_stats?: Record<string, { on: number | null; off: number | null }>;
  t?: number | null;
  mean_excess?: number | null;
  n?: number;
  note?: string;
  health?: {
    status: string; recent: number | null; recent_n: number; recent_t: number | null; since: string | null;
    /** 2026-10-03：長期平均超額（相對同日等權）；舊資料為數字 */
    long: { excess: number | null } | number | null;
    /** 2026-10-03：近 60 個交易日已出場的去重事件 */
    recent60?: { excess: number | null; n: number; since?: string };
  };
  today?: { code: string; name: string; basis?: { label: string; value: number | null; unit: string }[] }[];
  /** 今日 0 檔的原因（不留白） */
  today_note?: string | null;
  exit?: { rule: string; param: string; label: string; stats: Partial<ExitRow>; alternatives: ExitRow[] };
  trades?: TradeStats & { n: number; mean_net: number | null; win: number | null; hold: number | null; yearly: Record<string, { n: number; mean_net: number | null; exc_idx: number | null; win: number | null }> };
  portfolio?: Record<string, PortfolioStats & { yearly?: Record<string, number | null>; total?: number | null }>;
  curve?: {
    dates: string[]; equity: number[]; bench: (number | null)[]; etf?: Record<string, (number | null)[]>; slots?: number; missing?: Record<string, string>;
    /** 2026-10-03 累積超額曲線摘要（完整序列在 evidence/{test}.json） */
    excess?: CurveBrief;
  };
  /** v3 M2：事件對四種基準的超額（判定仍以等權為準） */
  bench?: Record<BenchKey, BenchStat | null>;
  t_0050?: number | null;
  large_cap?: string | null;
  delist?: import('./evidence').EvidenceRow['delist'];
  hindsight?: import('./evidence').Hindsight;
  /** v3 M2-3：5 檔組合 vs (b)(c)(d) 同期 */
  compare?: BenchCompare;
  /** 2026-10-01 精簡清單：有效性排名（1 最前）、校正後 t、每月觸發數、精簡規則的處置理由；波段策略另有 swing 區塊 */
  rank?: number | null;
  t_corr?: number | null;
  per_month?: number | null;
  selection?: {
    score?: number | null; reasons?: string[]; status?: string; family?: string; registered?: boolean;
    /** 2026-10-03：5 檔選股規則（預先指定）與 200 次隨機排序模擬 */
    rule_text?: string;
    random?: RandomSim | null;
    spec?: { cagr: number | null; mdd: number | null };
  } | null;
  registered?: boolean;
  kind?: 'swing' | string;
  swing?: SwingBlock;
  /** 2026-10-03 分級物件（舊資料為字串「有效／觀察中／停用」，gradeOf 會換算）；grade_reason 為未達條件 */
  grade?: GradeInfo | string;
  grade_label?: string;
  grade_reason?: string;
  grade_checks?: Record<string, boolean>;
  /** 40 日（主判定）勝率 %（0–100）與類別 */
  win?: number | null;
  family?: string;
  /** 40 日與 20 日扣成本超額 %（相對同日等權） */
  excess_h?: { '40'?: number | null; '20'?: number | null } & Record<string, number | null | undefined>;
  /** 毛超額 %（扣成本前） */
  mean_gross_excess?: number | null;
  /** 2022 前／後兩段 */
  split2022?: { date: string; pre: SplitHalf; post: SplitHalf };
  /** 前瞻驗證（合併後的新訊號） */
  forward?: ForwardBlock;
  /**
   * 2026-10-02 健檢 M2：資料不足區（例：三方同買在集保涵蓋率 ≥ 90% 並重算前）：不排名、數字旁固定顯示偏差警語、
   * 不計入今日新觸發總數；limited_note 為警語文字
   */
  limited?: boolean;
  limited_note?: string | null;
  /** 2026-10-03 判定卡 */
  judge?: Judge;
  exits?: ExitsSplit;
  /** 逐年：5 檔組合｜0050｜差額（百分點） */
  yearly?: { year: string; port: number | null; bench: number | null; diff: number | null }[];
  /** 事件研究區的逐年訊號超額（相對同日等權） */
  event?: { horizon: number; yearly: { year: string; excess: number | null; n: number }[] };
  sample?: { includes_delisted: boolean; universe_text: string; delisted_stocks: number; delisted_events: number };
  leverage?: LeverageRisk;
  /** M5 策略庫列表：近 3 年 5 檔組合相對 0050 的累積超額（%），每 4 週一點 */
  spark?: { from: string; to: string; v: number[] } | null;
}

/** 2026-10-03 分級：valid 有效／sig_only 訊號顯著・未勝 0050／watch 觀察中／invalid 無效。 */
export type Grade = 'valid' | 'sig_only' | 'watch' | 'invalid';
export const GRADE_LABEL: Record<Grade, string> = { valid: '有效', sig_only: '訊號顯著・未勝 0050', watch: '觀察中', invalid: '無效' };
export interface GradeInfo { id: Grade; label: string; notes: string[]; checks?: Record<string, boolean>; reasons?: string[]; rule?: string }

export interface JudgeSide {
  bench: string; excess: number | null; t: number | null; n: number; dates?: number; win?: number | null;
  t_parts?: { calendar: number | null; nw: number | null; nw_lag?: number | null; block: number | null };
}
export interface PortTriple { cagr: number | null; sharpe: number | null; mdd: number | null; vol?: number | null }
export interface Judge {
  horizon: number;
  t_name: string;
  sig: JudgeSide;
  opp: JudgeSide & { slots: number; period: [string, string] | null; port: PortTriple; bench_port: PortTriple };
}
export interface CurveBriefSide { peak: number | null; peak_value: number | null; peak_at_edge: boolean; at40?: number | null; at120?: number | null }
export interface CurveBrief { days: number | null; n: number; ew?: CurveBriefSide; '0050'?: CurveBriefSide; peak_at_edge?: boolean }
export interface RuleSummary { n: number; ev?: number | null; exc_idx?: number | null; rel?: Record<string, number | null>; win?: number | null; hold?: number | null; mae?: number | null; locked?: number }
export interface ExitsSplit {
  train_end: string;
  oos_start: string;
  metric: string;
  min_events: number;
  max_days: number;
  rules: { rule: string; param: string; label: string; chosen: boolean; in_sample: RuleSummary; oos: RuleSummary }[];
  chosen: { rule: string; param: string; label: string; basis: 'in_sample' | 'fallback' } | null;
  note: string | null;
  peak_train?: { day: number; train_end: string };
}
export interface RandomSim { n: number; runs: number; seed: number; slots: number; cagr: Pct3; mdd: Pct3 }
export interface Pct3 { p5: number | null; p50: number | null; p95: number | null }
export interface LeverageRiskSlot { port_mdd: number | null; port_max_adverse: number | null; max_adverse_start?: string | null }
export interface LeverageRisk extends LeverageRiskSlot { slots: number; window: number; by_slots: Record<string, LeverageRiskSlot> }

/** strategies.json 頂層：判定卡的說明文字與門檻（ⓘ 用）。 */
export interface JudgeMeta {
  horizon: number;
  slots: number;
  t_name: string;
  t_text: string;
  bench_text: { ew: string; '0050': string };
  grade_rule: string;
  selection_rule: string;
  random: { n: number; seed: number };
  exits_train_end: string;
  exit_note: string;
  trigger_window: number;
  sample: { includes_delisted: boolean; universe_stocks: number; stopped_stocks: number; official_delisted: number; universe_text: string; revenue_timing: string };
}
export interface MultiTest { M: number; parts: { indicators: number; swing_trials: number; horizons: number }; t_min: number; expected_false_t2: number; expected_false: number; bonferroni_t: number; reason: string }
export interface SplitHalf { n?: number; mean_excess?: number | null; t?: number | null }
export interface ForwardBlock {
  since: string;
  elapsed_days: number;
  required_days: number;
  ready: boolean;
  signals: number;
  completed: number;
  mean_excess: number | null;
  t: number | null;
  backtest_mean_excess: number | null;
}

const OLD_GRADE: Record<string, Grade> = { 有效: 'valid', 觀察中: 'watch', 停用: 'invalid' };

/** 分級：2026-10-03 的物件 → id；舊字串（有效／觀察中／停用）換算；都沒有時由 enabled 推回（上架＝觀察中）。 */
export function gradeOf(s: Pick<StrategyItem, 'grade' | 'enabled'>): Grade {
  const g = s.grade;
  if (g && typeof g === 'object' && g.id in GRADE_LABEL) return g.id;
  if (typeof g === 'string' && g in OLD_GRADE) return OLD_GRADE[g];
  return s.enabled ? 'watch' : 'invalid';
}

/** 分級標籤文字（全站只有一個標籤：有效／訊號顯著・未勝 0050／觀察中／無效）。 */
export const gradeLabel = (s: Pick<StrategyItem, 'grade' | 'enabled'>): string => GRADE_LABEL[gradeOf(s)];

/** 分級附註（樣本不足、待前瞻驗證、涵蓋率…）；舊資料沒有。 */
export const gradeNotes = (s: Pick<StrategyItem, 'grade'>): string[] => (s.grade && typeof s.grade === 'object' ? s.grade.notes ?? [] : []);

/** 分級標籤的語氣：有效＝強調；其他中性（琥珀只給風險，不用在分級）。 */
export const gradeTone = (g: Grade): 'strong' | 'neutral' => (g === 'valid' ? 'strong' : 'neutral');

/** 長期平均超額：新資料 {excess}、舊資料數字。 */
export const healthLong = (h: StrategyItem['health']): number | null =>
  h?.long === null || h?.long === undefined ? null : typeof h.long === 'number' ? h.long : h.long.excess ?? null;

/** 判定持有天數：2026-10-03 起全部策略（含波段策略）統一 40 日（strategies.json judge.horizon）。 */
export const judgeHold = (s: Pick<StrategyItem, 'judge'>): number => s.judge?.horizon ?? 40;

/** 40 日（主判定）扣成本超額：excess_h 優先，其次 h[hold]，最後 mean_excess。 */
export function netExcess(s: StrategyItem, hold = judgeHold(s)): number | null {
  const k = String(hold);
  const e = s.excess_h?.[k];
  if (e !== undefined && e !== null) return e;
  return s.h?.[k]?.mean_excess ?? s.mean_excess ?? null;
}

/** 指標 id → 最好的策略分級與標籤。 */
export function gradeByTest(list: StrategyItem[] | null | undefined): Map<string, { grade: Grade; label: string }> | null {
  if (!list) return null;
  const out = new Map<string, { grade: Grade; label: string }>();
  for (const s of list) {
    const g = gradeOf(s);
    const prev = out.get(s.test);
    // 同一個指標對應多套策略時，取最好的分級
    if (!prev || GRADE_ORDER[g] < GRADE_ORDER[prev.grade]) out.set(s.test, { grade: g, label: GRADE_LABEL[g] });
  }
  return out;
}

export const GRADE_ORDER: Record<Grade, number> = { valid: 0, sig_only: 1, watch: 2, invalid: 3 };

/** 有上架策略的指標 id（分級不是無效）；沒有策略資料時回傳 null（沿用判定規則）。 */
export function allowedTests(list: StrategyItem[] | null | undefined): Set<string> | null {
  const m = gradeByTest(list);
  if (!m) return null;
  return new Set([...m.entries()].filter(([, v]) => v.grade !== 'invalid').map(([k]) => k));
}

export interface SwingSegment { period?: [string, string]; n?: number; per_month?: number; mean_excess?: number | null; mean_gross_excess?: number | null; t?: number | null; t_corr?: number | null; win?: number | null; payoff?: number | null }
export interface SwingFull extends SwingSegment {
  t_corr_method?: 'calendar' | 'min' | string;
  concentration?: { dates?: number; ratio?: number | null; top5pct_share?: number | null };
  bench?: Record<string, { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null } | null>;
}
export interface SwingPortfolio extends Perf {
  slots?: number;
  executed?: number;
  skipped_full?: number;
  skipped_rule?: number;
  turnover?: number;
  trades_per_year?: number;
  bench_ew?: Perf;
  bench_0050?: Perf;
  ann_vs_ew?: number | null;
  ann_vs_0050?: number | null;
  mdd_ratio_ew?: number | null;
}
export interface SwingBlock {
  hold: number;
  params: Record<string, number>;
  segments: Partial<Record<'dev' | 'val' | 'test', SwingSegment>>;
  /** 固定日曆切段：開發 2017-01～2021-12、驗證 2022-01～2024-10、最終測試 2024-11 起 */
  split?: Partial<Record<'dev' | 'val' | 'test', [string, string]>>;
  gates: { checks: Record<string, boolean>; labels: Record<string, string>; passed: boolean };
  perturb?: { param: string; mult: number; value?: number; mean_excess?: number | null; n?: number; note?: string }[] | null;
  /** 進場延後 1、3 個交易日（0＝full） */
  delays?: { delay: number; n?: number; mean_excess?: number | null; t?: number | null }[] | null;
  dist?: { win?: number | null; avg_win?: number | null; avg_loss?: number | null; payoff?: number | null; loss_streak?: { max: number; p50: number; p90: number }; mae_p50?: number | null; mae_p90?: number | null };
  portfolio?: SwingPortfolio;
  full?: SwingFull;
  /** 另一個持有天數（主判定 40 則為 20，反之 40）的全樣本 */
  other?: SwingSegment & { hold: number };
  forward?: ForwardBlock;
  test_note?: string;
  /** 2026-10-02 健檢 M2 訊號稽核：選定參數是否為鄰近最高點、驗證段校正後 t 偏低 */
  audit?: {
    param_peak: { param: string; label: string; chosen: number | null; neighbors: { value: number | null; mean_excess: number | null }[] }[];
    val_t: number | null;
    val_t_low: boolean;
    val_t_min: number;
    trials: number;
  };
}

import type { BenchKey } from './bench';
export { BENCH_KEYS, BENCH_LABEL, type BenchKey } from './bench';
export interface BenchStat { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null; dates?: number }

export interface Perf {
  days?: number;
  ann_return?: number | null;
  vol_ann?: number | null;
  sharpe?: number | null;
  calmar?: number | null;
  mdd?: number | null;
  dd_days?: number;
  total?: number | null;
  yearly?: Record<string, number | null>;
}

export interface BenchCompare {
  period: [string, string] | null;
  strategy: Perf;
  tr?: Perf;
  '0050'?: Perf;
  '00631L'?: Perf;
  regression?: { months: number; beta?: number; alpha_ann?: number | null; alpha_t?: number | null; r2?: number | null };
}

/** 績效指標表的列（策略與各基準同一組指標）。 */
export const PERF_ROWS: { key: keyof Perf; label: string; kind: 'pct' | 'ratio' | 'days' }[] = [
  { key: 'ann_return', label: '年化報酬', kind: 'pct' },
  { key: 'vol_ann', label: '年化波動', kind: 'pct' },
  { key: 'sharpe', label: 'Sharpe', kind: 'ratio' },
  { key: 'calmar', label: 'Calmar', kind: 'ratio' },
  { key: 'mdd', label: '最大回撤', kind: 'pct' },
  { key: 'dd_days', label: '回撤天數', kind: 'days' },
];

export interface StrategiesFile {
  date: string;
  judge_meta?: JudgeMeta;
  multi_test?: MultiTest;
  horizon: number;
  env_today: { regime: boolean; trend: boolean; quarter_end: boolean };
  leverage: LeverageRules & { default_max_dd: number; default_interest: number; default_breaker: number };
  slots: number[];
  strategies: StrategyItem[];
}

/** 健康度的語氣：轉弱與低於長期用琥珀（風險）；其他中性。 */
export const healthTone = (status: string | undefined): 'risk' | 'plain' =>
  status === '近期轉弱' || status === '近期低於長期' ? 'risk' : 'plain';

/** 環境條件的說明與今日狀態。 */
export function envLine(s: StrategyItem): string {
  if (!s.env) return '適用：各種大盤環境';
  return `僅在「${s.env.label}」時啟用・今日${s.env.today ? '符合' : '不符合'}`;
}

/** 自選群組名稱：策略的主標前加「策略：」。 */
export const groupName = (s: Pick<StrategyItem, 'label'>): string => `策略：${s.label}`;

export const enabledFirst = (list: StrategyItem[]): { enabled: StrategyItem[]; disabled: StrategyItem[] } => ({
  enabled: list.filter((s) => s.enabled),
  disabled: list.filter((s) => !s.enabled),
});

/** 參數的中文標籤（與 pipeline/evidence/swing.py PARAM_LABEL 同一份）；參數表顯示中文、另列原始參數。 */
export const PARAM_LABEL: Record<string, string> = {
  rs_min: 'RS 門檻',
  vol_ratio: '量比門檻',
  hold: '持有日數',
  bias_max: '乖離上限',
  value_min: '成交值下限',
  trust_ratio: '投信買超門檻',
};

/** 「rs_min=70、vol_ratio=1.5、hold=40」→ [{ key, label, value }]；解析不了就原樣一列。 */
export function paramRows(param: string | null | undefined): { key: string; label: string; value: string }[] {
  if (!param) return [];
  const out: { key: string; label: string; value: string }[] = [];
  for (const part of param.split(/[、,]/)) {
    const m = part.trim().match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/);
    if (!m) { out.push({ key: part.trim(), label: part.trim(), value: '' }); continue; }
    const [, key, raw] = m;
    let value = raw.trim();
    if (key === 'value_min' && Number.isFinite(Number(value))) value = `${(Number(value) / 1e8).toLocaleString('zh-TW', { maximumFractionDigits: 2 })} 億元`;
    else if (key === 'bias_max' && Number.isFinite(Number(value)) && Number(value) <= 1) value = `${(Number(value) * 100).toFixed(0)}%`;
    else if (key === 'hold') value = `${value} 日`;
    else if (key === 'vol_ratio' || key === 'trust_ratio') value = `${value} 倍`;
    out.push({ key, label: PARAM_LABEL[key] ?? key, value });
  }
  return out;
}

/** 選定基準下的主判定持有天數統計：超額、t（日曆時間法）、超額勝率；等權時 t 為判定用的 t。 */
export interface Judged { hold: number; excess: number | null; t: number | null; win: number | null }

export function benchTable(s: StrategyItem): Record<string, BenchStat | null> | undefined {
  const hold = judgeHold(s);
  return s.h?.[String(hold)]?.bench ?? s.swing?.full?.bench ?? (hold === 40 ? s.bench : undefined) ?? undefined;
}

export function judged(s: StrategyItem, bench: BenchKey): Judged {
  const hold = judgeHold(s);
  const h = s.h?.[String(hold)];
  const bt = benchTable(s);
  if (bench === 'ew') return { hold, excess: netExcess(s, hold), t: h?.t ?? s.t ?? null, win: bt?.ew?.win ?? null };
  const b = bt?.[bench];
  return { hold, excess: b?.mean_excess ?? null, t: b?.t ?? null, win: b?.win ?? null };
}

/** 觸發依據的數值文字：「投信連買 6 日」「千張大戶週變化 +0.42 百分點」「當日成交值 2,281 百萬元」。 */
export function basisText(b: { label: string; value: number | null; unit: string }): string {
  if (b.value === null || b.value === undefined || !Number.isFinite(b.value)) return `${b.label} —`;
  const signed = b.unit === '百分點' || b.label.includes('變化') || b.label.includes('5 日') && b.unit === '%';
  const abs = Math.abs(b.value).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  const sign = signed ? (b.value > 0 ? '+' : b.value < 0 ? '−' : '') : b.value < 0 ? '−' : '';
  const unit = b.unit ? (b.unit === '%' ? '%' : ` ${b.unit}`) : '';
  return `${b.label} ${sign}${abs}${unit}`;
}
