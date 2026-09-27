/**
 * 股票搜尋：代號、中文名稱、名稱部分比對。
 * - 輸入先正規化：全形英數轉半形、去空白、英文轉大寫（「２３３０」＝「2330」）。
 * - 排序：代號完全相同 > 名稱完全相同 > 代號開頭相同 > 名稱開頭相同 > 名稱包含 > 名稱依序包含每個字（例「大光」→「大立光」）。
 *   同分時成交值大的在前（流動性高、較可能是要找的那一檔），再依代號。
 */
import type { StockRow } from '../data/types';

export function normalizeQuery(q: string): string {
  return q
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, '')
    .toUpperCase();
}

/** 名稱依序包含查詢的每個字（允許中間夾字），例如「台化纖」→「台化纖維」、「鴻精」→「鴻海精密」。 */
function subsequence(name: string, q: string): boolean {
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  return i === q.length;
}

export function matchScore(row: Pick<StockRow, 'code' | 'name'>, q: string): number {
  const code = row.code.toUpperCase();
  const name = (row.name ?? '').toUpperCase();
  if (!q) return 0;
  if (code === q) return 100;
  if (name === q) return 95;
  if (code.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (name.includes(q)) return 60;
  if (q.length >= 2 && !/^[0-9A-Z]+$/.test(q) && subsequence(name, q)) return 40;
  return 0;
}

export function searchStocks<T extends Pick<StockRow, 'code' | 'name' | 'value_million'>>(rows: T[], query: string, limit = 20): T[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return rows
    .map((r) => ({ r, s: matchScore(r, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.r.value_million ?? -1) - (a.r.value_million ?? -1) || a.r.code.localeCompare(b.r.code))
    .slice(0, limit)
    .map((x) => x.r);
}
