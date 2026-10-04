import { describe, expect, it } from 'vitest';
import { ALERTS, TERMS, alertHit, evalRule, fillExample, findTerm, searchTerms } from './glossary';

describe('名詞資料', () => {
  it('id 與名稱都唯一，每個名詞都有白話', () => {
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
    expect(new Set(TERMS.map((t) => t.name)).size).toBe(TERMS.length);
    for (const t of TERMS) expect(t.plain.length).toBeGreaterThan(5);
  });
  it('C 節定義照寫', () => {
    expect(findTerm('機會成本')?.plain).toBe('每筆訊號持有 40 日扣成本後，減去同期間持有 0050（含息）的報酬，取平均。');
    expect(findTerm('訊號檢定')?.plain).toBe('同樣算法，但減去同日股票池所有股票的平均報酬。');
    expect(findTerm('校正後 t')?.plain).toContain('等權 t ≥ 3.0、相對 0050 t ≥ 2.0');
    expect(findTerm('全市場百分位')?.plain).toBe('該期間報酬在全部股票中的排名位置，97 代表高於 97% 的股票。');
    expect(findTerm('ATR14')?.plain).toBe('近 14 個交易日每日真實波動幅度的平均；用來設定停損距離與計算部位大小。');
    expect(findTerm('起始價虛線')?.plain).toBe('圖上水平虛線，代表所選區間第一筆的價格（1D 為前一交易日收盤）；線在虛線上方表示區間上漲。');
    expect(findTerm('新觸發')?.plain).toBe('當日首次同時符合全部條件的股票；回測統計只計這些。');
    expect(findTerm('篩出')?.plain).toBe('目前仍符合條件的股票，含先前已觸發者；統計依據以其觸發日為準。');
    expect(findTerm('樣本外')?.plain).toBe('選規則時沒用到的期間（2022 年起）的績效。');
    expect(findTerm('細產業')?.plain).toBe('比交易所官方產業更細的分類（如 IC 載板）；族群排名以細產業計算。');
    expect(findTerm('超額勝率')?.plain).toBe('超額大於 0 的訊號比例；低於 50% 而平均為正，表示獲利集中在少數幾筆。');
  });
  it('別名可找到同一個名詞', () => {
    expect(findTerm('昨收')?.id).toBe('start_price');
    expect(findTerm('RS 百分位')?.id).toBe('market_percentile');
  });
  it('舉例缺值時不顯示', () => {
    expect(fillExample('距 {value} 倍', { value: '2.1' })).toBe('距 2.1 倍');
    expect(fillExample('距 {value} 倍', {})).toBeNull();
    expect(fillExample(undefined, { value: 1 })).toBeNull();
  });
  it('搜尋名稱開頭優先', () => {
    expect(searchTerms('ATR')[0].id).toBe('atr14');
    expect(searchTerms('').length).toBe(TERMS.length);
  });
  it('提醒門檻（B4）', () => {
    expect(Object.keys(ALERTS).length).toBe(7);
    expect(alertHit('bias_atr', { value: 3.2 })).toBe(true);
    expect(alertHit('bias_atr', { value: 3 })).toBe(false);
    expect(alertHit('attention', { count10: 1, disposed: true })).toBe(true);
    expect(alertHit('attention', { count10: 3, disposed: false })).toBe(true);
    expect(alertHit('attention', { count10: 2, disposed: false })).toBe(false);
    expect(alertHit('stock_vs_sector', { pr: 85, sector_tercile: 3 })).toBe(true);
    expect(alertHit('stock_vs_sector', { pr: 85, sector_tercile: 2 })).toBe(false);
    expect(alertHit('margin_5d', { value: null })).toBe(false);
    expect(evalRule('value < 0', { value: -0.1 })).toBe(true);
  });
});

describe('M6 名詞內容寫滿', () => {
  it('每個名詞都有白話、舉例、進階；不出現買賣與推薦字眼', () => {
    for (const t of TERMS) {
      expect(t.plain, t.id).toBeTruthy();
      expect(t.example, t.id).toBeTruthy();
      expect(t.advanced, t.id).toBeTruthy();
      expect(`${t.plain}${t.example}${t.advanced}`, t.id).not.toMatch(/買進|賣出|推薦/);
    }
  });
  it('規格照寫的定義（不得改意）', () => {
    const plain = (id: string) => findTerm(id)?.plain ?? '';
    expect(plain('opportunity_cost')).toContain('每筆訊號持有 40 日扣成本後，減去同期間持有 0050（含息）的報酬，取平均。');
    expect(plain('signal_test')).toContain('同樣算法，但減去同日股票池所有股票的平均報酬。');
    expect(plain('adjusted_t')).toContain('門檻：等權 t ≥ 3.0、相對 0050 t ≥ 2.0。');
    expect(plain('excess_win')).toContain('低於 50% 而平均為正，表示獲利集中在少數幾筆。');
    expect(plain('out_of_sample')).toContain('選規則時沒用到的期間（2022 年起）的績效。');
    expect(plain('new_trigger')).toContain('當日首次同時符合全部條件的股票；回測統計只計這些。');
    expect(plain('screened')).toContain('目前仍符合條件的股票，含先前已觸發者；統計依據以其觸發日為準。');
    expect(plain('market_percentile')).toContain('97 代表高於 97% 的股票。');
    expect(plain('atr14')).toContain('近 14 個交易日每日真實波動幅度的平均；用來設定停損距離與計算部位大小。');
    expect(plain('fine_industry')).toContain('比交易所官方產業更細的分類（如 IC 載板）；族群排名以細產業計算。');
    expect(plain('start_price')).toContain('圖上水平虛線，代表所選區間第一筆的價格（1D 為前一交易日收盤）；線在虛線上方表示區間上漲。');
  });
  it('RS 百分位的定義與程式一致（METHODOLOGY 4.2：0.4 R63＋0.2 R126＋0.2 R189＋0.2 R252）', () => {
    expect(findTerm('market_percentile')?.advanced).toContain('0.4 × 近 63 日報酬＋0.2 × 近 126 日＋0.2 × 近 189 日＋0.2 × 近 252 日');
  });
  it('固定舉例（沒有 {名稱}）不需要頁面數字也顯示', () => {
    expect(fillExample('例：R＝5,000 元', undefined)).toBe('例：R＝5,000 元');
  });
});
