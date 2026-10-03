/**
 * 底部導覽的 5 個分頁（路由與轉場共用）：今晚、我的股票、探索、搜尋、紀律。
 * 搜尋放在第 4 格：右手拇指最順手的位置（與 Instagram 相同）。
 */
export interface TabDef {
  path: string;
  label: string;
  match: (path: string) => boolean;
}

export const TAB_DEFS: TabDef[] = [
  { path: '/', label: '簡報', match: (p) => p === '/' },
  { path: '/mine', label: '我的股票', match: (p) => p.startsWith('/mine') || p.startsWith('/stock') },
  { path: '/explore', label: '探索', match: (p) => p.startsWith('/explore') },
  { path: '/search', label: '搜尋', match: (p) => p.startsWith('/search') },
  { path: '/discipline', label: '流程', match: (p) => p.startsWith('/discipline') },
];

/** 路徑所屬的分頁（-1＝不屬於任何分頁，例：我的 → 設定）。 */
export function tabIndexOf(path: string): number {
  return TAB_DEFS.findIndex((t) => t.match(path));
}

/** 兩個路徑是否屬於不同分頁（切換分頁：內容直接替換、只有選取膠囊滑過去，不做整頁轉場）。 */
export function isTabSwitch(from: string, to: string): boolean {
  const a = tabIndexOf(from);
  const b = tabIndexOf(to);
  return a >= 0 && b >= 0 && a !== b;
}
