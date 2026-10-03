import { describe, expect, it } from 'vitest';
import { fmtContracts, fmtRatioPct } from '../components/Market';
import { ETF_KIND_LABEL, type EtfMove } from '../data/types';
import { kindCountsText, kindOf } from '../pages/Etf';

const move = (o: Partial<EtfMove>): EtfMove => ({ code: '2330', name: '台積電', etfs: 1, net_shares: 1000, net_value: null, detail: '', ...o });

describe('主動式 ETF 持股變動分類（M2 2026-10-03）', () => {
  it('標籤只用新增／加碼／減碼／剔除（沒有買進／賣出）', () => {
    expect(Object.values(ETF_KIND_LABEL)).toEqual(['新增', '加碼', '減碼', '剔除']);
    expect(Object.values(ETF_KIND_LABEL).join()).not.toMatch(/買進|賣出|推薦/);
  });
  it('舊版資料沒有 kind 時依方向判斷加碼／減碼', () => {
    expect(kindOf(move({ kind: 'new' }))).toBe('new');
    expect(kindOf(move({ net_shares: 500 }))).toBe('add');
    expect(kindOf(move({ net_shares: -500 }))).toBe('reduce');
  });
  it('分類筆數句：pipeline 的 kinds 優先，否則以排行列計數並註明', () => {
    expect(kindCountsText({ kinds: { new: 3, add: 12, reduce: 8, exit: 1 }, add: [], reduce: [] })).toBe('新增 3・加碼 12・減碼 8・剔除 1（ETF × 股票筆數）');
    expect(kindCountsText({ kinds: { add: 2 }, add: [], reduce: [] })).toBe('新增 0・加碼 2・減碼 0・剔除 0（ETF × 股票筆數）');
    const text = kindCountsText({ add: [move({ kind: 'new' }), move({ code: '2317' })], reduce: [move({ code: '2454', net_shares: -1, kind: 'exit' })] });
    expect(text).toBe('新增 1・加碼 1・減碼 0・剔除 1（排行內的股票數）');
  });
});

describe('期貨與選擇權走勢的數字格式', () => {
  it('口數：正負號、千分位、單位；0 不帶符號；沒有資料為「—」（呼叫端附原因）', () => {
    expect(fmtContracts(12345.4)).toBe('+12,345 口');
    expect(fmtContracts(-3210)).toBe('−3,210 口');
    expect(fmtContracts(0)).toBe('0 口');
    expect(fmtContracts(500, false)).toBe('500 口');
    expect(fmtContracts(null)).toBe('—');
  });
  it('多空比 %：一位小數、U+2212 負號', () => {
    expect(fmtRatioPct(12.34)).toBe('+12.3%');
    expect(fmtRatioPct(-4)).toBe('−4.0%');
    expect(fmtRatioPct(0)).toBe('0.0%');
    expect(fmtRatioPct(undefined)).toBe('—');
  });
});

describe('主動式 ETF 頁（SPEC §7）', async () => {
  const { sortItems, coverageLine, unverifiedLine, itemSub, itemKind } = await import('../pages/Etf');
  const item = (o: Partial<import('../data/types').EtfItem>): import('../data/types').EtfItem => ({
    code: '2330', name: '台積電', dir: 'add', kind: 'add', value_yi: 1, pct_avg20: 1, pct_mcap: 0.01, etfs_same_dir: 1, etfs: [], ...o,
  });
  it('排序：依口徑絕對值由大到小，缺值排最後', () => {
    const xs = [item({ code: 'a', value_yi: 5, pct_avg20: 1, pct_mcap: null }), item({ code: 'b', value_yi: 1, pct_avg20: 9, pct_mcap: 0.2 }), item({ code: 'c', value_yi: -7, pct_avg20: -3, pct_mcap: 0.1 })];
    expect(sortItems(xs, 'value').map((x) => x.code)).toEqual(['c', 'a', 'b']);
    expect(sortItems(xs, 'pct_avg20').map((x) => x.code)).toEqual(['b', 'c', 'a']);
    expect(sortItems(xs, 'pct_mcap').map((x) => x.code)).toEqual(['b', 'c', 'a']);
  });
  it('頁首一列：涵蓋 n/N 檔・持股日 M/D；未驗證時第二行寫樣本數與期間', () => {
    expect(coverageLine({ covered: 8, total: 32, holdings_date: '2026-10-02', issuers: 4 })).toBe('涵蓋 8/32 檔・持股日 10/2');
    expect(coverageLine(undefined)).toBe('持股資料累積中');
    expect(unverifiedLine({ verified: false, metric: null, n: 156, period: ['2025-10-03', '2026-08-04'], rows: [] })).toBe('排序口徑未驗證（樣本 156 筆、2025/10/3–2026/8/4）');
    expect(unverifiedLine({ verified: false, metric: null, n: 0, period: [null, null], rows: [] })).toBe('排序口徑未驗證（樣本 0 筆）');
    expect(unverifiedLine({ verified: true, metric: 'value', n: 400, period: ['2025-10-03', '2026-08-04'], rows: [] })).toBeNull();
  });
  it('副資訊：不重複「加碼／減碼」，只標新增、剔除；同向檔數、佔市值', () => {
    expect(itemSub(item({ etfs_same_dir: 2, pct_mcap: 0.0449 }))).toBe('同向 2 檔・佔市值 0.04%');
    expect(itemSub(item({ kind: 'new', pct_mcap: 0.2303 }))).toBe('同向 1 檔・佔市值 0.23%');
    expect(itemSub(item({ dir: 'reduce', kind: 'exit', pct_mcap: -0.5 }))).toBe('同向 1 檔・佔市值 0.50%');
    expect([itemKind(item({ kind: 'new' })), itemKind(item({ kind: 'exit' })), itemKind(item({ kind: 'add' })), itemKind(item({ kind: 'reduce' }))]).toEqual(['新增', '剔除', undefined, undefined]);
    expect(itemSub(item({ pct_mcap: null }))).toBe('同向 1 檔');
  });
});
