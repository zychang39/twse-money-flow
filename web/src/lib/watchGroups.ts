/**
 * 自選群組的管理（2026-11-15；DECISIONS #466）：純函式。
 *
 * - 群組有兩種來源：①有股票在裡面（一檔股票只在一個群組）；②使用者按「＋」建立、還沒有股票的（存在設定 watchPrefs.groups）。
 *   ①的群組清空後自動消失；②的群組清空後還在，要自己刪。
 * - 「預設」是一般群組：沒指定群組時加入的股票放在這裡；清空或刪除後不顯示，再加股票時自動出現。
 * - 系統清單（熱門動能）可以隱藏（watchPrefs.hidden），在「編輯群組」裡一鍵加回來。
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
export const ALL_GROUPS = '全部';
/** 系統清單的 id（存在 watchPrefs.hidden） */
export const HOT_LIST = 'hot';
export const GROUP_NAME_MAX = 12;

/**
 * 畫面上的群組順序。
 * - 沒排過：有股票的群組依第一檔股票的順序（「預設」排最前面，與原本相同），接著是使用者建立、還沒有股票的群組（依建立順序）。
 * - 拖曳排過（prefs.order）：照排好的順序；之後才出現的群組（不在 order 裡）依上面的規則接在後面。
 */
export function effectiveGroups(watch: { group: string }[], prefs: Partial<WatchPrefs> | null | undefined): string[] {
  const used = new Set(watch.map((w) => w.group));
  const base: string[] = [];
  if (used.has(DEFAULT_GROUP)) base.push(DEFAULT_GROUP);
  for (const w of watch) if (!base.includes(w.group)) base.push(w.group);
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
export function groupCounts(watch: { group: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of watch) m.set(w.group, (m.get(w.group) ?? 0) + 1);
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
  if (name === ALL_GROUPS) return `「${ALL_GROUPS}」是所有自選的總覽，請換一個名稱`;
  if ([...name].length > GROUP_NAME_MAX) return `名稱最多 ${GROUP_NAME_MAX} 個字`;
  if (existing.includes(name)) return `已經有「${name}」這個群組`;
  return null;
}

/** 刪除群組時，預設把股票移到哪裡：「預設」優先，其次是第一個其他群組；刪的就是「預設」且沒有其他群組時回傳 null */
export function defaultMoveTarget(deleting: string, groups: string[]): string | null {
  if (deleting !== DEFAULT_GROUP) return DEFAULT_GROUP;
  return groups.find((g) => g !== deleting) ?? null;
}
