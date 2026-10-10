/** 讀取 pipeline 產生的衍生資料（./data/*.json）。記憶體快取；離線時由 service worker 提供快取。 */
import type { AiSummary, Health, Meta, StockHistory, StockRow, Summary } from './types';
import { assembleParts } from '../lib/parts';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();
/** 已經載入完成的資料（同步讀取用：個股頁左右滑動時，前後一檔已預先載入，換股不必等待、不出現載入畫面） */
const resolved = new Map<string, unknown>();

export class DataError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** 檔案不存在（HTTP 404）：個股檔只輸出近 20 個交易日有成交的證券 */
export const isNotFound = (e: unknown): boolean => e instanceof DataError && e.status === 404;

async function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(BASE + path).then(async (res) => {
      if (!res.ok) throw new DataError(res.status === 404 ? '找不到資料檔' : `資料暫時無法取得（HTTP ${res.status}）`, res.status);
      // 開發伺服器與部分快取對不存在的檔案回傳 index.html（200）：視同不存在
      if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new DataError('找不到資料檔', 404);
      // F 節：超過 300KB 的檔案分檔輸出（主檔 parts＝k），讀回時接起來
      return assembleParts(path, await res.json(), (p) => getJson(p));
    });
    p.then((v) => resolved.set(path, v), () => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}

export function rowsToObjects<T = StockRow>(summary: Pick<Summary, 'columns' | 'rows'>): T[] {
  return summary.rows.map((r) => {
    const o: Record<string, unknown> = {};
    summary.columns.forEach((c, i) => (o[c] = r[i]));
    return o as T;
  });
}

export const loadMeta = () => getJson<Meta>('meta.json');
export const loadHealth = () => getJson<Health>('health.json');
/** S2：最近兩個交易日的選股欄位（切到「今日新觸發」時才下載） */
export const loadScreenDays = () => getJson<import('../lib/screener').ScreenDays>('screen_days.json');
/** S3：內建策略的每日新觸發與價格（訊號追蹤） */
export const loadSignals = () => getJson<import('../lib/tracking').SignalsFile>('signals.json');
/** S3：近期觸發股票的還原價（只有訊號追蹤頁載入） */
export const loadSignalPrices = () => getJson<import('../lib/tracking').SignalPrices>('signals_px.json');
/** 選配 AI 摘要：meta.ai_summary 為 true 才讀取，避免 404。 */
export const loadAiSummary = () => loadMeta().then((m) => (m.ai_summary ? getJson<AiSummary>('ai_summary.json') : null));

let summaryIndex: Promise<{ date: string; rows: StockRow[]; byCode: Map<string, StockRow> }> | null = null;
export function loadSummary() {
  if (!summaryIndex) {
    summaryIndex = getJson<Summary>('summary.json').then((s) => {
      const rows = rowsToObjects<StockRow>(s);
      return { date: s.date, rows, byCode: new Map(rows.map((r) => [r.code, r])) };
    });
    summaryIndex.catch(() => (summaryIndex = null));
  }
  return summaryIndex;
}

const stockPath = (code: string) => `stocks/${encodeURIComponent(code)}.json`;
export const loadStock = (code: string) => getJson<StockHistory>(stockPath(code));
/** 已載入的個股檔（沒有則為 undefined，不發出請求）。 */
export const peekStock = (code: string) => resolved.get(stockPath(code)) as StockHistory | undefined;
/** 長歷史股價（沒有輸出長歷史檔的部署、或這一檔沒有 → null，不影響其他畫面）。 */
export const loadLongHistory = (code: string) =>
  loadMeta().then((m) => (m.long_history?.files ? getJson<import('./types').LongHistory>(`stocks/${encodeURIComponent(code)}.hist.json`).catch(() => null) : null));
export const loadJson = <T>(path: string) => getJson<T>(path);
export const loadMarket = () => getJson<import('./types').MarketData>('market.json');
/** 主動式 ETF 詳細頁（2026-10-08）：持股歷史；投信尚未涵蓋（沒有這個檔案）→ null。 */
export const loadEtfDetail = (code: string) =>
  getJson<import('../lib/etfDetail').EtfDetail>(`etf/${encodeURIComponent(code)}.json`).catch((e: unknown) => {
    if (isNotFound(e)) return null;
    throw e;
  });
/** 系統清單（熱門動能）；舊版部署沒有這個檔案時回傳 null，不影響其他畫面。 */
export const loadLists = () => getJson<import('./types').Lists>('lists.json').catch(() => null);
/** U-01：近 20 個交易日沒有成交、沒有個股檔的證券（下市、長期停牌）；舊版部署沒有這個檔案時為空。 */
export const loadInactive = () =>
  getJson<import('./types').InactiveList>('inactive.json')
    .then((x) => new Map(x.rows.map((r) => [r.code, r])))
    .catch(() => new Map<string, import('./types').InactiveRow>());
export const loadIndex = () => getJson<import('./types').IndexData>('index.json');
/** 首頁 1D 盤中走勢；舊版部署或當天尚未取得時為 null。 */
export const loadIntraday = () => getJson<import('./types').IntradayData>('intraday.json').catch(() => null);
/** 個股 5 分 K：涵蓋清單與每檔一個小檔（M1.1：每一檔有個股頁的股票都有檔案）；取不到時回傳 null（頁面顯示原因）。 */
export const loadStockIntradayIndex = () => getJson<import('./types').StockIntradayIndex>('intraday/index.json').catch(() => null);
export const loadStockIntraday = (code: string) => getJson<import('./types').StockIntraday>(`intraday/${encodeURIComponent(code)}.json`).catch(() => null);

/** M1.2 族群三層：清單與統計（含每檔的細產業、題材與報酬，自訂族群在前端計算）。 */
/** 2026-10-10：主動式 ETF 資金流向（1 日～1 季；只有主動式 ETF 頁載入） */
export const loadEtfFlows = () => getJson<import('../lib/etfFlows').EtfFlows>('etf_flows.json');
export const loadSectors = () => getJson<import('./types').SectorsIndex>('sectors.json');
/** 2026-10-10：族群大戶週流向（族群輪動 › 大戶流向） */
export const loadSectorFlows = () => getJson<import('../lib/sectorFlows').SectorFlows>('sector_flows.json');
export const loadSector = (id: string) => getJson<import('./types').SectorDetail>(`sectors/${encodeURIComponent(id)}.json`);
/** M1.5 策略期間檢視（逐筆訊號、期間判定與組合、篩出與新觸發）。 */
export const loadStrategyPack = (id: string) => getJson<import('./types').StrategyPack>(`strategy/${encodeURIComponent(id)}.json`);
