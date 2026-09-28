import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALL_COLS,
  type ChipBlock,
  UNIT_NAME,
  VIEW_COLS,
  cellPhrase,
  cellText,
  colFormat,
  formatAbs,
  chipRows,
  colStreak,
  colTotal,
  colUnit,
  colValue,
  compactNum,
  dayText,
  rowSentence,
  streakText,
  convert,
  estimatedCost,
  officialLinks,
  rangeSentence,
  rangeStats,
  recent,
  streak,
  sumConverted,
  toCsv,
  toShares,
} from './chips';

const SAMPLES = new URL('../../../tests/fixtures/samples/', import.meta.url);
const num = (s: string) => Number(s.replaceAll(',', ''));

/** 真實 T86 樣本（證交所 2026-09-24，單位：股）中台積電 2330 的一列。 */
function t86Row(code: string) {
  const t = JSON.parse(readFileSync(new URL('twse_rwd_T86.json', SAMPLES), 'utf-8')) as { date: string; fields: string[]; data: string[][] };
  const row = t.data.find((r) => r[0].trim() === code)!;
  const f = (name: string) => num(row[t.fields.indexOf(name)]);
  return {
    date: t.date,
    foreign: f('外陸資買賣超股數(不含外資自營商)'),
    foreignDealer: f('外資自營商買賣超股數'),
    trust: f('投信買賣超股數'),
    dealer: f('自營商買賣超股數'),
    dealerSelf: f('自營商買賣超股數(自行買賣)'),
    dealerHedge: f('自營商買賣超股數(避險)'),
    total: f('三大法人買賣超股數'),
  };
}

/** 兩天的 chip 區塊：前一日（種子列）＋ 2026-09-24（真實 T86；成交量、成交金額取自同日 MI_INDEX 樣本）。 */
function block2330(): ChipBlock {
  const r = t86Row('2330');
  const vol = 14557662; // MI_INDEX 2026-09-24 台積電成交股數
  const value = 36107476243; // 成交金額（元）
  const avg = Math.round((value / vol) * 100) / 100; // 2480.31
  return {
    d: ['2026-09-23', '2026-09-24'],
    c: [2500, 2475],
    chg: [null, -1],
    v: [20000000, vol],
    avg: [2500, avg],
    af: [1, 1],
    mb: [30000, 30100],
    sb: [500, 480],
    fn: [0, r.foreign],
    ffd: [0, r.foreignDealer],
    tn: [0, r.trust],
    dn: [0, r.dealer],
    dself: [0, r.dealerSelf],
    dhedge: [0, r.dealerHedge],
    tot: [0, r.total],
    sbls: [null, 120000],
    dt: [null, 12.5],
  };
}

