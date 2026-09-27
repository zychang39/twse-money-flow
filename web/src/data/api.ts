/** 讀取 pipeline 產生的衍生資料（./data/*.json）。記憶體快取；離線時由 service worker 提供快取。 */
import type { AiSummary, Health, Meta, StockHistory, StockRow, Summary } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();
/** 已經載入完成的資料（同步讀取用：個股頁左右滑動時，前後一檔已預先載入，換股不必等待、不出現載入畫面） */
const resolved = new Map<string, unknown>();

export class DataError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(BASE + path).then(async (res) => {
      if (!res.ok) throw new DataError(`${path}：HTTP ${res.status}`);
      return res.json();
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
export const loadJson = <T>(path: string) => getJson<T>(path);
export const loadMarket = () => getJson<import('./types').MarketData>('market.json');
/** 系統清單（熱門動能）；舊版部署沒有這個檔案時回傳 null，不影響其他畫面。 */
export const loadLists = () => getJson<import('./types').Lists>('lists.json').catch(() => null);
export const loadIndex = () => getJson<import('./types').IndexData>('index.json');
