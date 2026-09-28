/** 數字與漲跌格式化。漲跌同時以 ▲▼ 表示（不只靠顏色）。 */

const NF = new Map<number, Intl.NumberFormat>();
/** 同一種小數位數共用一個 Intl.NumberFormat（toLocaleString 每次都會建立新的格式器，清單與表格很耗時）。 */
export function numberFormat(digits: number): Intl.NumberFormat {
  let f = NF.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    NF.set(digits, f);
  }
  return f;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numberFormat(digits).format(v);
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

/**
 * U-09：漲跌色的共用判斷。0、空值、非有限數 → 'flat'（中性色）；|v| ≤ eps 也視為持平。
 * 全站「v > 0 ? 'up' : 'down'」「v >= 0 ? …」一律改用這個，避免 0 顯示成上漲的紅色。
 */
export function dirClass(v: number | null | undefined, eps = 0): Direction {
  if (v === null || v === undefined || !Number.isFinite(v) || Math.abs(v) <= eps) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/** 同 dirClass（舊名稱，保留給既有呼叫端） */
export function direction(v: number | null | undefined): Direction {
  return dirClass(v);
}

/** 漲跌色對應的 CSS 變數（SVG fill 等無法用 class 的地方）：0 → 中性色 */
export function dirColor(v: number | null | undefined, eps = 0): string {
  const d = dirClass(v, eps);
  return d === 'up' ? 'var(--up)' : d === 'down' ? 'var(--down)' : 'var(--flat)';
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

/** 張數＋單位（圖表座標軸、數值標籤、提示框用）：不顯示小數，1 萬張以上縮寫為「萬張」，例：−4.0 萬張、+812 張。 */
export function fmtLotsUnit(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const s = !sign ? '' : v > 0 ? '+' : v < 0 ? '−' : '';
  if (abs >= 10000) return `${s}${(abs / 10000).toFixed(1)} 萬張`;
  const r = Math.round(abs);
  return `${r === 0 ? '' : s}${r.toLocaleString('zh-TW')} 張`;
}

/** 億元＋單位（市場法人金額圖）：1 位小數。 */
export function fmtYiUnit(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = !sign ? '' : v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${Math.abs(v).toFixed(1)} 億元`;
}

/** 張數（不帶正負號）：萬張以上以「萬」表示。方向由文字（買／賣、增加／減少）或 ▲▼ 表達。 */
export function fmtLotsAbs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(abs / 10000).toFixed(1)} 萬`;
  return Math.round(abs).toLocaleString('zh-TW');
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

/**
 * 中文句子裡的數字黏住後面的單位：「12 個月」「2.52 個百分點」的空白換成不換行空白。
 * 搭配 word-break: keep-all，只會在標點或數字前的空白換行，數字與單位不會被拆到兩行。
 */
export function glueNumbers(s: string): string {
  return s.replace(/(\d[\d,.]*%?) (?=\S)/g, '$1\u00a0');
}
