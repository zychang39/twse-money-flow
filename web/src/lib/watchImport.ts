/**
 * 從截圖（或貼上的文字）找出股票，加進自選（2026-11-14；DECISIONS #464）。純函式，可測。
 *
 * 不靠版面位置，任何券商的庫存畫面都用同一套：
 * - 代號：文字裡 4～6 位數字（可帶一個英文字尾，例 00981A）、前後不接數字／逗號／小數點／百分號，而且在 App 的股票清單裡。
 *   （「2,535」「43675.12」「0.50%」這類金額、指數、比率都不會被當成代號。）
 * - 名稱：去掉空白後，文字裡出現股票清單的名稱。
 * - 帶正負號的數字（-1714、+2330）是損益，不是代號。
 * - 同一欄：截圖辨識有每個字的位置時，代號應該排在同一欄；離多數代號那一欄太遠的（例：沒有千分位的損益「2330」）預設不勾。
 * - 名稱核對：整段文字裡有完整的名稱，或（截圖辨識有位置時）代號附近那幾列的字有一半以上對得上——
 *   辨識常把名稱讀錯一個字（嘉晶 → 嘉唱），只看整段文字會把對的也標成「請確認」。
 * - 不在清單的代號：跟其他代號排在同一欄、卻不在股票清單裡的（例：興櫃股）列出來說明沒有加入，不是默默略過。
 * - 互相核對：代號對到、名稱也對到＝both；只對到代號＝code（名稱可能被截斷或讀錯）；只對到名稱＝name（券商沒有列代號，或代號讀錯）。
 *   讀錯的代號有可能剛好是另一檔真實的股票（實測：8028 昇陽半導體被讀成 3028 增你強），所以畫面一律列出清單裡的名稱讓使用者確認。
 */

export interface ImportRow { code: string; name: string }
export type ImportMatch = 'both' | 'code' | 'name';
export interface ImportCandidate {
  code: string;
  /** 股票清單裡的名稱（不是辨識出來的字） */
  name: string;
  match: ImportMatch;
  /** 預設要不要勾選：兩個字的名稱只對到名稱、或代號不在多數代號那一欄時不勾 */
  checked: boolean;
  /** 代號不在多數代號那一欄（可能是金額） */
  offColumn?: boolean;
}
/** 截圖辨識出來的一個字（詞）：x、y＝中心位置，x 以圖寬、y 以圖高為 1 */
export interface ImportWord { text: string; x: number; y?: number }
/** 一段文字；截圖辨識另附每個字的位置 */
export interface ImportSource { text: string; words?: ImportWord[] }
export interface ImportResult {
  items: ImportCandidate[];
  /** 像代號（跟其他代號同一欄）但不在股票清單裡：例如興櫃股 */
  unknown: string[];
}
/** 離多數代號那一欄超過畫面寬度的這個比例 → 不在同一欄 */
export const COLUMN_TOLERANCE = 0.15;

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const NUM_GLUE = new Set([',', '.', '，', '．']);

/** 全形英數與標點 → 半形（貼上的文字、部分券商畫面） */
export function toHalfWidth(text: string): string {
  return text.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

/** 文字裡像代號的片段（依出現順序、不重複）；known＝股票清單的代號 */
export function findCodes(text: string, known: ReadonlySet<string>): { code: string; at: number }[] {
  const t = toHalfWidth(text).toUpperCase();
  const out: { code: string; at: number }[] = [];
  const seen = new Set<string>();
  const re = /\d{4,6}[A-Z]?/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t[m.index - 1];
    const after = t[m.index + m[0].length];
    // 前後接著數字、千分位或小數點、百分號、英數字：是金額、指數或別的編號的一部分
    if (isDigit(before) || isDigit(after)) continue;
    if (before !== undefined && (NUM_GLUE.has(before) && isDigit(t[m.index - 2]))) continue;
    if (after !== undefined && ((NUM_GLUE.has(after) && isDigit(t[m.index + m[0].length + 1])) || after === '%')) continue;
    if (before !== undefined && /[A-Z+\-−–]/.test(before)) continue; // 英數字的一部分，或帶正負號的損益
    let code = m[0];
    if (!known.has(code) && /[A-Z]$/.test(code) && known.has(code.slice(0, -1))) code = code.slice(0, -1); // 代號後面緊接英文字（不是字尾）
    if (!known.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, at: m.index });
  }
  return out;
}

const compact = (text: string) => toHalfWidth(text).replace(/\s+/g, '');

const CODE_LIKE = /^\d{4,6}[A-Z]?$/;

/** 代號那一列附近的字（同一筆持股）：上下各 0.6 個列距；列距＝相鄰代號的垂直距離中位數 */
function nearText(words: readonly ImportWord[], y: number, gap: number): string {
  return compact(words.filter((w) => w.y !== undefined && Math.abs(w.y - y) <= gap * 0.6 + 1e-9).map((w) => w.text).join(''));
}

