import { describe, expect, it } from 'vitest';
import { matchScore, normalizeQuery, searchStocks } from './search';

const rows = [
  { code: '2330', name: '台積電', value_million: 50000 },
  { code: '2303', name: '聯電', value_million: 8000 },
  { code: '2454', name: '聯發科', value_million: 20000 },
  { code: '2317', name: '鴻海', value_million: 15000 },
  { code: '3008', name: '大立光', value_million: 3000 },
  { code: '0050', name: '元大台灣50', value_million: 9000 },
  { code: '1326', name: '台化', value_million: 500 },
];

describe('搜尋', () => {
  it('正規化：全形數字、空白、大小寫', () => {
    expect(normalizeQuery(' ２３３０ ')).toBe('2330');
    expect(normalizeQuery('00679b')).toBe('00679B');
  });
  it('代號完全相同最優先；代號開頭依成交值排序', () => {
    expect(searchStocks(rows, '2330')[0].code).toBe('2330');
    expect(searchStocks(rows, '23').map((r) => r.code)).toEqual(['2330', '2317', '2303']);
  });
  it('中文名稱與部分比對', () => {
    expect(searchStocks(rows, '台積')[0].code).toBe('2330');
    expect(searchStocks(rows, '聯').map((r) => r.code)).toEqual(['2454', '2303']);
    expect(searchStocks(rows, '台灣')[0].code).toBe('0050');
    expect(searchStocks(rows, '大光').map((r) => r.code)).toEqual(['3008']);
  });
  it('名稱完全相同優先於開頭相同', () => {
    expect(matchScore({ code: '1326', name: '台化' }, '台化')).toBeGreaterThan(matchScore({ code: '1', name: '台化纖' }, '台化'));
  });
  it('沒有輸入或沒有符合時回傳空陣列', () => {
    expect(searchStocks(rows, '  ')).toEqual([]);
    expect(searchStocks(rows, '不存在')).toEqual([]);
  });
});
