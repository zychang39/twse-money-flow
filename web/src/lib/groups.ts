/**
 * 族群（M4）：純函式。內建族群（sectors.json／sectors/{id}.json）＋使用者的自訂族群與編輯（IndexedDB groups store）。
 * - 編輯內建族群：成員＝內建成員 − removed ＋ members；分段＝內建分段，使用者有改時以使用者的為準。
 * - 自訂族群的統計在前端用 sectors.json 的個股欄（r1m、r3m、rs、above60、high60）計算；名次以細產業的 3 個月中位數排名換算。
 * - 等權指數：成員每日還原報酬的平均連乘（起點 100），與 pipeline derive/sectors.equal_weight_index 相同。
 */
import type { SectorRow, SectorsIndex, StockHistory } from '../data/types';
import type { UserGroup } from '../db/db';

type N = number | null;
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type GroupLayer = 'official' | 'fine' | 'theme';
export const LAYER_NAME: Record<GroupLayer, string> = { official: '官方產業', fine: '細產業', theme: '題材與自訂' };
export const STREAMS = ['上游', '中游', '下游'] as const;

/** 中位數（忽略缺值） */
export function median(xs: N[]): N {
  const v = xs.filter(ok).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 套用使用者編輯後的成員（保持原順序，加入的放最後；重複只留一個） */
export function applyMembers(base: string[], edit: Pick<UserGroup, 'members' | 'removed'> | null | undefined): string[] {
  if (!edit) return base;
  const rm = new Set(edit.removed ?? []);
  const out = base.filter((c) => !rm.has(c));
  for (const c of edit.members) if (!out.includes(c) && !rm.has(c)) out.push(c);
  return out;
}

/** 套用使用者編輯後的分段：使用者有設定的分段整段取代；只保留仍是成員的代號 */
export function applyStreams(base: Record<string, string[]>, edit: Pick<UserGroup, 'streams'> | null | undefined, members: string[]): Record<string, string[]> {
  const set = new Set(members);
  const merged: Record<string, string[]> = { ...base, ...(edit?.streams ?? {}) };
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(merged)) {
    const codes = v.filter((c) => set.has(c));
    if (codes.length) out[k] = codes;
  }
  return out;
}

export interface CustomStats { members: number; live: number; med1m: N; med3m: N; above60: N; high60: number; rs: N; rank: N; of: N }

/** 自訂族群的統計（前端計算）：成員中位數、站上 60 日線比例、名次（在細產業 3 個月中位數的排序中的位置） */
export function customStats(codes: string[], idx: SectorsIndex | null | undefined): CustomStats {
  const rows = codes.map((c) => idx?.stocks[c]).filter((r): r is NonNullable<typeof r> => !!r);
  const med1m = median(rows.map((r) => r[3]));
  const med3m = median(rows.map((r) => r[4]));
  const ab = rows.map((r) => r[7]).filter(ok);
  const fine = (idx?.groups ?? []).filter((g) => g.layer === 'fine' && !isEtfGroup(g) && ok(g.rank) && ok(g.med['3M']));
  const of = fine.length ? Math.max(...fine.map((g) => g.of ?? 0)) : null;
  const rank = ok(med3m) && fine.length ? fine.filter((g) => (g.med['3M'] as number) > med3m).length + 1 : null;
  return {
    members: codes.length, live: rows.length, med1m, med3m,
    above60: ab.length ? (ab.filter((v) => v > 0).length / ab.length) * 100 : null,
    high60: rows.filter((r) => (r[8] ?? 0) > 0).length,
    rs: median(rows.map((r) => r[6])),
    rank, of,
  };
}

/** 等權指數（起點 100）：成員每日還原報酬的平均連乘；dates＝最近 days 個交易日（以第一檔的日期為準，其他檔對齊日期） */
export function equalWeightIndex(hists: (Pick<StockHistory, 'd' | 'c' | 'af'> | null | undefined)[], days = 250): { dates: string[]; values: number[] } {
  const hs = hists.filter((h): h is Pick<StockHistory, 'd' | 'c' | 'af'> => !!h && h.d.length > 1);
  if (!hs.length) return { dates: [], values: [] };
  const all = [...new Set(hs.flatMap((h) => h.d))].sort();
  const dates = all.slice(-(days + 1));
  const adjMaps = hs.map((h) => {
    const m = new Map<string, number>();
    h.d.forEach((d, i) => { const c = h.c[i]; if (ok(c)) m.set(d, c * (h.af[i] ?? 1)); });
    return m;
  });
  const values = [100];
  for (let i = 1; i < dates.length; i++) {
    const rs: number[] = [];
    for (const m of adjMaps) {
      const a = m.get(dates[i - 1]), b = m.get(dates[i]);
      if (ok(a) && ok(b) && a > 0) rs.push(b / a - 1);
    }
    const mean = rs.length ? rs.reduce((x, y) => x + y, 0) / rs.length : 0;
    values.push(values[values.length - 1] * (1 + mean));
  }
  return { dates: dates.slice(1), values: values.slice(1) };
}

