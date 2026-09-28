import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
