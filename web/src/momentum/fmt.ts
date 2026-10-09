/** 動能流程頁面共用的格式化（純函式）。 */
import { fmtNum } from '../lib/format';

export const ymd = (d: string) => `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 整數、不加千分位（窄表格用） */
export const intText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v)));
/** 金額以萬元表示（圖軸與線尾標籤） */
export const wanText = (v: number) => `${fmtNum(v / 10000, 0)} 萬`;
/** 百分比（輸入已是百分數）：+1.2%／−3.4%／— */
export const pctText = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), d)}%`;
/** 小數報酬（0.123）→ +12.3% */
export const rPct = (v: number | null | undefined, d = 1) => pctText(v === null || v === undefined ? null : v * 100, d);
/** t 值：t 1.23／t −0.45／t — */
export const tText = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? 't —' : `t ${v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 2)}`;
/** |t| ≥ 2 */
export const isSig = (v: number | null | undefined) => v !== null && v !== undefined && Math.abs(v) >= 2;
