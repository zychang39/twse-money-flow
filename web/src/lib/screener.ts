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
