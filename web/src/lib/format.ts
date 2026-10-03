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

/**
 * 張數（M3 單位統一）：一律完整的千分位整數，不縮寫成萬、千、K、M，不帶小數；四捨五入到整數。
 * 正負帶符號（負號統一用 U+2212），四捨五入後為 0 → 「0」不帶符號。
 */
export function fmtLots(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(Math.abs(v));
  if (r === 0) return '0';
  return `${v > 0 ? '+' : MINUS}${numberFormat(0).format(r)}`;
}

/** 張數＋單位（圖表座標軸、數值標籤、提示框用）：例「−40,123 張」「+812 張」「0 張」。 */
export function fmtLotsUnit(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(Math.abs(v));
  const s = !sign || r === 0 ? '' : v > 0 ? '+' : MINUS;
  return `${s}${numberFormat(0).format(r)} 張`;
}

/** 全站統一的負號（U+2212）。 */
export const MINUS = '\u2212';

/** 億元＋單位（市場法人金額圖）：1 位小數。 */
export function fmtYiUnit(v: number | null | undefined, sign = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = !sign ? '' : v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${Math.abs(v).toFixed(1)} 億元`;
}

/** 張數（不帶正負號）：完整的千分位整數。方向由文字（買／賣、增加／減少）或 ▲▼ 表達。 */
export function fmtLotsAbs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numberFormat(0).format(Math.round(Math.abs(v)));
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

// ---------- 全站唯一的統計數字格式器（2026-10-02 健檢 M1-3） ----------
// 規則：百分比 2 位小數、t 值 2 位、比例（0–1）一律轉成百分比；負號 U+2212；缺值一律「—」並由呼叫端附原因（missing）。

/** 百分比（值已是 %）：帶正負號、2 位小數；0 不帶符號。例：+1.68%、−0.51%、0.00%。 */
export function pctSigned(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return `${s}%`;
  return `${v > 0 ? '+' : MINUS}${s}%`;
}

/** 百分比（值已是 %）不帶正負號、2 位小數：勝率、涵蓋率、完整度。例：53.81%。 */
export function pctPlain(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

/** 比例（0–1）→ 百分比文字（2 位）：0.1398 → 13.98%、0.2573 → 25.73%。 */
export function ratioPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return pctPlain(v * 100, digits);
}

/** t 值：2 位小數、U+2212。 */
export function tText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v < 0 ? `${MINUS}${Math.abs(v).toFixed(2)}` : v.toFixed(2);
}

/** 倍數、比值（Sharpe、賺賠比、回撤比值）：2 位小數。 */
export function ratioText(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v < 0 ? `${MINUS}${Math.abs(v).toFixed(digits)}` : v.toFixed(digits);
}

/**
 * 缺值一律「—（原因）」：畫面上任何破折號都要附原因，不輸出「— 起」「—%」這類半句模板。
 * 例：missing('資料累積中') → 「—（資料累積中）」。
 */
export function missing(reason: string): string {
  return `—（${reason}）`;
}

/** 有值就格式化，沒有就「—（原因）」。 */
export function orMissing(v: number | null | undefined, fmt: (x: number) => string, reason: string): string {
  return v === null || v === undefined || !Number.isFinite(v) ? missing(reason) : fmt(v);
}

/** 日期 ISO → 「M/D」；沒有日期時回傳 missing(reason)。 */
export function md(iso: string | null | undefined, reason = '沒有日期'): string {
  if (!iso) return missing(reason);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 整數千分位（樣本數、筆數）。 */
export function fmtCount(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return numberFormat(0).format(Math.round(v));
}
