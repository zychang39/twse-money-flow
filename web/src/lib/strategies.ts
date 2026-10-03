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
  health?: { status: string; recent: number | null; recent_n: number; recent_t: number | null; since: string | null; long: number | null };
  today?: { code: string; name: string; basis?: { label: string; value: number | null; unit: string }[] }[];
  /** 今日 0 檔的原因（不留白） */
  today_note?: string | null;
  exit?: { rule: string; param: string; label: string; stats: Partial<ExitRow>; alternatives: ExitRow[] };
  trades?: TradeStats & { n: number; mean_net: number | null; win: number | null; hold: number | null; yearly: Record<string, { n: number; mean_net: number | null; exc_idx: number | null; win: number | null }> };
  portfolio?: Record<string, PortfolioStats & { yearly?: Record<string, number | null>; total?: number | null }>;
  curve?: { dates: string[]; equity: number[]; bench: (number | null)[]; etf?: Record<string, (number | null)[]>; slots?: number; missing?: Record<string, string> };
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
  selection?: { score?: number | null; reasons?: string[]; status?: string; family?: string; registered?: boolean } | null;
  registered?: boolean;
  kind?: 'swing' | string;
  swing?: SwingBlock;
  /** 2026-10-02 分級：有效／觀察中／停用（舊資料沒有時由 enabled 推回）；grade_reason 在觀察中／停用時一定有內容 */
  grade?: Grade;
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
}

export type Grade = '有效' | '觀察中' | '停用';
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

/** 分級：舊資料沒有 grade 時由 enabled 推回（上架＝觀察中、未上架＝停用）。 */
export const gradeOf = (s: Pick<StrategyItem, 'grade' | 'enabled'>): Grade =>
  s.grade === '有效' || s.grade === '觀察中' || s.grade === '停用' ? s.grade : s.enabled ? '觀察中' : '停用';

/** 分級標籤的語氣：有效＝強調、觀察中＝一般、停用＝弱化（琥珀只給風險，不用在分級）。 */
export const gradeTone = (g: Grade): 'strong' | 'plain' | 'muted' => (g === '有效' ? 'strong' : g === '觀察中' ? 'plain' : 'muted');

/** 主判定持有天數：波段策略用自己的 hold，其餘 40 日（2026-10-02 起）。 */
export const judgeHold = (s: Pick<StrategyItem, 'swing'>): number => s.swing?.hold ?? 40;

/** 40 日（主判定）扣成本超額：excess_h 優先，其次 h[hold]，最後 mean_excess。 */
export function netExcess(s: StrategyItem, hold = judgeHold(s)): number | null {
  const k = String(hold);
  const e = s.excess_h?.[k];
  if (e !== undefined && e !== null) return e;
  return s.h?.[k]?.mean_excess ?? s.mean_excess ?? null;
}

/** 個股頁有效訊號面板：只列分級為有效或觀察中的策略；回傳指標 id → 分級標籤。 */
export function gradeByTest(list: StrategyItem[] | null | undefined): Map<string, { grade: Grade; label: string }> | null {
  if (!list) return null;
  const out = new Map<string, { grade: Grade; label: string }>();
  for (const s of list) {
    const g = gradeOf(s);
    const prev = out.get(s.test);
    // 同一個指標對應多套策略時，取最好的分級
    if (!prev || GRADE_ORDER[g] < GRADE_ORDER[prev.grade]) out.set(s.test, { grade: g, label: s.grade_label ?? g });
  }
  return out;
}

export const GRADE_ORDER: Record<Grade, number> = { 有效: 0, 觀察中: 1, 停用: 2 };

/** 允許出現在個股頁訊號面板的指標 id（分級為有效或觀察中）；沒有策略資料時回傳 null（沿用判定規則）。 */
export function allowedTests(list: StrategyItem[] | null | undefined): Set<string> | null {
  const m = gradeByTest(list);
  if (!m) return null;
  return new Set([...m.entries()].filter(([, v]) => v.grade !== '停用').map(([k]) => k));
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
