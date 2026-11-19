/**
 * 自選群組的管理（2026-11-15；DECISIONS #466）：純函式。
 *
 * - 群組有兩種來源：①有股票在裡面；②使用者按「＋」建立、還沒有股票的（存在設定 watchPrefs.groups）。
 * - 一檔股票可以同時在多個群組（2026-11-19；DECISIONS #473）：WatchItem.groups 是全部的群組，group 是第一個（舊資料只有 group）。
 *   ①的群組清空後自動消失；②的群組清空後還在，要自己刪。
 * - 「預設」是一般群組：沒指定群組時加入的股票放在這裡；清空或刪除後不顯示，再加股票時自動出現。
 * - 系統清單（熱門動能）可以隱藏（watchPrefs.hidden），在「編輯群組」裡一鍵加回來。
 * - 沒有「全部」（2026-11-15 使用者要求移除）：一次看一個群組；記得上次看的是哪一個。
 */
export interface WatchPrefs {
  /** 使用者建立的群組（沒有股票也保留），依建立順序 */
  groups: string[];
  /** 隱藏的系統清單 id（目前只有 'hot'） */
  hidden: string[];
  /** 使用者拖曳排好的群組順序（2026-11-15）；沒排過是空的。不在裡面的群組排在後面 */
  order: string[];
}

export const DEFAULT_WATCH_PREFS: WatchPrefs = { groups: [], hidden: [], order: [] };
/** 舊資料或備份裡少欄位時補齊 */
export const normWatchPrefs = (p: Partial<WatchPrefs> | null | undefined): WatchPrefs => ({ groups: [...(p?.groups ?? [])], hidden: [...(p?.hidden ?? [])], order: [...(p?.order ?? [])] });
export const DEFAULT_GROUP = '預設';
/** 系統清單的 id（存在 watchPrefs.hidden） */
export const HOT_LIST = 'hot';
export const GROUP_NAME_MAX = 12;

/** 自選項目的群組欄位：groups＝全部的群組；舊資料只有 group */
export interface Membership { group: string; groups?: string[]; order?: number; orders?: Record<string, number> }
/** 這一檔在哪些群組（至少一個） */
export const groupsOf = (w: Membership): string[] => (w.groups?.length ? w.groups : [w.group]);
export const inGroup = (w: Membership, g: string): boolean => groupsOf(w).includes(g);
/** 在某個群組裡的排序值（加入那個群組的先後）；第一個群組用原本的 order */
export const orderIn = (w: Membership, g: string): number => w.orders?.[g] ?? w.order ?? 0;
/** 換成新的群組清單（去重複；group 跟著第一個；不在清單裡的群組排序值拿掉）。清單是空的回傳 null＝這一檔要從自選移除 */
export function withGroups<T extends Membership>(w: T, next: string[]): T | null {
  const groups = next.filter((g, i, a) => g && a.indexOf(g) === i);
  if (!groups.length) return null;
  const orders = Object.fromEntries(Object.entries(w.orders ?? {}).filter(([g]) => groups.includes(g)));
  return { ...w, group: groups[0], groups, orders };
}

/**
 * 畫面上的群組順序。
 * - 沒排過：有股票的群組依第一檔股票的順序（「預設」排最前面，與原本相同），接著是使用者建立、還沒有股票的群組（依建立順序）。
 * - 拖曳排過（prefs.order）：照排好的順序；之後才出現的群組（不在 order 裡）依上面的規則接在後面。
 */
export function effectiveGroups(watch: Membership[], prefs: Partial<WatchPrefs> | null | undefined): string[] {
  const used = new Set(watch.flatMap(groupsOf));
  const base: string[] = [];
  if (used.has(DEFAULT_GROUP)) base.push(DEFAULT_GROUP);
  for (const w of watch) for (const g of groupsOf(w)) if (!base.includes(g)) base.push(g);
  for (const g of prefs?.groups ?? []) if (!base.includes(g)) base.push(g);
  const order = prefs?.order ?? [];
  if (!order.length) return base;
  const rank = new Map(order.map((g, i) => [g, i] as const));
  return [...base.filter((g) => rank.has(g)).sort((a, b) => rank.get(a)! - rank.get(b)!), ...base.filter((g) => !rank.has(g))];
}

/** 把第 from 個移到第 to 個（拖曳排序）；超出範圍會夾在頭尾 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** 每個群組的檔數 */
export function groupCounts(watch: Membership[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of watch) for (const g of groupsOf(w)) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

/** 群組名稱整理：去頭尾空白、連續空白變一個 */
export const cleanGroupName = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * 群組名稱可不可以用；不行時回傳原因（給畫面顯示）。existing＝現有群組（改名時不含自己）。
 * 改名成已存在的群組不在這裡擋（呼叫端當成「合併」處理）。
 */
export function groupNameError(raw: string, existing: string[] = []): string | null {
  const name = cleanGroupName(raw);
  if (!name) return '請輸入群組名稱';
  if ([...name].length > GROUP_NAME_MAX) return `名稱最多 ${GROUP_NAME_MAX} 個字`;
  if (existing.includes(name)) return `已經有「${name}」這個群組`;
  return null;
}

/** 刪除群組時，預設把股票移到哪裡：「預設」優先，其次是第一個其他群組；刪的就是「預設」且沒有其他群組時回傳 null */
export function defaultMoveTarget(deleting: string, groups: string[]): string | null {
  if (deleting !== DEFAULT_GROUP) return DEFAULT_GROUP;
  return groups.find((g) => g !== deleting) ?? null;
}

/**
 * 目前要顯示哪一個群組（沒有「全部」）：想看的那個還在就用它（pending＝剛建立或剛改名、資料還沒重讀的群組）；
 * 不在了（被刪除、改名、隱藏）就換成第一個群組；一個群組都沒有時是空字串（頁面顯示歡迎卡）。
 * 系統清單（hot）要有群組列才選得到，所以沒有群組時不會停在系統清單。
 */
export function currentGroup(wanted: string, groups: string[], hot: string | null, pending: string | null = null): string {
  if (wanted && (groups.includes(wanted) || wanted === pending)) return wanted;
  // 還沒有任何群組（新用戶的歡迎卡）：什麼都不選，系統清單不會自己跑出來
  if (!groups.length) return '';
  return hot !== null && wanted === hot ? wanted : groups[0];
}

const LAST_GROUP_KEY = 'tmf-watch-group';
/** 上次看的群組（localStorage；讀不到就是空字串＝第一個群組） */
export function lastGroup(): string {
  try { return localStorage.getItem(LAST_GROUP_KEY) ?? ''; } catch { return ''; }
}
export function rememberGroup(g: string): void {
  try { localStorage.setItem(LAST_GROUP_KEY, g); } catch { /* 私密瀏覽等情況存不了：不影響使用 */ }
}
