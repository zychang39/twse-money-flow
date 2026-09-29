/** 選股條件引擎：同一組合內條件皆須成立（AND）。 */
import type { Condition } from './config';

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

export interface NamedScreen { id: string; label: string; conditions: Condition[] }

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
    return sameConditions(own.conditions, conditions)
      ? { name: own.label, presetId: null, savedId: own.id, modifiedFrom: null }
      : { name: `${own.label}（已修改）`, presetId: null, savedId: own.id, modifiedFrom: own.label };
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
  const n = name?.trim() || '自訂條件';
  return { name: presets.some((p) => p.label === n) ? `${n}（已修改）` : n, presetId: null };
}