describe('chips：真實 T86 樣本（台積電 2330，2026-09-24）', () => {
  it('張數與其他 App 對照：外資 −4,668、投信 −1,288、自營商 243、三大法人合計 −5,713', () => {
    const row = recent(chipRows(block2330()), 1)[0];
    const lots = (k: 'foreign' | 'trust' | 'dealer' | 'total') => Math.round(convert(row[k], row, 'lots')!);
    expect(lots('foreign')).toBe(-4668);
    expect(lots('trust')).toBe(-1288);
    expect(lots('dealer')).toBe(243);
    expect(lots('total')).toBe(-5713);
    // 三大法人合計（官方欄位）＝ 外陸資 ＋ 外資自營商 ＋ 投信 ＋ 自營商（以股計完全相等）
    const r = t86Row('2330');
    expect(r.foreign + r.foreignDealer + r.trust + r.dealer).toBe(r.total);
    expect(r.foreignDealer).toBe(0); // 該日無外資自營商交易，所以「外資」＝外陸資（不含外資自營商）
  });

  it('自營商＝自行買賣＋避險：以股計 176,000 ＋ 66,701 ＝ 242,701（＝243 張）', () => {
    // 說明：兩者以「股」相加與官方自營商合計完全一致；若各自先四捨五入到張（176 ＋ 67 ＝ 243），
    // 本例剛好相同，但一般情況可能差 ±1 張（例如 0.5 張附近的進位），因此表格的合計一律先以股數相加再換算。
    const r = t86Row('2330');
    expect(r.dealerSelf).toBe(176000);
    expect(r.dealerHedge).toBe(66701);
    expect(r.dealerSelf + r.dealerHedge).toBe(r.dealer);
    const row = recent(chipRows(block2330()), 1)[0];
    expect(Math.round(convert(row.dealerSelf, row, 'lots')!)).toBe(176);
    expect(Math.round(convert(row.dealerHedge, row, 'lots')!)).toBe(67);
  });

  it('佔成交量 %（手算）：外資 −4,667,832 ÷ 14,557,662 × 100 ＝ −32.06%', () => {
    const row = recent(chipRows(block2330()), 1)[0];
    expect(convert(row.foreign, row, 'pct')!).toBeCloseTo(-32.0644, 3);
    expect(convert(row.total, row, 'pct')!).toBeCloseTo(-39.2429, 3); // −5,712,849 ÷ 14,557,662
  });

  it('金額（手算）：均價 36,107,476,243 ÷ 14,557,662 ≈ 2,480.31 元；外資 −4,667,832 × 2,480.31 ÷ 1e8 ≈ −115.78 億', () => {
    const row = recent(chipRows(block2330()), 1)[0];
    expect(row.avg).toBe(2480.31);
    expect(convert(row.foreign, row, 'amount')!).toBeCloseTo(-115.7767, 3);
    expect(convert(row.trust, row, 'amount')!).toBeCloseTo(-31.9394, 3);
  });
});

