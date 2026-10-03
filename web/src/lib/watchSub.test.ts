import { describe, expect, it } from 'vitest';
import type { StockRow } from '../data/types';
import { watchSub } from './watchChanges';

const row = (o: Partial<StockRow>): StockRow => ({ code: '2330', name: '台積電', foreign_net_lots: null, trust_net_lots: null, ...o } as StockRow);

describe('watchSub（簡報頁自選股列副資訊）', () => {
  it('外資＋投信、佔 20 日均量、量比倍數', () => {
    expect(watchSub(row({ foreign_net_lots: 5000, trust_net_lots: 887, vol20_lots: 18000, vol_ratio: 1.3241 })))
      .toBe('外資+投信 +5,887 張（佔 20 日均量 33%）・量 1.32×');
  });
  it('賣超用 U+2212；缺 20 日均量時不寫括號', () => {
    expect(watchSub(row({ foreign_net_lots: -1200, trust_net_lots: 0 }))).toBe('外資+投信 −1,200 張');
  });
  it('沒有法人資料只顯示量比', () => {
    expect(watchSub(row({ vol_ratio: 0.8 }))).toBe('量 0.80×');
  });
});
