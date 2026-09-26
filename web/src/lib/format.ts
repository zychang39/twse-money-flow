/** 數字與漲跌格式化。漲跌同時以 ▲▼ 表示（不只靠顏色）。 */

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(v: number | null | undefined): string {
  return fmtNum(v, 0);
}

/** 價格：依價位決定小數位數（台股 tick 規則的顯示近似）。 */
export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2;
  return fmtNum(v, digits);
}

export function fmtPct(v: number | null | undefined, digits = 2, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v.toFixed(digits);
  return `${sign && v > 0 ? '+' : ''}${s}%`;
}

export type Direction = 'up' | 'down' | 'flat';

export function direction(v: number | null | undefined): Direction {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export function arrow(v: number | null | undefined): string {
  const d = direction(v);
  return d === 'up' ? '▲' : d === 'down' ? '▼' : '－';
}

/** VoiceOver 用的漲跌描述。 */
export function changeLabel(change: number | null | undefined, pct: number | null | undefined): string {
  const d = direction(change);
  if (d === 'flat') return '平盤';
  const word = d === 'up' ? '上漲' : '下跌';
  return `${word} ${fmtNum(Math.abs(change ?? 0))} 元${pct !== null && pct !== undefined ? `，${Math.abs(pct).toFixed(2)}%` : ''}`;
}

/** 張數：正負帶符號，萬張以上以「萬」表示。 */
export function fmtLots(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}萬`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')}`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)} 億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)} 萬`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
