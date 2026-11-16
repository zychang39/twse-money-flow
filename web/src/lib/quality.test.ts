import { describe, expect, it } from 'vitest';
import { qualityConfig } from './config';
import {
  bizOverview, bizRows, cashSentence, earnSentence, gapSentence, historyGap, incrSentence, kindName, kindOf, lastSentence, marketVsBiz,
  overviewSentence, quadOf, qualityOf, qualitySeries, seriesSummary, tierOf, type Quality,
} from './quality';

const base: Quality = {
  status: 'ok', period: '2026Q2', hurdle: 8, roic: 31.3, spread: 23.3, band: 'above', op_margin: 59.3, nopat_margin: 48.9, turnover: 0.64,
  roe: 39.8, gap: 8.5, n_years: 10, first_year: 2016, median: 26.7, min: 21, max: 35, down_years: 0, rev_growth5: 26, incr_roic: 37.2, type: 'steady', pct: 97,
  years: [[2024, 29, 1132.1, 73.7], [2025, 31, 1200, 78.1]], ttm: ['2026Q2', 31.3, 1210, 80],
};

describe('生意體質：型別與名稱', () => {
  it('沒有 quality 區塊（舊資料）→ none，不出錯', () => {
    expect(qualityOf(null)).toEqual({ status: 'none' });
    expect(qualityOf({ quality: 'x' })).toEqual({ status: 'none' });
    expect(qualityOf({ quality: base }).roic).toBe(31.3);
  });
  it('類型優先，其次高低；金融業；沒有資料', () => {
    expect(kindOf(base)).toBe('steady');
    expect(kindOf({ ...base, type: null })).toBe('above');
    expect(kindOf({ status: 'fin' })).toBe('fin');
    expect(kindOf({ status: 'none' })).toBeNull();
    expect(kindName('steady')).toBe('報酬高且穩');
    expect(kindName(null)).toBe('資料累積中');
  });
  it('名稱直接寫條件：不用比喻、不超過 6 個字，也沒有交易字眼', () => {
    for (const [, l] of Object.entries(qualityConfig.labels)) {
      expect([...l.name].length).toBeLessThanOrEqual(6);
      expect(l.name).not.toMatch(/陷阱|複利|護城河|地雷|買|賣|推薦/);
      expect(l.rule.length).toBeGreaterThan(5);
    }
  });
});

describe('一句話結論', () => {
  it('賺不賺錢：每投入 100 元賺回多少、和門檻的關係', () => {
    expect(earnSentence(base)).toBe('每投入 100 元，一年賺回 31 元，高於 8 元的門檻');
    expect(earnSentence({ ...base, roic: 8.6, band: 'near' })).toBe('每投入 100 元，一年賺回 8.6 元，接近 8 元的門檻');
    expect(earnSentence({ ...base, roic: 0.7, band: 'below' })).toBe('每投入 100 元，一年賺回 0.7 元，低於 8 元的門檻');
    expect(earnSentence({ ...base, roic: -4.2, band: 'below' })).toBe('本業虧損：每投入 100 元，一年虧 4.2 元');
    expect(earnSentence({ status: 'fin', roe: 11.2 })).toBe('金融業改看 ROE 11.2%');
    expect(earnSentence({ status: 'none' })).toBe('資料累積中');
  });
  it('能賺多久：依類型；年度不足時說明原因與起點（不留白）', () => {
    expect(lastSentence(base)).toBe('近 10 年都在門檻以上，最低 21.0%');
    expect(lastSentence({ ...base, type: 'cyclical', min: 5, max: 24 })).toBe('跟著景氣升降：近 10 年最低 5.0%、最高 24.0%');
    expect(lastSentence({ ...base, type: 'fading', down_years: 4 })).toBe('營收成長，但 ROIC 連 4 年下滑');
    expect(lastSentence({ ...base, type: null })).toBe('近 10 年中位數 26.7%（最低 21.0%、最高 35.0%）');
    expect(lastSentence({ ...base, n_years: 3, first_year: 2023, type: null, median: null })).toBe('資料累積中：目前只有 3 年（自 2023 年起），滿 5 年才分類');
    expect(historyGap({ ...base, n_years: 0 })).toBe('資料累積中：還沒有完整年度的財報');
    expect(historyGap(base)).toBeNull();
  });
  it('ROE 與 ROIC 的差距：小於 5 個百分點算接近；大的說明可能原因', () => {
    expect(gapSentence({ ...base, gap: 2.1, roe: 11.3 })).toBe('ROE 11.3%，和 ROIC 接近，報酬不是靠舉債放大');
    expect(gapSentence({ ...base, gap: 23.8, roe: 30.6 })).toBe('ROE 30.6%：負債、租賃或業外收益放大了 ROE');
    expect(gapSentence({ ...base, gap: -9, roe: 6 })).toBe('ROE 6.0%：業外損失或閒置資金拉低了股東報酬');
    expect(gapSentence({ ...base, gap: null })).toBeNull();
  });
  it('現金跟得上獲利嗎：沒有現金流量表 → null；淨利不是正的 → 說明不計算', () => {
    expect(cashSentence(base)).toBeNull();
    expect(cashSentence({ ...base, has_cash: true, cash_conv: 116 })).toBe('營業現金流不少於淨利，獲利有變成現金');
    expect(cashSentence({ ...base, has_cash: true, cash_conv: 85 })).toBe('營業現金流略少於淨利');
    expect(cashSentence({ ...base, has_cash: true, cash_conv: 45 })).toBe('營業現金流明顯少於淨利：獲利還沒有變成現金');
    expect(cashSentence({ ...base, has_cash: true, cash_conv: -20 })).toBe('營業現金流是負的：本業在流出現金');
    expect(cashSentence({ ...base, has_cash: true, cash_conv: null })).toBe('近四季淨利不是正的，不計算');
  });
  it('新增投入的報酬', () => {
    expect(incrSentence(base)).toBe('近 3 年多投入的資本，報酬高於門檻 8%');
    expect(incrSentence({ ...base, incr_roic: 3 })).toBe('近 3 年多投入的資本，報酬低於門檻 8%');
    expect(incrSentence({ ...base, incr_roic: null })).toContain('沒有明顯增加');
  });
  it('結論句沒有交易建議字眼', () => {
    const all = [earnSentence(base), lastSentence(base), gapSentence(base) ?? '', incrSentence(base), marketVsBiz(68, 55, base)?.text ?? ''];
    for (const s of all) expect(s).not.toMatch(/買進|賣出|推薦|應該|建議|便宜|加碼|減碼/);
  });
});

