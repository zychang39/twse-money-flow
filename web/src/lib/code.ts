/** 證券代號正規化（E-08）：去空白、轉大寫。網址、自選、持倉一律經過這裡（00980a → 00980A）。 */
export function normCode(code: string): string {
  let c = code;
  try { c = decodeURIComponent(code); } catch { /* 不是合法編碼就原樣使用 */ }
  return c.replace(/\s+/g, '').toUpperCase();
}
