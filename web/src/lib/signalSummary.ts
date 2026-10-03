/**
 * 個股頁「有統計證據的訊號觸發了嗎？」的資料（2026-10-02 健檢 M1-1）：
 * 區塊標題的一句結論（Stock.tsx）與面板清單（components/SignalPanel.tsx）共用同一份資料與同一個計數，
 * 標題寫真正的結論（「4 個上架策略的指標（1 有效・3 觀察中）：觸發 1・接近 1」），範圍說明移到清單下方的註解。
 * 面板列的是策略分級為有效或觀察中（上架）的策略對應的指標；沒有策略庫資料時退回判定規則。
 */
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { type EvidenceFile, type EvidenceToday, type PanelItem, panelItems, panelSummary } from './evidence';
import { type Grade, type StrategiesFile, type StrategyItem, allowedTests, gradeByTest } from './strategies';

export const SIGNAL_SCOPE_NOTE = '只列策略庫分級為有效或觀察中（上架）的策略對應的指標';

export interface SignalPanelData {
  items: PanelItem[];
  /** 區塊標題的一句結論 */
  summary: string;
  /** 主判定持有天數（超額報酬的天數） */
  horizon: number;
  /** 指標 id → 策略分級；沒有策略庫資料時 null */
  grades: Map<string, { grade: Grade; label: string }> | null;
}

const loadAll = () => Promise.all([
  loadJson<EvidenceFile>('evidence.json'),
  loadJson<EvidenceToday>('evidence_today.json').catch(() => null),
  loadJson<StrategiesFile>('strategies.json').then((f) => f.strategies).catch(() => null),
]);

/** 純函式：由三個資料檔算出面板項目與結論（可測）。 */
export function buildSignalPanel(ev: EvidenceFile, today: EvidenceToday | null, strategies: StrategyItem[] | null, code: string): SignalPanelData {
  const horizon = ev.meta.config?.primary_horizon ?? 10;
  const grades = gradeByTest(strategies);
  const items = panelItems(ev.rows, today, code, horizon, allowedTests(strategies));
  return { items, summary: panelSummary(items, grades), horizon, grades };
}

export interface SignalPanelState {
  loading: boolean;
  error: Error | null;
  data: SignalPanelData | null;
}

/** 載入 evidence.json、evidence_today.json、strategies.json（data/api 有記憶體快取，區塊標題與面板各呼叫一次也只下載一次）。 */
export function useSignalPanel(code: string): SignalPanelState {
  const d = useAsync(loadAll, []);
  if (d.loading) return { loading: true, error: null, data: null };
  if (d.error || !d.data) return { loading: false, error: d.error ?? new Error('指標效度資料暫時無法取得'), data: null };
  const [ev, today, strategies] = d.data;
  return { loading: false, error: null, data: buildSignalPanel(ev, today, strategies, code) };
}