describe('chips：區間合計、連續天數、估計成本', () => {
  const b: ChipBlock = {
    d: ['d0', 'd1', 'd2', 'd3'],
    c: [100, 101, 99, 102],
    chg: [null, 1, -1.98, 3.03],
    v: [1_000_000, 2_000_000, 1_000_000, 2_000_000],
    avg: [100, 100, 110, 120],
    af: [1, 1, 1, 1],
    mb: [1000, 1010, 1005, 1100],
    sb: [50, 40, 45, 45],
    fn: [0, 100_000, -50_000, 200_000],
    ffd: [0, 0, 0, 0],
    tn: [0, -10_000, -20_000, -30_000],
    dn: [0, 5_000, 5_000, 0],
    dself: [0, 3_000, 5_000, 0],
    dhedge: [0, 2_000, 0, 0],
    tot: [0, 95_000, -65_000, 170_000],
    sbls: [null, null, 1_000, 2_000],
    dt: [null, 10, 20, 30],
  };

  it('手算：3 日外資 +250 張；金額 ＝ (100,000×100 − 50,000×110 ＋ 200,000×120) ÷ 1e8 ＝ 0.285 億；佔量 ＝ 250,000 ÷ 5,000,000 ＝ 5%', () => {
    const rows = recent(chipRows(b), 3);
    expect(sumConverted(rows, 'foreign', 'lots')).toBe(250);
    expect(sumConverted(rows, 'foreign', 'amount')).toBeCloseTo(0.285, 10);
    expect(sumConverted(rows, 'foreign', 'pct')).toBeCloseTo(5, 10);
    // 融資增減（張）：1100 − 1000 ＝ +100 張；換成股再換回張不變
    expect(sumConverted(rows, 'marginChg', 'lots')).toBe(100);
    expect(toShares(rows[0], 'marginChg')).toBe(95_000);
    // 借券賣出只有兩天有資料：佔量只用有資料的日子的成交量（3,000 ÷ 3,000,000）
    expect(sumConverted(rows, 'sblSell', 'pct')).toBeCloseTo(0.1, 10);
  });

  it('連買／連賣天數由最新一天往回數', () => {
    expect(streak([1, -1, 2, 3])).toBe(2);
    expect(streak([-1, -2, -3])).toBe(-3);
    expect(streak([5, 0])).toBe(0);
    expect(streak([5, null])).toBe(0);
    expect(streak([])).toBe(0);
  });

  it('估計成本只計淨買超日：(100,000×100 ＋ 200,000×120) ÷ 300,000 ＝ 113.33 元', () => {
    const rows = recent(chipRows(b), 3);
    expect(estimatedCost(rows, 'foreign')).toBeCloseTo(113.3333, 3);
    expect(estimatedCost(rows, 'trust')).toBeNull(); // 投信全是賣超
    const s = rangeStats(b, 3, 10_000_000);
    const f = s.parties.find((p) => p.key === 'foreign')!;
    expect(f.pctCapital).toBeCloseTo(2.5, 10); // 250,000 ÷ 10,000,000 股
    expect(f.costRel).toBeCloseTo((102 / 113.3333 - 1) * 100, 2);
    expect(s.parties.find((p) => p.key === 'trust')!.streak).toBe(-3);
    expect(s.parties.find((p) => p.key === 'trust')!.cost).toBeNull(); // 區間淨賣超不估成本
  });

  it('白話結論：規則式、不使用建議字眼', () => {
    const s = rangeStats(b, 3, 10_000_000);
    const text = rangeSentence(s, { days: 60, table_periods: [], table_default: 10, stats_periods: [], stats_default: 5, sentence_min_pct: 0.5, streak_min: 3 });
    expect(text).toBe('近 3 日外資買超佔成交量 5.0%，投信連 3 日賣超。');
    expect(text).not.toMatch(/買進|賣出|建議|大舉|狂/);
    const one = rangeSentence(rangeStats(b, 1, null), { days: 60, table_periods: [], table_default: 10, stats_periods: [], stats_default: 5, sentence_min_pct: 50, streak_min: 3 });
    expect(one).toBe('最近一個交易日外資、投信、自營商（自行買賣）的買賣超都不到成交量的 50%，投信連 3 日賣超。');
  });

  it('CSV：標題帶單位、第一列為區間合計、數字不含千分位', () => {
    const rows = recent(chipRows(b), 3);
    const csv = toCsv(rows, 'lots', { code: 'T', name: '測試' }).split('\n');
    expect(csv[1]).toBe('日期,收盤,漲跌(%),外資(張),投信(張),自營商（自行買賣）(張),自營商（避險）(張),三大法人合計(張),融資增減(張),融券增減(張),借券賣出(張),當沖比率(%)');
    expect(csv[2].startsWith('區間合計(3日),102.00,')).toBe(true);
    expect(csv[3]).toBe('d3,102.00,3.03,200,-30,0,0,170,95,0,2,30.00');
    const amount = toCsv(rows, 'amount', { code: 'T', name: '測試' }).split('\n');
    expect(amount[1]).toContain('外資(億元・估)');
  });

  it('官方來源連結：證交所 T86 與櫃買報表改用 HTML 版', () => {
    const tw = officialLinks('twse', '2026-09-24');
    expect(tw[0].url).toBe('https://www.twse.com.tw/rwd/zh/fund/T86?date=20260924&selectType=ALLBUT0999&response=html');
    const tp = officialLinks('tpex', '2026-09-24');
    expect(tp[0].url).toContain('date=2026/09/24');
    expect(tp.every((l) => l.url.includes('response=html') && l.label.startsWith('櫃買'))).toBe(true);
  });
});

