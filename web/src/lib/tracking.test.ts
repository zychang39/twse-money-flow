import { describe, expect, it } from 'vitest';
import { collectCustomTriggers, collectPresetTriggers, evaluate, exitsTomorrow, settle, trackStats, type SignalPrices, type SignalsFile, type Strategy } from './tracking';
import { netReturn } from './backtest';

const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
const file: SignalsFile = {
  dates,
  definition: 'new',
  presets: [{ id: 'chip_concentration', label: '三方同買', triggers: { '2026-09-15': ['2330'], '2026-09-17': ['2317'], '2026-09-23': ['2454'] } }],
  bench: dates.map((_, i) => 100 + i),
  names: { 2330: '台積電', 2317: '鴻海', 2454: '聯發科' },
};
const pxFile: SignalPrices = {
  dates,
  prices: {
    '2330': { s: 1, o: [100, 101, 102, 103, 104, 105, 106, 107], c: [100, 101, 102, 103, 104, 105, 106, 107] },
    '2317': { s: 3, o: [50, null, 52, 53, 54, 55], c: [50, 51, 52, 53, 54, 55] },
    '2454': { s: 7, o: [900, 910], c: [905, 915] },
  },
};
const st: Strategy = { id: 's1', presetId: 'chip_concentration', name: '三方同買', conditions: [], horizon: 3, startAfter: '2026-09-15', enabledAt: '2026-09-15T20:00:00Z', active: true };

describe('S3 訊號追蹤', () => {
  it('只記錄啟用之後的觸發（前瞻），已記錄過的不重複', () => {
    const got = collectPresetTriggers(st, file, new Set(), 'now');
    expect(got.map((s) => `${s.code}@${s.signalDate}`)).toEqual(['2317@2026-09-17', '2454@2026-09-23']); // 9/15 的 2330 在啟用當天（含）以前，不回溯
    expect(collectPresetTriggers(st, file, new Set(got.map((g) => g.key)), 'now')).toEqual([]);
  });

  it('等待進場／持有中／已出場；停牌時進場順延', () => {
    const bench = { dates, values: file.bench };
    const px = (code: string) => ({ dates: dates.slice(pxFile.prices[code].s), open: pxFile.prices[code].o, close: pxFile.prices[code].c });
    // 2317：9/17 訊號 → 9/18 停牌（無開盤）→ 9/21 開盤 52 進場；持有 3 日 → 9/24 開盤 55 出場
    const a = evaluate({ key: 'k', strategyId: 's1', code: '2317', signalDate: '2026-09-17', firstSeen: '' }, 3, px('2317'), bench);
    expect(a).toMatchObject({ status: 'closed', entryDate: '2026-09-21', entry: 52, exitDate: '2026-09-24', exit: 55 });
    expect(a.ret).toBeCloseTo(netReturn(55 / 52 - 1, false));
    expect(a.benchRet).toBeCloseTo(107 / 103 - 1); // 9/17 收盤 → 出場前一日 9/23
    // 2454：9/23 訊號 → 9/24 進場 910、持有中，最新收盤 915
    const b = evaluate({ key: 'k2', strategyId: 's1', code: '2454', signalDate: '2026-09-23', firstSeen: '' }, 3, px('2454'), bench);
    expect(b).toMatchObject({ status: 'holding', entry: 910, mark: 915, held: 1 });
    // 今天（9/24）剛觸發 → 等待明天開盤進場
    const c = evaluate({ key: 'k3', strategyId: 's1', code: '2454', signalDate: '2026-09-24', firstSeen: '' }, 3, { dates: ['2026-09-24'], open: [910], close: [915] });
    expect(c.status).toBe('waiting');
  });

  it('出場後寫回價格；之後直接用紀錄（不受資料檔變動影響）', () => {
    const px = { dates: dates.slice(3), open: pxFile.prices['2317'].o, close: pxFile.prices['2317'].c };
    const p = evaluate({ key: 'k', strategyId: 's1', code: '2317', signalDate: '2026-09-17', firstSeen: '' }, 3, px);
    const saved = settle(p)!;
    expect(saved).toMatchObject({ entry: 52, exit: 55, exitDate: '2026-09-24' });
    expect(evaluate(saved, 3, null)).toMatchObject({ status: 'closed', entry: 52, exit: 55 });
    expect(settle(evaluate(saved, 3, null))).toBeNull();
  });

  it('累計：勝率、平均、中位數、超額（只算已出場）；明天出場的部位', () => {
    const mk = (status: 'closed' | 'holding', ret: number, excess: number | null, held?: number) => ({ sig: { key: String(ret), strategyId: 's', code: 'X', signalDate: '', firstSeen: '' }, status, ret, excess, held });
    const s = trackStats([mk('closed', 0.1, 0.05), mk('closed', -0.02, -0.03), mk('closed', 0.04, null), mk('holding', 0.5, 0.5, 3)]);
    expect(s).toMatchObject({ closed: 3, open: 1 });
    expect(s.winRate).toBeCloseTo((2 / 3) * 100);
    expect(s.avg).toBeCloseTo(4);
    expect(s.median).toBeCloseTo(4);
    expect(s.avgExcess).toBeCloseTo(1);
    expect(exitsTomorrow([mk('holding', 0, 0, 3), mk('holding', 0, 0, 2)], 3)).toHaveLength(1);
  });

  it('自訂條件：只在最新資料日晚於啟用日時記錄', () => {
    const cst = { ...st, presetId: null, startAfter: '2026-09-24' };
    expect(collectCustomTriggers(cst, '2026-09-24', ['2330'], new Set(), 'now')).toEqual([]);
    expect(collectCustomTriggers(cst, '2026-09-29', ['2330'], new Set(), 'now').map((x) => x.key)).toEqual(['s1|2330|2026-09-29']);
  });
});