/**
 * 把一段或多段文字（截圖的英數辨識、中文辨識、貼上的文字）合起來找股票。
 * rows＝股票清單（代號、名稱）；回傳依第一次出現的順序。
 */
export function extractStocks(sources: readonly (ImportSource | string)[], rows: readonly ImportRow[]): ImportResult {
  const srcs = sources.map((s) => (typeof s === 'string' ? { text: s } : s));
  const known = new Set(rows.map((r) => r.code));
  const nameOf = new Map(rows.map((r) => [r.code, r.name] as const));
  const all = compact(srcs.map((s) => s.text).join('\n'));
  const order = new Map<string, number>();
  const at = new Map<string, { x: number; y?: number }>();
  srcs.forEach((s, i) => {
    for (const { code, at: pos } of findCodes(s.text, known)) if (!order.has(code)) order.set(code, i * 1e6 + pos);
    for (const w of s.words ?? []) {
      for (const { code } of findCodes(w.text, known)) if (!at.has(code)) at.set(code, { x: w.x, y: w.y });
    }
  });
  // 多數代號所在的那一欄（中位數）與列距；有位置的代號至少 4 個才判斷
  const xs = [...at.values()].map((p) => p.x).sort((a, b) => a - b);
  const column = xs.length >= 4 ? xs[Math.floor(xs.length / 2)] : null;
  const inColumn = (x: number) => column !== null && Math.abs(x - column) <= COLUMN_TOLERANCE;
  const ys = [...at.values()].filter((p) => p.y !== undefined && inColumn(p.x)).map((p) => p.y as number).sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > 0).sort((a, b) => a - b);
  const rowGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const allWords = srcs.flatMap((s) => s.words ?? []);
  const nameSeen = (code: string, name: string): boolean => {
    const n = compact(name);
    if (n.length < 2) return false;
    if (all.includes(n)) return true;
    // 名稱三個字以上：前兩個字出現就算（名稱常被截斷或折成兩行，例「昇陽／半導體」）
    if (n.length >= 3 && all.includes(n.slice(0, 2))) return true;
    // 有位置：代號附近那幾列的字，有一半以上對得上（讀錯一個字的「嘉唱」「漢舌」）
    const p = at.get(code);
    if (!p || p.y === undefined || rowGap === null) return false;
    const near = nearText(allWords, p.y, rowGap);
    const hit = [...n].filter((ch) => near.includes(ch)).length;
    return hit >= Math.ceil(n.length / 2);
  };
  const out: (ImportCandidate & { pos: number })[] = [];
  for (const [code, pos] of order) {
    const name = nameOf.get(code) ?? code;
    const p = at.get(code);
    const off = column !== null && p !== undefined && !inColumn(p.x);
    const match: ImportMatch = nameSeen(code, name) ? 'both' : 'code';
    // 名稱也對到的就算不在同一欄也勾（版面可能是兩欄）；只有代號、又不在同一欄的多半是金額
    out.push({ code, name, match, checked: !(off && match === 'code'), ...(off ? { offColumn: true } : {}), pos });
  }
  // 只對到名稱的：券商沒有列代號，或代號讀錯。名稱被另一個已對到的較長名稱包住的不算（例「台灣50」與「元大台灣50」）
  const matchedNames = out.filter((c) => c.match === 'both').map((c) => compact(c.name));
  const nameOnly: (ImportCandidate & { pos: number })[] = [];
  for (const r of rows) {
    if (order.has(r.code)) continue;
    const n = compact(r.name);
    if (n.length < 2 || !all.includes(n)) continue;
    if (matchedNames.some((m) => m !== n && m.includes(n))) continue;
    nameOnly.push({ code: r.code, name: r.name, match: 'name', checked: n.length >= 3, pos: 1e9 + all.indexOf(n) });
  }
  // 只對到名稱的彼此之間：短名稱被長名稱包住時只留長的
  const keep = nameOnly.filter((c) => !nameOnly.some((o) => o !== c && compact(o.name).includes(compact(c.name)) && compact(o.name) !== compact(c.name)));
  // 跟其他代號同一欄、樣子也像代號，卻不在清單裡
  const unknown: string[] = [];
  for (const w of allWords) {
    const t = toHalfWidth(w.text).toUpperCase();
    if (CODE_LIKE.test(t) && !known.has(t) && inColumn(w.x) && !unknown.includes(t)) unknown.push(t);
  }
  const items = [...out, ...keep].sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...c }) => c);
  return { items, unknown };
}

/** 確認清單的摘要：幾檔、幾檔要再看一眼 */
export function importSummary(items: readonly ImportCandidate[], inList: ReadonlySet<string>): { found: number; fresh: number; review: number } {
  const fresh = items.filter((c) => !inList.has(c.code));
  return { found: items.length, fresh: fresh.length, review: fresh.filter((c) => c.match !== 'both').length };
}
