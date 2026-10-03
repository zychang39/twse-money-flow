/**
 * 個股頁「策略訊號」的資料（2026-10-03 改版）：每個上架策略（分級不是無效）一列，
 * 這一檔近 40 個交易日內最近一次觸發日（evidence_today.json strategies）、
 * 判定卡的兩個 40 日扣成本超額與校正後 t（相對 0050、相對同日等權；strategies.json judge）與單一分級標籤。
 * 與策略庫頁同一份資料、同一個分級。
 */
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import type { EvidenceToday } from './evidence';
import { type Grade, type StrategiesFile, type StrategyItem, GRADE_LABEL, GRADE_ORDER, gradeOf } from './strategies';
import { isListed } from './status';

export interface SignalItem {
  id: string;
  label: string;
  subtitle: string;
  grade: Grade;
  gradeLabel: string;
  notes: string[];
  /** 這一檔近 window 個交易日內最近一次觸發日；未觸發為 null */
  date: string | null;
  opp: { excess: number | null; t: number | null };
  ew: { excess: number | null; t: number | null };
}

export interface SignalPanelData {
  items: SignalItem[];
  /** 一句結論（「4 個策略：觸發 1」） */
  summary: string;
  /** 觸發視窗（交易日） */
  window: number;
  /** 判定持有天數 */
  horizon: number;
  /** 資料日 */
  date: string | null;
}

const loadAll = () => Promise.all([
  loadJson<StrategiesFile>('strategies.json').catch(() => null),
  loadJson<EvidenceToday>('evidence_today.json').catch(() => null),
]);

const sigT = (s: StrategyItem) => s.judge?.sig.t ?? s.t_corr ?? -99;

/** 純函式：由 strategies.json 與 evidence_today.json 算出面板列（可測）。 */
export function buildSignalPanel(file: StrategiesFile | null, today: EvidenceToday | null, code: string): SignalPanelData {
  const list = (file?.strategies ?? []).filter((s) => isListed(s));
  list.sort((a, b) => GRADE_ORDER[gradeOf(a)] - GRADE_ORDER[gradeOf(b)] || sigT(b) - sigT(a));
  const items: SignalItem[] = list.map((s) => {
    const g = gradeOf(s);
    const j = s.judge;
    return {
      id: s.id,
      label: s.label,
      subtitle: s.subtitle,
      grade: g,
      gradeLabel: GRADE_LABEL[g],
      notes: s.grade && typeof s.grade === 'object' ? s.grade.notes ?? [] : [],
      date: today?.strategies?.[s.id]?.t?.[code] ?? null,
      opp: { excess: j?.opp.excess ?? null, t: j?.opp.t ?? null },
      ew: { excess: j?.sig.excess ?? null, t: j?.sig.t ?? null },
    };
  });
  const trig = items.filter((i) => i.date).length;
  const summary = !items.length ? '無上架策略' : trig ? `${items.length} 個策略・觸發 ${trig}` : `${items.length} 個策略・未觸發`;
  return {
    items,
    summary,
    window: today?.window ?? file?.judge_meta?.trigger_window ?? 40,
    horizon: file?.judge_meta?.horizon ?? 40,
    date: today?.date ?? file?.date ?? null,
  };
}

export interface SignalPanelState {
  loading: boolean;
  error: Error | null;
  data: SignalPanelData | null;
}

/** 載入 strategies.json、evidence_today.json（data/api 有記憶體快取，多處呼叫只下載一次）。 */
export function useSignalPanel(code: string): SignalPanelState {
  const d = useAsync(loadAll, []);
  if (d.loading) return { loading: true, error: null, data: null };
  if (d.error || !d.data || !d.data[0]) return { loading: false, error: d.error ?? new Error('策略資料暫時無法取得'), data: null };
  const [file, today] = d.data;
  return { loading: false, error: null, data: buildSignalPanel(file, today, code) };
}
