/**
 * 指標效度表（M1）：pipeline 預先計算的 evidence.json（總表）與 evidence/{id}.json（明細）。
 * 前端只負責顯示；判定規則寫死在 config/evidence.yml，計算見 METHODOLOGY §10。
 */

export type Verdict = '有效' | '不穩定' | '環境依賴' | '無效' | '樣本不足' | '樣本範圍受限';

export interface Brief {
  n: number;
  dates?: number;
  mean_excess?: number | null;
  t?: number | null;
  ci?: [number | null, number | null];
  win?: number | null;
  note?: string;
  since?: string;
  start?: string;
}

export interface EvidenceRow {
  id: string;
  label: string;
  family: string;
  kind: 'event' | 'quintile';
  definition?: string;
  verdict: Verdict;
  reasons: string[];
  env?: { dim: string; side: string; label: string } | null | Record<string, { on: number | null; off: number | null }>;
  n?: number;
  raw?: number;
  t?: number | null;
  t_nw?: number | null;
  mean_excess?: number | null;
  ci?: [number | null, number | null];
  win?: number | null;
  years?: Record<string, number | null>;
  oos?: number | null;
  data_start?: string | null;
  signal_start?: string | null;
  signal_end?: string | null;
  coverage?: Coverage;
  hindsight?: Hindsight;
  /** v3 M2：四種基準的超額與 t（判定以等權為準）；對 0050 不顯著時標「未勝過大型股」 */
  bench?: Record<string, { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null } | null>;
  t_0050?: number | null;
  large_cap?: string | null;
  /** v3 M1：納入股票中已下市檔數、持有期間下市／停牌的事件數、下市視為 −100% 的保守版本 */
  delist?: { stocks?: number; events?: number; halted?: number; dl100?: (Brief & { affected?: number }) | null };
  note?: string;
  param?: string | null;
  h?: Record<string, { n?: number; mean_excess?: number | null; t?: number | null; bench?: Record<string, { mean_excess: number | null; t: number | null; ci?: [number | null, number | null]; win?: number | null } | null> }>;
  recent?: Brief | null;
  components?: Record<string, { label: string; n?: number; mean_excess?: number | null; t?: number | null }>;
}

/** v3 M0-3 涵蓋率（唯一定義）：Σ每日有資料檔數 ÷ Σ每日 universe 檔數；included／universe 是每日平均檔數，相除即涵蓋率。 */
export interface Coverage {
  ratio: number;
  included: number;
  universe: number;
  ever_included?: number;
  ever_universe?: number;
  label?: string | null;
}

/** v3 M0-4 後見之明偏差估計：原 31 檔 vs 全市場（涵蓋率 ≥ 90% 後才計算）。 */
export interface Hindsight {
  status: 'waiting' | 'ok';
  coverage: number;
  threshold?: number;
  codes?: number;
  orig?: Brief & { stocks?: number };
  full?: { n?: number; mean_excess?: number | null; t?: number | null };
  bias?: number | null;
}

export interface WeeklyCoverage { date: string; ratio: number; included: number; universe: number }

export interface EvidenceMeta {
  generated_at?: string;
  data_end?: string;
  universe_stocks?: number;
  universe_daily_avg?: number;
  bench?: string;
  regime_share?: number;
  price_start?: string;
  starts?: Record<string, string | null>;
  config?: {
    primary_horizon: number;
    secondary_horizon?: number;
    stats: { t_threshold: number };
    universe?: { min_listed_days?: number; min_avg_value?: number; min_close?: number };
    grading?: unknown;
    swing_gates?: unknown;
  };
  coverage_weekly?: Record<string, WeeklyCoverage[]>;
  coverage_rule?: { limited: number; full: number };
  /** 2026-10-02 健檢 M2：集保回補進度的一句話 */
  coverage_backfill?: string | null;
  error?: string;
}

export interface EvidenceFile {
  meta: EvidenceMeta;
  rows: EvidenceRow[];
}

/** 判定的排序：有效 → 環境依賴 → 不穩定 → 樣本範圍受限 → 樣本不足 → 無效；同判定依 t 由高到低。 */
export const VERDICT_ORDER: Verdict[] = ['有效', '環境依賴', '不穩定', '樣本範圍受限', '樣本不足', '無效'];

