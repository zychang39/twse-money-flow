import { describe, expect, it } from 'vitest';
import { extractStocks, findCodes, importSummary, toHalfWidth, type ImportRow } from './watchImport';

const rows: ImportRow[] = [
  { code: '0050', name: '元大台灣50' }, { code: '1802', name: '台玻' }, { code: '3016', name: '嘉晶' }, { code: '3029', name: '零壹' },
  { code: '3707', name: '漢磊' }, { code: '5347', name: '世界' }, { code: '6443', name: '元晶' }, { code: '6538', name: '倉和' },
  { code: '6930', name: '盛新' }, { code: '8028', name: '昇陽半導體' }, { code: '3028', name: '增你強' }, { code: '2330', name: '台積電' },
  { code: '1714', name: '和桐' }, { code: '2535', name: '達欣工' }, { code: '00981A', name: '主動統一台股增長' }, { code: '2454', name: '聯發科' },
  { code: '2317', name: '鴻海' }, { code: '006208', name: '富邦台50' },
];
const known = new Set(rows.map((r) => r.code));

// 真實券商庫存截圖（深色畫面反白後）的辨識結果；帳號與姓名已換成假的
const ENG = `10:30 = 8 wee ail 56 GD
N 9Z99-0123456 2E{H5% = Q
IEE 43675.12 4583.25 EES 342.41 AC ~
-70,353 -2.50% 2,810,346
TRE Be 5,000 2,535
0050 511,258 0.50%
any —- 1,000 805
1802 x 84,724 0.96%
= BE 1,000 -1714
3016 x 121,461 -1.39%
BE Lo 1,000 2198
3029 x 137,390 1.63%
mE —- 4,000 -3,395
3707 x 236,947 -1.41%
Hs —- 2.000 -3,581
5347 x 268,806 -1.31%
TE —- 10,000 -29,439
6443 x 264,328 -10.02%
I=L! HAR 1,000 -3,218 vee
6538 x 292,202 -1.09%
BL 3F —- 3,000 172
6930 x 98,562 0.17%
1,000 -3,191
8028 202,601 -1.55%`;
const CHI = `台 股 庫存
< 9Z99-0123456 王 小 明 回 以
加 權 指 43675.12 A583.25 櫃 買 指 342.41
2 人 台 漲 現 股 5,000 2,535
0050 511,258 0.50%
台 玻 現 股 1,000 805
1802 加 84,724 0.96%
嘉 晶 現 股 1,000 -1714
3016 加 121,461 -1.39%
零 壹 現 股 1000 2198
3029 加 137,390 1.63%
漢 舌 現 股 4,000 -3,395
3707 加 236,947 -1.41%
世界 現 股 2,000 -3,581
5347 加 268,806 -1.31%
元 晶 現 股 10,000 -29,439
6443 加 264,328 -10.02%
倉 和 現 股 1,000 -3,218
6538 加 292,202 -1.09%
盛 新 現 股 3,000 172
6930 加 98,562 0.17%
昇 陽
1,000 -3,191
半導體 現 股
8028 202,601 -1.55%
總 覽 選 股 自 選 帳 務`;
const HOLD = ['0050', '1802', '3016', '3029', '3707', '5347', '6443', '6538', '6930', '8028'];

