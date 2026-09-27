/** 個股頁左右滑動切換：記住使用者是從哪個清單進入（持股、自選、選股結果…）以及清單順序。 */
export interface ListContext { name: string; codes: string[] }
const KEY = 'twse:list-context';

export function setListContext(ctx: ListContext): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(ctx)); } catch { /* 無痕模式 */ }
}

export function getListContext(code: string): (ListContext & { index: number }) | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as ListContext;
    const index = ctx.codes.indexOf(code);
    return index >= 0 && ctx.codes.length > 1 ? { ...ctx, index } : null;
  } catch { return null; }
}