export function sortRows(rows: EvidenceRow[]): EvidenceRow[] {
  return [...rows].sort((a, b) => {
    const va = VERDICT_ORDER.indexOf(a.verdict);
    const vb = VERDICT_ORDER.indexOf(b.verdict);
    if (va !== vb) return va - vb;
    return (b.t ?? -99) - (a.t ?? -99);
  });
}

/** 可以用來做訊號的判定（有效訊號面板、策略庫）：有效與環境依賴。 */
export const isUsable = (v: Verdict): boolean => v === '有效' || v === '環境依賴';

/** 樣本範圍受限在畫面上用琥珀（代表風險）；其他判定一律中性色，不用漲跌色。 */
export const verdictTone = (v: Verdict): 'risk' | 'strong' | 'plain' =>
  v === '樣本範圍受限' ? 'risk' : isUsable(v) ? 'strong' : 'plain';

// 2026-10-02 健檢：數字格式器集中在 lib/format.ts（全站唯一），這裡只轉出供既有呼叫端使用
import { MINUS, pctSigned, ratioPct, tText } from './format';
export { MINUS, pctSigned, tText };

export function ciText(ci: [number | null, number | null] | undefined): string {
  if (!ci || ci[0] === null || ci[1] === null) return '—';
  return `${pctSigned(ci[0])}～${pctSigned(ci[1])}`;
}

/** 一列的重點：「10 日超額 +0.68%・t 2.62・3,634 筆」（分組型：「Q5−Q1 +2.00%／月・t 2.48・55 個月」）。 */
export function rowSummary(r: EvidenceRow, horizon = 10): string {
  const n = (r.n ?? 0).toLocaleString('zh-TW');
  if (r.kind === 'quintile') return `Q5${MINUS}Q1 ${pctSigned(r.mean_excess)}／月・t ${tText(r.t)}・${n} 個月`;
  return `${horizon} 日超額 ${pctSigned(r.mean_excess)}・t ${tText(r.t)}・${n} 筆`;
}

/** 判定的白話說明（不使用買賣字眼）。 */
export function verdictNote(r: EvidenceRow): string {
  switch (r.verdict) {
    case '有效': return '全期間、逐年、樣本外都通過固定門檻。';
    case '環境依賴': return r.env && 'label' in r.env ? `只在「${String(r.env.label)}」時通過門檻。` : '只在特定大盤環境通過門檻。';
    case '不穩定': return '全期間顯著，但逐年、樣本外或參數不穩定。';
    case '無效': return '超額報酬不顯著或為負。';
    case '樣本不足': return '樣本還不夠，無法判斷。';
    case '樣本範圍受限': return '資料只涵蓋部分股票，結果不能代表全市場。';
    default: return '';
  }
}

/** 涵蓋率標示：< 50% 樣本範圍受限、50–90% 部分涵蓋、≥ 90% 不標示（與 pipeline coverage_label 同一規則）。 */
export function coverageLabel(ratio: number | null | undefined, rule = { limited: 0.5, full: 0.9 }): string | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  if (ratio < rule.limited) return '樣本範圍受限';
  if (ratio < rule.full) return '部分涵蓋';
  return null;
}

/**
 * 「25.73%（每日平均 164／637 檔）」：百分比與檔數出自同一個定義（Σ每日有資料檔數 ÷ Σ每日 universe 檔數），一定對得上。
 * 不含「涵蓋率」三個字（標籤由呼叫端放，避免「涵蓋率 涵蓋率 —」這種標籤重複）；沒有資料時附原因。
 */
export function coverageText(c: Coverage | undefined): string {
  if (!c) return '—（這個指標沒有涵蓋率資料）';
  return `${ratioPct(c.ratio)}（每日平均 ${c.included.toLocaleString('zh-TW')}／${c.universe.toLocaleString('zh-TW')} 檔）`;
}

