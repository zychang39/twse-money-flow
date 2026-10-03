import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// U-10：介面文字不使用「買進前」等行動暗示；「資金面有利」取代「資金環境偏積極」；頁尾列出全部資料來源。
const SRC = new URL('..', import.meta.url).pathname;
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|yml)$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

describe('用語（U-10）', () => {
  const all = [...files(SRC), join(SRC, '../../config/ui.yml')].map((p) => [p, readFileSync(p, 'utf8')] as const);
  it('全站沒有「買進前檢查表」與「資金環境偏積極」', () => {
    for (const [p, text] of all) {
      expect(text.includes('買進前檢查表'), p).toBe(false);
      expect(text.includes('偏積極'), p).toBe(false);
    }
  });
  it('頁尾列出中央銀行與美國財政部', () => {
    const footer = readFileSync(join(SRC, 'components/Footer.tsx'), 'utf8');
    expect(footer).toContain('中央銀行');
    expect(footer).toContain('美國財政部');
  });
});

// ---------------------------------------------------------------------------
// 2026-10-02 健檢 M1-3：缺值一律「—（原因）」，不輸出「— 起」「—%」「—／—／—%」「null 起」這類半句模板；
// 百分比統一 2 位小數（原始字串裡不該出現 3 位小數的百分比）。掃描 web/src 的 .ts／.tsx 原始碼（排除測試），
// 先去掉註解再比對，避免說明文字裡「不要印『— 起』」被誤判。
// ---------------------------------------------------------------------------

// 去掉區塊註解與行首（或空白後）的雙斜線行註解；字串裡的雙斜線（例如網址）前面不是空白，不會被拿掉。
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/.*$/gm, '$1');
}

/** 半句模板：破折號後面直接接單位或連接詞；或 `?? '—'}` 後面直接接單位。 */
const HALF_SENTENCE: { name: string; re: RegExp }[] = [
  { name: '「— 起／—%／—／／— 日／— 筆／— 檔」', re: /—\s*(起|%|／|日|筆|檔)/g },
  { name: "`?? '—'}` 後面直接接單位", re: /\?\? '—'\}\s*[%日筆檔個次]/g },
];
/** 原始字串裡的 3 位小數百分比（例「0.123%」）：全站百分比 2 位小數，這種字面值不該出現。 */
const THREE_DECIMALS = /\d\.\d{3}%/g;

/**
 * 暫時允許的檔案（別的工程師正在修；修好後把它從這裡拿掉，清單只能變短不能變長）。
 * 在清單內的檔案仍會把違規列印出來，但不讓測試失敗；清單內的檔案已經沒有違規時也會提醒可以移除。
 */
const HALF_SENTENCE_ALLOWED = new Set<string>([]);

type Offence = { file: string; line: number; text: string; rule: string };

function scan(re: RegExp, rule: string): Offence[] {
  const out: Offence[] = [];
  for (const p of files(SRC).filter((f) => /\.tsx?$/.test(f))) {
    const code = stripComments(readFileSync(p, 'utf8'));
    code.split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) out.push({ file: relative(SRC, p), line: i + 1, text: line.trim().slice(0, 160), rule });
    });
  }
  return out;
}

const fmt = (o: Offence) => `${o.file}:${o.line}  [${o.rule}]  ${o.text}`;

describe('缺值與數字格式（M1-3）', () => {
  it('原始碼沒有「— 起」「—%」這類半句模板（暫時允許清單以外的檔案一律失敗）', () => {
    const all = HALF_SENTENCE.flatMap((r) => scan(r.re, r.name));
    const hard = all.filter((o) => !HALF_SENTENCE_ALLOWED.has(o.file));
    const soft = all.filter((o) => HALF_SENTENCE_ALLOWED.has(o.file));
    if (soft.length) console.warn(`[wording] 暫時允許的半句模板（請該檔案的負責人修掉後縮短 HALF_SENTENCE_ALLOWED）：\n${soft.map(fmt).join('\n')}`);
    const clean = [...HALF_SENTENCE_ALLOWED].filter((f) => !soft.some((o) => o.file === f));
    if (clean.length) console.warn(`[wording] 這些檔案已經沒有半句模板，可以從 HALF_SENTENCE_ALLOWED 移除：${clean.join('、')}`);
    expect(hard.map(fmt), `半句模板：\n${hard.map(fmt).join('\n')}`).toEqual([]);
  });
  it('原始字串沒有 3 位小數的百分比（全站百分比 2 位小數）', () => {
    const hits = scan(THREE_DECIMALS, '3 位小數百分比');
    expect(hits.map(fmt), `3 位小數百分比：\n${hits.map(fmt).join('\n')}`).toEqual([]);
  });
  it('缺值說明用 missing(原因)：原始碼不再有「null 起」「undefined 起」', () => {
    const hits = scan(/(null|undefined)\s*(起|%|／|日|筆|檔)/g, '「null 起」');
    expect(hits.map(fmt)).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// 2026-10-03 健檢驗收：全站不出現「買進」「賣出」「推薦」字眼（只呈現計算與證據）。
// 允許：官方資料名稱（借券賣出、融券賣出、買進股數／賣出股數的欄名）與否定句（非推薦、不是推薦、不推薦）。
// ---------------------------------------------------------------------------
describe('用語：不出現買進／賣出／推薦', () => {
  const ALLOWED = [/借券賣出/g, /融券賣出/g, /暫停融券賣出/g, /買進股數/g, /賣出股數/g, /非推薦/g, /不是推薦/g, /不推薦/g, /不代表推薦/g];
  const sources = files(SRC).filter((p) => !p.includes('/wording.test.ts'));
  it('web/src 的介面原始碼（去掉註解）沒有行動字眼', () => {
    const bad: string[] = [];
    for (const p of sources) {
      let text = stripComments(readFileSync(p, 'utf8'));
      for (const re of ALLOWED) text = text.replace(re, '');
      const m = text.match(/買進|賣出|推薦/g);
      if (m) bad.push(`${relative(SRC, p)}：${m.join('、')}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