describe('圖表序列', () => {
  it('年度由舊到新，最後接近四季；門檻是同一個單位的常數線', () => {
    const s = qualitySeries(base);
    expect(s.labels).toEqual(['2024', '2025', '近四季']);
    expect(s.roic).toEqual([29, 31, 31.3]);
    expect(s.revenue).toEqual([1132.1, 1200, 1210]);
    expect(s.hurdle).toEqual([8, 8, 8]);
    expect(qualitySeries({ ...base, ttm: null }).labels).toEqual(['2024', '2025']);
    expect(seriesSummary(base)).toBe('2024 年到近四季的 ROIC：最低 29.0%、最高 31.3%、最新 31.3%；門檻 8%');
    expect(seriesSummary({ ...base, ttm: null })).toBe('2024 年到 2025 年的 ROIC：最低 29.0%、最高 31.0%、最新 31.0%；門檻 8%');
    expect(seriesSummary({ status: 'ok' })).toBe('沒有年度 ROIC 資料');
  });
});

describe('市場與生意的落差', () => {
  it('只描述位置（前段／中段／後段）', () => {
    expect(tierOf(67)).toBe('前段');
    expect(tierOf(34)).toBe('中段');
    expect(tierOf(33)).toBe('後段');
    expect(tierOf(null)).toBeNull();
    expect(marketVsBiz(68, 55, base)).toEqual({ market: 62, biz: 97, text: '生意排在前段，市場熱度在中段' });
    expect(marketVsBiz(90, 80, base)?.text).toBe('生意與市場熱度都在前段');
    expect(marketVsBiz(null, null, base)).toEqual({ market: null, biz: 97, text: '生意排在前段' });
    expect(marketVsBiz(68, 55, { status: 'fin' })).toBeNull();
  });
});

describe('全市場彙整', () => {
  const rows = bizRows([
    { code: '2330', name: '台積電', roic: 31, roic_chg3: 2, revenue_chg_3y: 40, roe: 39.8, roe_roic_gap: 8.8, biz_type: 'steady', roic_pct: 97 },
    { code: '1101', name: '台泥', roic: 4.2, roic_chg3: -4.3, revenue_chg_3y: 15, biz_type: 'fading', roic_pct: 5 },
    { code: '5347', name: '世界', roic: 8.6, roic_chg3: 0.5, revenue_chg_3y: -7, biz_type: 'near' },
    { code: '6182', name: '合晶', roic: 10.5, roic_chg3: null, revenue_chg_3y: null, biz_type: 'above' },
    { code: '2882', name: '國泰金', roic: null, biz_type: 'fin' },
  ]);
  it('沒有 ROIC 的不列入；缺 3 年變化的不進四個走向', () => {
    expect(rows.map((r) => r.code)).toEqual(['2330', '1101', '5347', '6182']);
    expect(rows.map(quadOf)).toEqual(['up_up', 'up_down', 'down_up', null]);
    const o = bizOverview(rows);
    expect(o).toMatchObject({ total: 4, above: 2, near: 1, below: 1, unclassified: 1, quads: { up_up: 1, up_down: 1, down_up: 1, down_down: 0 } });
    expect(o.kinds).toEqual({ steady: 1, fading: 1, near: 1, above: 1 });
    expect(overviewSentence(o)).toBe('營收成長的公司裡，約 5 成的報酬率在下滑');
    expect(overviewSentence(bizOverview([]))).toBe('資料累積中：還沒有可以計算 ROIC 的公司');
    expect(overviewSentence(bizOverview(rows.slice(0, 1)))).toBe('營收成長的公司，報酬率大多也在上升');
  });
});
