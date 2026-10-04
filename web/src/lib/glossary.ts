/**
 * 名詞資料（config/glossary.yml，全站唯一來源）：查詢、搜尋、以當前頁面數字填入舉例、提醒門檻判斷。純函式。
 */
import glossaryYml from '../../../config/glossary.yml';

export interface Term {
  id: string;
  name: string;
  aliases?: string[];
  plain: string;
  example?: string;
  advanced?: string;
}
export interface AlertDef { term: string; rule: string; text: string }
interface GlossaryFile { version: number; alerts: Record<string, AlertDef>; terms: Term[] }

const data = glossaryYml as unknown as GlossaryFile;
export const TERMS: Term[] = data.terms;
export const ALERTS: Record<string, AlertDef> = data.alerts;
const byKey = new Map<string, Term>();
for (const t of TERMS) {
  byKey.set(t.id, t);
  byKey.set(t.name, t);
  for (const a of t.aliases ?? []) if (!byKey.has(String(a))) byKey.set(String(a), t);
}

/** 自動連結允許的兩字別名（其餘兩字以下的別名太泛用，例：中性、有效、風險、連續，不自動連結） */
const AUTO_SHORT = new Set(['融資', '融券', '當沖', '量比', '乖離', '均線', '借券', '外資', '投信', '法人', '大戶', '停損', '回撤', '勝率', '題材', '寬度', 'RS', 'PE', 'PB', 'ATR', 'XP']);

/**
 * 畫面文字（區塊標題、列名稱、摘要格標籤、表頭）若正好是某個名詞的名稱或別名，回傳名詞 id（自動變成可點的名詞）。
 * 只比對整段文字；兩字以下的別名只有 AUTO_SHORT 會連結。
 */
export function autoTermId(label: string): string | null {
  const k = label.replace(/\s+/g, ' ').trim();
  if (!k || k.length > 16) return null;
  const t = byKey.get(k);
  if (!t) return null;
  if (k.length <= 2 && !AUTO_SHORT.has(k) && t.name !== k) return null;
  return t.id;
}

/** 以 id、名稱或別名找名詞。 */
export function findTerm(key: string): Term | undefined {
  return byKey.get(key) ?? byKey.get(key.replace(/\s+/g, ' ').trim());
}

/** 舉例模板：{名稱} 由 ctx 帶入；缺任何一個值時回傳 null（不顯示半套句子）。沒有 {名稱} 的固定舉例（「例：…」）一律顯示。 */
export function fillExample(tpl: string | undefined, ctx: Record<string, string | number | null | undefined> | undefined): string | null {
  if (!tpl) return null;
  if (!/\{\w+\}/.test(tpl)) return tpl;
  if (!ctx) return null;
  let missing = false;
  const out = tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = ctx[k];
    if (v === null || v === undefined || v === '') { missing = true; return ''; }
    return String(v);
  });
  return missing ? null : out;
}

/** 名詞表搜尋：名稱、別名、白話都比對；名稱開頭相符的排前面。 */
export function searchTerms(q: string): Term[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...TERMS].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const score = (t: Term): number => {
    const n = t.name.toLowerCase();
    if (n === s) return 0;
    if (n.startsWith(s)) return 1;
    if (n.includes(s)) return 2;
    if ((t.aliases ?? []).some((a) => String(a).toLowerCase().includes(s))) return 3;
    if (t.plain.toLowerCase().includes(s)) return 4;
    return 9;
  };
  return TERMS.map((t) => [score(t), t] as const).filter(([k]) => k < 9).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/**
 * 提醒門檻（B4）：rule 是簡單的比較式（value > 3、count10 >= 3 or disposed、pr >= 80 and sector_tercile == 3）。
 * 只支援 and／or、比較運算子與布林欄位；缺值視為不成立。
 */
export function alertHit(id: string, vars: Record<string, number | boolean | null | undefined>): boolean {
  const def = ALERTS[id];
  if (!def) return false;
  return evalRule(def.rule, vars);
}

export function evalRule(rule: string, vars: Record<string, number | boolean | null | undefined>): boolean {
  return rule.split(/\s+or\s+/).some((part) => part.split(/\s+and\s+/).every((cond) => {
    const m = cond.trim().match(/^(\w+)\s*(>=|<=|==|>|<)\s*(-?[\d.]+)$/);
    if (!m) {
      const v = vars[cond.trim()];
      return v === true;
    }
    const v = vars[m[1]];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    const x = Number(m[3]);
    switch (m[2]) {
      case '>': return v > x;
      case '>=': return v >= x;
      case '<': return v < x;
      case '<=': return v <= x;
      default: return v === x;
    }
  }));
}
