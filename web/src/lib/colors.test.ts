/**
 * 單色風格守門（2026-10-04，A5 最高優先）：基底單色；彩色只允許紅綠（帶號漲跌、主走勢線、環境光）、藍（可點）、橘（風險）。
 * - tokens 沒有任何資料強調色變數（青、靛、紫、--c-*、--ring-1～4），也就無法被引用。
 * - 程式與樣式不引用已刪除的變數。
 * - 樣式與元件裡寫死的顏色只能是灰階，或是紅綠藍橘四色本身。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(css|tsx|ts)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}
const ALL = files(SRC).map((p) => ({ p, s: readFileSync(p, 'utf8') }));
const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');

/** 允許的彩色（紅、綠、藍、橘；含改版前的選中膠囊藍 #0066D6）；其餘一律要是灰階（R＝G＝B 或 235/235/245 這種系統灰） */
const ALLOWED = new Set(['ff453a', '30d158', '0a84ff', '0066d6', 'ff9f0a']);
function isGray(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12;
}
function hexRgb(h: string): [number, number, number] {
  const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
/** 紅綠橘的光暈與淡底（環境光、tint）：色相落在紅、綠、橘 */
function isSemanticTint(r: number, g: number, b: number): boolean {
  const red = r > 200 && g < 110 && b < 90;
  const green = g > 150 && r < 80 && b < 150;
  const orange = r > 200 && g > 140 && g < 190 && b < 60;
  const blue = b > 200 && r < 40 && g > 100 && g < 150; // --brand 的 tint（可點元素）
  return red || green || orange || blue;
}

describe('單色風格（A5）', () => {
  it('tokens 沒有資料強調色變數', () => {
    for (const v of ['--c-blue', '--c-cyan', '--c-indigo', '--c-purple', '--ring-1', '--ring-2', '--ring-3', '--ring-4']) expect(tokens).not.toContain(`${v}:`);
    for (const hex of ['64d2ff', '5e5ce6', 'bf5af2']) expect(tokens.toLowerCase()).not.toContain(hex);
    for (const v of ['--d-1', '--d-2', '--d-3', '--d-4', '--d-band', '--text-1', '--text-2', '--text-3']) expect(tokens).toContain(`${v}:`);
  });
  it('程式與樣式不引用已刪除的變數', () => {
    const bad = ALL.filter(({ s }) => /var\(--(c-blue|c-cyan|c-indigo|c-purple|ring-[1-4]|brand-tint)\)/.test(s)).map(({ p }) => p);
    expect(bad).toEqual([]);
  });
  it('寫死的顏色只有灰階與紅綠藍橘', () => {
    const bad: string[] = [];
    for (const { p, s } of ALL) {
      const body = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of body.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        const h = m[1].toLowerCase();
        const [r, g, b] = hexRgb(h);
        if (!ALLOWED.has(h.length === 3 ? h.split('').map((c) => c + c).join('') : h) && !isGray(r, g, b)) bad.push(`${p}: #${h}`);
      }
      for (const m of body.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (!isGray(r, g, b) && !isSemanticTint(r, g, b)) bad.push(`${p}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
