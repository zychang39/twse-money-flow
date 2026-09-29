/** 選股條件引擎：同一組合內條件皆須成立（AND）。 */
import { screenerConfig, type Condition } from './config';

export type Row = Record<string, unknown>;

export function testCondition(row: Row, c: Condition): boolean {
  const v = row[c.field];
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  switch (c.op) {
    case '>': return v > (c.value as number);
    case '>=': return v >= (c.value as number);
    case '<': return v < (c.value as number);
    case '<=': return v <= (c.value as number);
    case '==': return v === (c.value as number);
    case 'between': {
      const [lo, hi] = c.value as [number, number];
      return v >= lo && v <= hi;
    }
  }
}

export function matches(row: Row, conditions: Condition[]): boolean {
  return conditions.every((c) => testCondition(row, c));
}

export function screen<T extends Row>(rows: T[], conditions: Condition[], sortKey = 'composite'): T[] {
  const hit = rows.filter((r) => matches(r, conditions));
  return hit.sort((a, b) => ((b[sortKey] as number) ?? -Infinity) - ((a[sortKey] as number) ?? -Infinity));
}

export function describeCondition(c: Condition, label: (f: string) => string, unit: (f: string) => string): string {
  const u = unit(c.field);
  if (c.op === 'between') {
    const [lo, hi] = c.value as [number, number];
    return `${label(c.field)} 介於 ${lo}～${hi} ${u}`;
  }
  return `${label(c.field)} ${c.op} ${c.value} ${u}`;
}

/** 條件 ↔ 網址參數（一鍵回測時帶到回測頁）。 */
export function encodeConditions(cs: Condition[]): string {
  return encodeURIComponent(JSON.stringify(cs));
}
export function decodeConditions(s: string | null): Condition[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(decodeURIComponent(s));
    return Array.isArray(v) ? (v as Condition[]) : null;
  } catch {
    return null;
  }
}

/** 條件正規化（順序不影響、數值統一成 number）：用來判斷兩組條件是否相同（#11）。 */
function norm(cs: Condition[]): string {
  return JSON.stringify(cs.map((c) => ({ f: c.field, o: c.op, v: Array.isArray(c.value) ? c.value.map(Number) : Number(c.value) }))
    .map((c) => JSON.stringify(c)).sort());
}

export function sameConditions(a: Condition[], b: Condition[]): boolean {
  return norm(a) === norm(b);
}

export interface NamedScreen { id: string; label: string; conditions: Condition[]; aliases?: string[] }

/**
 * 舊名稱 → 新名稱（策略改名的相容：我的組合、追蹤策略、網址參數裡的「籌碼集中」自動顯示為「三方同買」）。
 * 不是任何內建策略的舊名稱就原樣回傳。
 */
export function canonicalName(name: string, presets: NamedScreen[]): string {
  const hit = presets.find((p) => p.aliases?.includes(name.trim()));
  return hit ? hit.label : name;
}

/**
 * 「我的組合」的顯示名稱：以內建策略舊名稱儲存的（當時預設名稱就是內建名稱）→ 新名稱；條件和該內建策略不同時加「（已修改）」，
 * 避免和內建策略同名。
 */
export function savedDisplayName(name: string, conditions: Condition[], presets: NamedScreen[]): string {
  const p = presets.find((x) => x.label === name.trim() || x.aliases?.includes(name.trim()));
  if (!p) return name;
  return sameConditions(p.conditions, conditions) ? p.label : `${p.label}（已修改）`;
}

/** 內建策略清單（含舊名稱），供名稱對應與比較使用。 */
export function presetScreens(): NamedScreen[] {
  return screenerConfig.presets.map((p) => ({ id: p.id, label: p.label, conditions: p.conditions, aliases: p.aliases }));
}

/**
 * 目前條件的名稱（#11）：和某個內建組合完全相同 → 用它的名稱；和目前選取的「我的組合」相同 → 用那個名稱；
 * 改過我的組合 →「名稱（已修改）」；其他（改過內建組合或從頭建立）→「自訂條件」，不沿用內建組合的名稱。
 */
export function screenIdentity(conditions: Condition[], active: string, presets: NamedScreen[], saved: NamedScreen[]): {
  name: string; presetId: string | null; savedId: string | null; modifiedFrom: string | null;
} {
  const preset = presets.find((p) => sameConditions(p.conditions, conditions));
  if (preset) return { name: preset.label, presetId: preset.id, savedId: null, modifiedFrom: null };
  const own = saved.find((s) => s.id === active);
  if (own) {
    const label = savedDisplayName(own.label, own.conditions, presets);
    return sameConditions(own.conditions, conditions)
      ? { name: label, presetId: null, savedId: own.id, modifiedFrom: null }
      : { name: label.endsWith('（已修改）') ? label : `${label}（已修改）`, presetId: null, savedId: own.id, modifiedFrom: label };
  }
  const base = presets.find((p) => p.id === active);
  return { name: '自訂條件', presetId: null, savedId: null, modifiedFrom: base?.label ?? null };
}

/**
 * 回測頁的自訂條件名稱（#11）：網址帶來的名稱若和內建組合同名、條件卻不同，改成「名稱（已修改）」；
 * 條件和某個內建組合完全相同時回傳該組合 id（直接看預先計算的全市場回測，不再多一個同名標籤）。
 */
export function backtestCustom(conditions: Condition[], name: string | null, presets: NamedScreen[]): { name: string; presetId: string | null } {
  const same = presets.find((p) => sameConditions(p.conditions, conditions));
  if (same) return { name: same.label, presetId: same.id };
  const n = canonicalName(name?.trim() || '自訂條件', presets);
  return { name: presets.some((p) => p.label === n) ? `${n}（已修改）` : n, presetId: null };
}

/** screen_days.json：全市場最近兩個交易日的選股欄位值（pipeline/derive/signals.screen_days）。 */
export interface ScreenDays {
  dates: [string, string];
  fields: string[];
  rows: [string, (number | null)[], (number | null)[]][];
  weekly?: { data_date: string; published: string; fields: string[] } | null;
}

/**
 * 今日新觸發（S2）：最新交易日全部條件成立、上一個交易日可判斷（每個條件欄位都有資料）但不成立。
 * 與回測的訊號定義相同（pipeline backtest.new_triggers）。條件欄位不在檔案裡 → null（無法判斷）。
 */
export function newTriggerCodes(days: ScreenDays, conditions: Condition[]): Set<string> | null {
  if (conditions.some((c) => !days.fields.includes(c.field))) return null;
  const idx = new Map(days.fields.map((f, i) => [f, i]));
  const toRow = (vals: (number | null)[]): Row => Object.fromEntries(conditions.map((c) => [c.field, vals[idx.get(c.field)!]]));
  const out = new Set<string>();
  for (const [code, prev, last] of days.rows) {
    const p = toRow(prev);
    const evaluable = conditions.every((c) => typeof p[c.field] === 'number' && Number.isFinite(p[c.field] as number));
    if (evaluable && matches(toRow(last), conditions) && !matches(p, conditions)) out.add(code);
  }
  return out;
}

/** 條件含週資料（集保大戶）時的說明：「大戶資料：9/18 持股・9/19 公布」。 */
export function weeklyNote(conditions: Condition[], weekly: { data_date: string; published: string; fields: string[] } | null | undefined): string | null {
  if (!weekly || !conditions.some((c) => weekly.fields.includes(c.field))) return null;
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  return `大戶資料：${md(weekly.data_date)} 持股・${md(weekly.published)} 公布（週資料，每週更新一次）`;
}
