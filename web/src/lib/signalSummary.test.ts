import { describe, expect, it } from 'vitest';
import { buildSignalPanel } from './signalSummary';
import type { StrategiesFile, StrategyItem } from './strategies';

const S = (id: string, grade: string, sigT: number, enabled = true): StrategyItem => ({
  id, test: id, label: id.toUpperCase(), subtitle: '', verdict: '', enabled, reasons: [], env: null,
  grade: { id: grade as never, label: '', notes: grade === 'valid' ? ['待前瞻驗證'] : [] },
  judge: {
    horizon: 40, t_name: '校正後 t',
    sig: { bench: 'ew', excess: 1.68, t: sigT, n: 100 },
    opp: { bench: '0050', excess: 1.24, t: 1.3, n: 100, slots: 5, period: null, port: { cagr: 1, sharpe: 1, mdd: -1 }, bench_port: { cagr: 1, sharpe: 1, mdd: -1 } },
  },
});

describe('個股頁策略訊號（2026-10-03）', () => {
  const file = {
    date: '2026-10-02', horizon: 40, env_today: { regime: true, trend: true, quarter_end: false }, slots: [5],
    leverage: {} as never,
    strategies: [S('a', 'watch', 2.6), S('b', 'valid', 3.2), S('c', 'invalid', 1.0, false), S('d', 'sig_only', 3.4), S('e', 'watch', 2.9)],
  } as StrategiesFile;
  const today = { date: '2026-10-02', tests: {}, window: 40, strategies: { b: { window: 40, t: { '2330': '2026-09-10' } }, a: { window: 40, t: {} } } };
  it('只列上架策略；依分級、再依訊號檢定 t 排序；觸發日與兩個基準的數字', () => {
    const d = buildSignalPanel(file, today, '2330');
    expect(d.items.map((x) => x.id)).toEqual(['b', 'd', 'e', 'a']);
    expect(d.items[0]).toMatchObject({ gradeLabel: '有效', date: '2026-09-10', opp: { excess: 1.24, t: 1.3 }, ew: { excess: 1.68, t: 3.2 }, notes: ['待前瞻驗證'] });
    expect(d.items[1].gradeLabel).toBe('訊號顯著・未勝 0050');
    expect(d.items[1].date).toBeNull();
    expect(d.summary).toBe('4 個策略・觸發 1');
    expect(d.window).toBe(40);
    expect(buildSignalPanel(file, today, '1101').summary).toBe('4 個策略・未觸發');
    expect(buildSignalPanel({ ...file, strategies: [] }, null, '2330').summary).toBe('無上架策略');
  });
});