describe('每日籌碼：三種檢視、單位、縮寫與無障礙句子', () => {
  const b: ChipBlock = {
    d: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'],
    c: [170, 175, 180, 176],
    chg: [null, 2.94, 2.86, -2.22],
    v: [1_000_000, 2_000_000, 3_000_000, 4_000_000],
    avg: [170, 175, 180, 176],
    af: [1, 1, 1, 1],
    mb: [1000, 1100, 1300, 1200],
    sb: [100, 110, 130, 60],
    fn: [0, 20_000_000, -485_000, -485_000],
    ffd: [0, 0, 0, 0],
    tn: [0, 12_000, 12_000, 12_000],
    dn: [0, -3_000, -3_000, -3_000],
    dself: [0, -3_000, -3_000, -3_000],
    dhedge: [0, 0, 0, 0],
    tot: [0, 20_009_000, -476_000, -476_000],
    sbls: [null, 1_000, 2_000, 3_000],
    dt: [null, 10, 20, 30],
    sblb: [50_000, 51_000, 53_000, 56_000],
    dtv: [null, 200_000, 600_000, 1_200_000],
  };
  const all = chipRows(b);
  const rows = recent(all, 3); // 新到舊：9/24、9/23、9/22
  const col = (key: string) => ALL_COLS.find((c) => c.key === key)!;

  it('每種檢視固定 4 欄；單位名稱是「佔成交量 %」（不是「估」）', () => {
    for (const v of ['insti', 'credit', 'sbl'] as const) expect(VIEW_COLS[v]).toHaveLength(4);
    expect(VIEW_COLS.insti.map((c) => c.full)).toEqual(['外資', '投信', '自營商（自行買賣）', '三大法人合計']);
    expect(VIEW_COLS.credit.map((c) => c.label)).toEqual(['融資增減', '融券增減', '融資餘額', '券資比']);
    expect(VIEW_COLS.sbl.map((c) => c.label)).toEqual(['借券賣出', '借券賣出餘額', '當沖比率', '當沖量']);
    expect(UNIT_NAME.pct).toBe('佔成交量 %');
    expect([...UNIT_NAME.pct][0].codePointAt(0)).toBe(0x4f54); // 佔（U+4F54），不是 估（U+4F30）
    expect(Object.values(UNIT_NAME).join()).not.toContain('估成交量');
  });

  it('≥ 10,000 縮寫為「萬」；張為整數、金額與佔量兩位小數、比率一位', () => {
    expect(compactNum(9_999, 'lots')).toBe('9,999');
    expect(compactNum(12_345, 'lots')).toBe('1.2\u00a0萬');
    expect(compactNum(1_234_567, 'lots')).toBe('123\u00a0萬');
    expect(compactNum(12.345, 'amount')).toBe('12.35');
    expect(compactNum(123.45, 'amount')).toBe('123.5');
    expect(compactNum(3.216, 'pct')).toBe('3.22');
    expect(compactNum(12.34, 'ratio')).toBe('12.3');
  });

  it('儲存格：正負同時用 ▲▼ 與方向；比率加 %；沒有資料為「—」', () => {
    const r = rows[0];
    expect(cellText(colValue(r, col('foreign'), 'lots'), col('foreign'), 'lots')).toMatchObject({ text: '▼485', arrow: '▼', body: '485', dir: 'down' });
    expect(cellText(colValue(r, col('trust'), 'lots'), col('trust'), 'lots')).toMatchObject({ text: '▲12', dir: 'up' });
    expect(cellText(colValue(r, col('shortRatio'), 'lots'), col('shortRatio'), 'lots')).toMatchObject({ text: '5.0%', dir: 'none' });
    expect(cellText(null, col('foreign'), 'lots').text).toBe('—');
    expect(cellText(colValue(all[1], col('foreign'), 'lots'), col('foreign'), 'lots').text).toBe('▲2.0\u00a0萬');
  });

  it('整欄格式（v3）：最大絕對值 ≥ 10,000 張 → 整欄萬張 1 位小數；否則整欄千分位整數；0 顯示「0」', () => {
    const f = col('foreign');
    // 手算：[−485, 20,000, 12] 的最大絕對值 20,000 ≥ 10,000 → 萬張
    const wan = colFormat([-485, 20_000, 12], f, 'lots');
    expect(wan).toEqual({ wan: true, digits: 1 });
    expect(formatAbs(485, wan)).toBe('0.0');
    expect(cellText(-485, f, 'lots', true, wan).text).toBe('▼0.0'); // 非 0 但四捨五入為 0：保留方向與小數位
    expect(cellText(0, f, 'lots', true, wan)).toMatchObject({ text: '0', dir: 'flat' });
    expect(cellText(20_000, f, 'lots', true, wan).text).toBe('▲2.0');
    expect(cellText(-12_345, f, 'lots', true, wan).text).toBe('▼1.2');
    expect(cellText(155_000, f, 'lots', true, wan).text).toBe('▲15.5');
    // 手算：[−9,999, 1,234] → 千分位整數
    const int = colFormat([-9_999, 1_234, null], f, 'lots');
    expect(int).toEqual({ wan: false, digits: 0 });
    expect(cellText(-9_999, f, 'lots', true, int).text).toBe('▼9,999');
    expect(cellText(0, f, 'lots', true, int)).toMatchObject({ text: '0', dir: 'flat' });
    expect(cellText(null, f, 'lots', true, int).text).toBe('—');
    // 億元、佔量整欄 2 位；比率 1 位
    expect(colFormat([12.3456, -3], f, 'amount')).toEqual({ wan: false, digits: 2 });
    expect(colFormat([123.456, 1], f, 'amount')).toEqual({ wan: false, digits: 1 });
    expect(colFormat([-1234.5], f, 'amount')).toEqual({ wan: false, digits: 0 });
    expect(cellText(1.5, f, 'amount', true, colFormat([1.5], f, 'amount')).text).toBe('▲1.50');
    expect(colFormat([3.21], col('shortRatio'), 'lots')).toEqual({ wan: false, digits: 1 });
  });

  it('單位換算：融資以張計、餘額在「佔成交量」時仍以張顯示、比率不隨單位變動', () => {
    const r = rows[0];
    expect(colValue(r, col('marginChg'), 'lots')).toBe(-100);
    expect(colValue(r, col('marginChg'), 'pct')).toBeCloseTo((-100_000 / 4_000_000) * 100);
    expect(colUnit(col('marginBal'), 'pct')).toBe('lots');
    expect(colValue(r, col('marginBal'), 'pct')).toBe(1200);
    expect(colValue(r, col('dtPct'), 'amount')).toBe(30);
    expect(colValue(r, col('dtVol'), 'lots')).toBe(1200);
    expect(colValue(r, col('sblBal'), 'amount')).toBeCloseTo((56_000 * 176) / 1e8);
  });

  it('區間合計：數量欄加總、餘額欄為區間增減、比率欄為區間平均', () => {
    expect(colTotal(rows, all, col('foreign'), 'lots')).toBe(19_030); // 20,000 − 485 − 485
    expect(colTotal(rows, all, col('marginBal'), 'lots')).toBe(200); // 1,200 − 1,000（區間前一日）
    expect(colTotal(rows, all, col('sblBal'), 'lots')).toBe(6); // 56,000 − 50,000 股
    expect(colTotal(rows, all, col('dtPct'), 'lots')).toBeCloseTo((10 * 2 + 20 * 3 + 30 * 4) / 9);
    expect(colTotal(rows, all, col('shortRatio'), 'lots')).toBeCloseTo(((60 + 130 + 110) / (1200 + 1300 + 1100)) * 100);
    expect(cellText(colTotal(rows, all, col('marginBal'), 'lots'), col('marginBal'), 'lots', true).text).toBe('▲200');
  });

  it('連買／連賣天數（法人欄標題下方）', () => {
    expect(streakText(colStreak(all, col('foreign')), all.length - 1)).toBe('連賣 2 日');
    expect(streakText(colStreak(all, col('trust')), all.length - 1)).toBe('連買 3+ 日');
  });

  it('VoiceOver 完整句子：「9 月 24 日，外資賣超 485 張…；收盤 176 元，下跌 2.22%」', () => {
    const s = rowSentence(rows[0], VIEW_COLS.insti, 'lots');
    expect(s).toBe('9 月 24 日，外資賣超 485 張，投信買超 12 張，自營商（自行買賣）賣超 3 張，三大法人合計賣超 476 張；收盤 176 元，下跌 2.22%');
    expect(rowSentence(rows[0], VIEW_COLS.credit, 'lots')).toContain('融資減少 100 張，融券減少 70 張，融資餘額 1,200 張，券資比 5.0%');
    expect(cellPhrase(colValue(rows[0], col('foreign'), 'pct'), col('foreign'), 'pct')).toBe('外資賣超佔成交量 12.13%');
  });

  it('複製這天資料：代號、日期、12 個主要欄位與餘額（含單位）', () => {
    const t = dayText(rows[0], 'lots', { code: '2330', name: '台積電' });
    expect(t.split('\n')[0]).toBe('台積電 2330 2026-09-24');
    expect(t).toContain('外資(張)\t-485');
    expect(t).toContain('自營商（避險）(張)\t0');
    expect(t).toContain('當沖比率(%)\t30.00');
    expect(t).toContain('成交量(張)\t4000');
  });
});
