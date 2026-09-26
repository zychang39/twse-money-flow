import { describe, expect, it } from 'vitest';
import { parseImport } from './importer';

const known = new Set(['2330', '2317', '0050', '2454', '00400A']);
const byName = new Map([['台積電', '2330'], ['鴻海', '2317']]);

describe('parseImport', () => {
  it('代號清單與名稱', () => {
    const r = parseImport('2330 台積電\n2317, 0050\n鴻海\n9999', known, byName);
    expect(r.codes.map((c) => c.code)).toEqual(['2330', '2317', '0050']);
    expect(r.unknown).toEqual(['9999']);
  });
  it('CSV 含群組欄', () => {
    const r = parseImport('代號,群組\n2454,半導體\n00400A,ETF\n2330.TW,半導體', known, byName);
    expect(r.codes).toEqual([
      { code: '2454', group: '半導體' },
      { code: '00400A', group: 'ETF' },
      { code: '2330', group: '半導體' },
    ]);
  });
  it('頓號與空白分隔', () => {
    expect(parseImport('2330、2317 0050', known, byName).codes.length).toBe(3);
  });
});
