/**
 * 簡報頁「新觸發 N 檔（M 個策略）」：策略庫中仍上架（分級不是「無效」）的策略，最新資料日首次觸發的股票。
 * 支援新舊兩種 grade 格式：舊版字串（有效／觀察中／停用），新版物件 { id: 'valid'|'sig_only'|'watch'|'invalid', label }。
 */
export interface StrategiesLite {
  date: string;
  strategies: { id: string; grade?: string | { id: string; label?: string } | null; today?: { code: string }[] | null }[];
}

export function gradeId(g: StrategiesLite['strategies'][number]['grade']): string {
  if (!g) return 'invalid';
  if (typeof g === 'object') return g.id;
  return g === '有效' ? 'valid' : g === '觀察中' ? 'watch' : 'invalid';
}

export function newTriggers(f: StrategiesLite): { date: string; stocks: number; strategies: number } {
  const listed = f.strategies.filter((s) => gradeId(s.grade) !== 'invalid');
  const codes = new Set<string>();
  let n = 0;
  for (const s of listed) {
    const t = s.today ?? [];
    if (t.length) n++;
    for (const x of t) codes.add(x.code);
  }
  return { date: f.date, stocks: codes.size, strategies: n };
}
