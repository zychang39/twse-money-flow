/**
 * 流程步驟與新手導覽的行為紀錄（M6）：寫進 IndexedDB 的 activity（備份包含）。全部「同鍵只記一次」，不會因重複開啟而累加。
 * 只記「有沒有看過」，不記停留時間、不記次數；經驗值規則在 lib/ritual.ts。
 */
import { logActivityKey } from '../db/db';
import { todayTpe } from './dates';

const today = () => todayTpe();
const safe = (p: Promise<unknown>) => { p.catch(() => undefined); };
/** 同一個工作階段內已送出的鍵（避免拖曳、捲動時重複查資料庫） */
const sent = new Set<string>();
const once = (k: string, f: () => Promise<unknown>) => { if (sent.has(k)) return; sent.add(k); safe(f()); };

/** 步驟 1：簡報的市場分段看過 */
export const trackMarket = () => once(`m:${today()}`, () => logActivityKey('market_viewed', today(), 'market', { id: 'market' }));
/** 步驟 2：持股清單開過 */
export const trackHoldings = () => once(`h:${today()}`, () => logActivityKey('holdings_viewed', today(), 'hold', { id: 'hold' }));
/** 步驟 3：自選異動清單開過（記下當時清單上的代號；清單變了才再記一筆） */
export const trackMovers = (codes: string[]) => { const k = [...codes].sort().join(','); once(`v:${today()}:${k}`, () => logActivityKey('movers_viewed', today(), k, { codes: k })); };
/** 步驟 3：開過的個股（每天每檔一次） */
export const trackStock = (code: string) => once(`s:${today()}:${code}`, () => logActivityKey('stock_viewed', today(), code, { code }));
/** 步驟 4：選股頁開過 */
export const trackScreener = () => once(`c:${today()}`, () => logActivityKey('screener_viewed', today(), 'screener', { id: 'screener' }));
/** 名詞第一次讀（每個名詞只記一次，不分日期） */
export const trackTerm = (id: string) => { once(`t:${id}`, () => logActivityKey('term_read', today(), id, { id }, false)); markOnboard('term'); };
/** 新手導覽任務（每項只記一次） */
export const markOnboard = (task: string) => once(`o:${task}`, () => logActivityKey('onboard', today(), task, { task }, false));