/** 依名稱或代號找內建族群（舊網址 #/explore/sectors/{官方產業名稱} 轉成族群 id） */
export function resolveGroupId(key: string, idx: SectorsIndex | null | undefined): string | null {
  if (!idx) return null;
  if (key.startsWith('u-') || idx.groups.some((g) => g.id === key)) return key;
  // 2026-10-06：整理後併入「其他」、合併或改列題材的舊族群 id
  const alias = idx.aliases?.[key];
  if (alias && idx.groups.some((g) => g.id === alias)) return alias;
  const byName = idx.groups.find((g) => g.layer === 'official' && g.name === key) ?? idx.groups.find((g) => g.name === key);
  return byName?.id ?? null;
}

export type GroupSort = 'rank' | 'r1m' | 'insti';
export const SORT_NAME: Record<GroupSort, string> = { rank: '3 個月名次', r1m: '1 個月報酬', insti: '法人買超' };

/** 族群輪動的列（內建或自訂）：排序用的數值 */
export interface GroupListRow { id: string; name: string; layer: GroupLayer | 'custom'; members: number; med3m: N; med1m: N; rank: N; of: N; rankPrev: N; above60: N; insti20: N; newCount: N; path: string[]; custom: boolean; merged: string | null }

export function rowFromSector(g: SectorRow): GroupListRow {
  return {
    id: g.id, name: g.name, layer: g.layer as GroupLayer, members: g.members, med3m: g.med['3M'], med1m: g.med['1M'], rank: g.rank, of: g.of, rankPrev: g.rank_prev,
    above60: g.above60, insti20: g.insti20, newCount: g.new, path: g.path, custom: false, merged: g.merged,
  };
}

export function rowFromCustom(u: UserGroup, idx: SectorsIndex | null | undefined): GroupListRow {
  const st = customStats(u.members, idx);
  return {
    id: u.id, name: u.name, layer: 'custom', members: st.members, med3m: st.med3m, med1m: st.med1m, rank: st.rank, of: st.of, rankPrev: null,
    above60: st.above60, insti20: null, newCount: null, path: [], custom: true, merged: null,
  };
}

/** ETF 分類（e-*）：名次只和 ETF 分類比，不和股票的細產業一起排 */
export function isEtfGroup(g: { id: string }): boolean {
  return g.id.startsWith('e-');
}

/** 細產業的上層路徑（清單小字）：「半導體 › IC設計」；官方產業與題材沒有 */
export function groupCrumb(r: Pick<GroupListRow, 'layer' | 'path' | 'name'>): string {
  if (r.layer !== 'fine' || r.path.length < 2) return '';
  return r.path.slice(0, -1).filter((p) => !r.name.startsWith(p)).join(' › ');
}

/** 排序：名次（小在前，無名次排最後）、1 個月報酬（大在前）、法人買超（大在前）；同值依名稱。ETF 分類一律排在股票族群之後。 */
export function sortGroups(rows: GroupListRow[], by: GroupSort): GroupListRow[] {
  const key = (r: GroupListRow): number => {
    // 成員不足的族群（merged）名次是上層的，排在有自己名次的族群之後
    if (by === 'rank') return ok(r.rank) && !r.merged ? r.rank : ok(r.rank) ? 1e6 + r.rank : Number.POSITIVE_INFINITY;
    const v = by === 'r1m' ? r.med1m : r.insti20;
    return ok(v) ? -v : Number.POSITIVE_INFINITY;
  };
  const etf = (r: GroupListRow) => (isEtfGroup(r) ? 1 : 0);
  return [...rows].sort((a, b) => etf(a) - etf(b) || key(a) - key(b) || a.name.localeCompare(b.name, 'zh-Hant'));
}

/** 名次 20 日變化：正＝名次往前（數字變小） */
export function rankDelta(rank: N, prev: N): N {
  return ok(rank) && ok(prev) ? prev - rank : null;
}