describe('從截圖或貼上的文字找出股票', () => {
  it('代號：金額、指數、比率、帳號、帶正負號的損益都不算', () => {
    expect(findCodes(ENG, known).map((c) => c.code)).toEqual(HOLD);
    expect(findCodes('2,535 43675.12 2330% -1714 +2330 −2454 A2330 23301', known)).toEqual([]);
    expect(findCodes('2330.TW、2454 (00981A) ２３１７ 006208', known).map((c) => c.code)).toEqual(['2330', '2454', '00981A', '2317', '006208']);
    expect(findCodes('9999 1234', known)).toEqual([]); // 不在股票清單裡
    expect(toHalfWidth('２３３０　ＡＢ')).toBe('2330 AB');
  });

  it('真實截圖：10 檔全對；名稱核對（折行的「昇陽／半導體」算對到，讀錯字的「漢舌」只對到代號）', () => {
    const first = extractStocks([ENG], rows).items;
    expect(first.map((c) => c.code)).toEqual(HOLD); // 英數那一段先給結果
    expect(first.every((c) => c.match === 'code' && c.checked)).toBe(true);
    const both = extractStocks([ENG, CHI], rows).items;
    expect(both.map((c) => c.code)).toEqual(HOLD);
    expect(both.filter((c) => c.match === 'code').map((c) => c.code)).toEqual(['0050', '3707']); // 名稱被折行、讀錯字
    expect(both.find((c) => c.code === '8028')).toMatchObject({ name: '昇陽半導體', match: 'both', checked: true });
    expect(importSummary(both, new Set(['1802']))).toEqual({ found: 10, fresh: 9, review: 2 });
  });

  it('代號讀錯成另一檔真實的股票（8028 → 3028）：錯的只對到代號，對的由名稱找回來', () => {
    const got = extractStocks([CHI.replace('8028 202,601', '3028 202,601').replace('昇 陽\n1,000 -3,191\n半導體', '昇 陽 半導體')], rows).items;
    expect(got.find((c) => c.code === '3028')).toMatchObject({ name: '增你強', match: 'code' });
    expect(got.find((c) => c.code === '8028')).toMatchObject({ match: 'name', checked: true });
  });

  it('同一欄：沒有千分位的損益「2330」不在代號那一欄 → 預設不勾；名稱也對到的不受影響', () => {
    const w = (text: string, x: number) => ({ text, x });
    const words = [w('0050', 0.08), w('1802', 0.08), w('3016', 0.09), w('3029', 0.08), w('2330', 0.86), w('511,258', 0.55)];
    const got = extractStocks([{ text: words.map((x) => x.text).join(' '), words }], rows).items;
    expect(got.find((c) => c.code === '2330')).toMatchObject({ checked: false, offColumn: true });
    expect(got.filter((c) => c.checked).map((c) => c.code)).toEqual(['0050', '1802', '3016', '3029']);
    const named = extractStocks([{ text: `${words.map((x) => x.text).join(' ')} 台積電`, words }], rows).items;
    expect(named.find((c) => c.code === '2330')).toMatchObject({ match: 'both', checked: true });
    // 代號太少（不到 4 個）不判斷欄位
    expect(extractStocks([{ text: '0050 2330', words: [w('0050', 0.1), w('2330', 0.9)] }], rows).items.every((c) => c.checked)).toBe(true);
  });

  it('有位置時：名稱讀錯一個字也算對到（看代號附近那幾列）；同一欄卻不在清單的代號列為「不在清單」', () => {
    // 瀏覽器裡實測的版面：名稱在代號的上一列，代號在左邊同一欄；中文把「嘉晶」讀成「嘉唱」、「元晶」讀成「元品」
    const line = (y: number, ...ws: [string, number][]) => ws.map(([text, x]) => ({ text, x, y }));
    const words = [
      ...line(0.20, ['台', 0.05], ['玻', 0.09], ['1,000', 0.55]), ...line(0.23, ['1802', 0.08], ['現', 0.27], ['股', 0.31], ['84,724', 0.55]),
      ...line(0.26, ['嘉', 0.05], ['唱', 0.09], ['1,000', 0.55]), ...line(0.29, ['3016', 0.08], ['現', 0.27], ['股', 0.31], ['121,461', 0.55]),
      ...line(0.32, ['元', 0.05], ['品', 0.09], ['10,000', 0.55]), ...line(0.35, ['6443', 0.08], ['現', 0.27], ['股', 0.31], ['264,328', 0.55]),
      ...line(0.38, ['盛', 0.05], ['新', 0.09], ['3,000', 0.55]), ...line(0.41, ['6930', 0.08], ['現', 0.27], ['股', 0.31], ['98,562', 0.55]),
      ...line(0.44, ['漢', 0.05], ['舌', 0.09], ['4,000', 0.55]), ...line(0.47, ['3707', 0.08], ['現', 0.27], ['股', 0.31], ['236,947', 0.55]),
      ...line(0.50, ['亂', 0.05], ['碼', 0.09], ['2,000', 0.55]), ...line(0.53, ['5347', 0.08], ['現', 0.27], ['股', 0.31], ['7777', 0.55]),
    ];
    const listed = rows.filter((r) => r.code !== '6930'); // 興櫃股不在 App 的股票清單裡
    const res = extractStocks([{ text: words.map((x) => x.text).join(' '), words }], listed);
    expect(res.items.map((c) => [c.code, c.match])).toEqual([
      ['1802', 'both'], ['3016', 'both'], ['6443', 'both'], ['3707', 'both'], ['5347', 'code'], // 世界：附近的字完全對不上
    ]);
    expect(res.unknown).toEqual(['6930']); // 盛新是興櫃股，不在上市櫃清單；7777 不在代號那一欄，不算
  });

  it('只有名稱的券商畫面、貼上的文字：三個字以上的名稱預設勾，兩個字的不勾；短名稱被長名稱包住只留長的', () => {
    const got = extractStocks(['台積電 現股 1,000\n聯發科 2,000\n世界 500\n富邦台50 3,000'], rows).items;
    expect(got.map((c) => [c.code, c.match, c.checked])).toEqual([
      ['2330', 'name', true], ['2454', 'name', true], ['5347', 'name', false], ['006208', 'name', true],
    ]);
    expect(extractStocks(['2330 台積電\n2317 鴻海'], rows).items.every((c) => c.match === 'both')).toBe(true);
    expect(extractStocks(['今天沒有持股'], rows)).toEqual({ items: [], unknown: [] });
  });
});