/** 「期間內曾納入 1,601 檔，其中已下市 23 檔；持有期間下市 4 筆（最後收盤出場）；保守版本（下市 −100%）+0.52%（t 3.40）」 */
export function delistText(r: EvidenceRow): string {
  const d = r.delist;
  if (!d) return '';
  const parts = [`期間內曾納入 ${(r.coverage?.ever_included ?? 0).toLocaleString('zh-TW')} 檔，其中已下市 ${(d.stocks ?? 0).toLocaleString('zh-TW')} 檔`];
  if (d.events) parts.push(`持有期間下市 ${d.events} 筆（以最後可成交日收盤出場）`);
  if (d.halted) parts.push(`停牌到資料結束 ${d.halted} 筆`);
  parts.push(d.dl100 ? `保守版本（下市視為 ${MINUS}100%）${pctSigned(d.dl100.mean_excess)}（t ${tText(d.dl100.t)}）` : '沒有持有期間下市的事件');
  return parts.join('；') + '。';
}

export function counts(rows: EvidenceRow[]): Record<Verdict, number> {
  const out = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const r of rows) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
}

export type Filter = 'all' | 'usable' | 'other';

export function filterRows(rows: EvidenceRow[], f: Filter): EvidenceRow[] {
  if (f === 'usable') return rows.filter((r) => isUsable(r.verdict));
  if (f === 'other') return rows.filter((r) => !isUsable(r.verdict));
  return rows;
}

export const FAMILIES = ['動能', '籌碼', '基本面', '組合'] as const;

// ------------------------------------------------------------------ 個股頁「有效訊號面板」（M3）
/** evidence_today.json：每個有效／環境依賴指標近期觸發（代號 → 訊號日）與今日接近觸發的股票。 */
export interface EvidenceToday {
  date: string;
  tests: Record<string, { t: Record<string, string>; near: string[] }>;
}

export type SignalState = 'triggered' | 'near' | 'off';
export const STATE_TEXT: Record<SignalState, string> = { triggered: '觸發', near: '接近觸發', off: '未觸發' };

export interface PanelItem {
  row: EvidenceRow;
  state: SignalState;
  date: string | null;
  /** 歷史 10 日（判定持有天數）超額報酬 */
  excess: number | null;
}

/**
 * 只列判定為有效或環境依賴的指標，依 t 由高到低；狀態：近期觸發（日期）／今日接近觸發／未觸發。
 * allowed（2026-10-02）：有策略庫分級時改以分級為準，只列分級為有效或觀察中的策略對應的指標（lib/strategies.allowedTests）；null 時沿用判定規則。
 */
export function panelItems(rows: EvidenceRow[], today: EvidenceToday | null, code: string, horizon = 10, allowed: Set<string> | null = null): PanelItem[] {
  return rows
    .filter((r) => r.kind === 'event' && (allowed ? allowed.has(r.id) : isUsable(r.verdict)))
    .sort((a, b) => (b.t ?? -99) - (a.t ?? -99))
    .map((row) => {
      const t = today?.tests[row.id];
      const date = t?.t[code] ?? null;
      const state: SignalState = date ? 'triggered' : t?.near.includes(code) ? 'near' : 'off';
      return { row, state, date, excess: row.h?.[String(horizon)]?.mean_excess ?? row.mean_excess ?? null };
    });
}

/**
 * 面板的一句結論（個股頁區塊標題）：面板列的是「上架策略」（策略分級為有效或觀察中）對應的指標，不是「有效指標」
 * （觀察中的策略也在清單裡）。grades＝指標 id → 策略分級（lib/strategies.gradeByTest）；有分級資料時附分級計數。
 * 例：「4 個上架策略的指標（1 有效・3 觀察中）：觸發 1・接近 1」「…都未觸發」「目前沒有上架的策略」。
 * 沒有策略庫資料（grades 為 null）時退回判定規則：「N 個判定可用的指標：…」。
 */
export function panelSummary(items: PanelItem[], grades: Map<string, { grade: string; label: string }> | null = null): string {
  const trig = items.filter((i) => i.state === 'triggered').length;
  const near = items.filter((i) => i.state === 'near').length;
  if (!items.length) return grades ? '目前沒有上架的策略' : '目前沒有通過判定的指標';
  let head: string;
  if (grades) {
    let valid = 0, watch = 0;
    for (const it of items) {
      const g = grades.get(it.row.id)?.grade;
      if (g === '有效') valid++;
      else if (g === '觀察中') watch++;
    }
    head = `${items.length} 個上架策略的指標（${valid} 有效・${watch} 觀察中）`;
  } else {
    head = `${items.length} 個判定可用的指標`;
  }
  if (!trig && !near) return `${head}都未觸發`;
  return `${head}：觸發 ${trig}・接近 ${near}`;
}
