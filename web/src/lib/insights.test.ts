import { describe, expect, it } from 'vitest';
import type { StockHistory } from '../data/types';
import type { ChipBlock } from './chips';
import { COST_RULE_NOTE, instInsight, recentNetAndCost, rollingSum } from './insights';

/** 個股檔（fn＝外陸資，不含外資自營商；pipeline 的 cost 序列另算）＋ 3 日 chip 區塊（含種子列）。 */
function fixture(fnChip: number[], ffd: number[], cost = 497.9) {
  const n = 5;
  const d = ['2026-09-26', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  const h = {
    code: 'T', name: '測試', market: 'twse', industry: null, shares: null,
    d, o: [], h: [], l: [], c: Array(n).fill(500), v: [], val: [], af: Array(n).fill(1),
    fn: [0, 0, ...fnChip.map((v) => v / 1000)], tn: Array(n).fill(0), dn: Array(n).fill(0), mb: [], sb: [], pe: [], pb: [], dy: [],
    metrics: {}, cost: { foreign20: Array(n).fill(cost) },
  } as unknown as StockHistory;
  const chip: ChipBlock = {
    d: d.slice(1), c: [500, 500, 500, 500], chg: [null, 0, 0, 0], v: [1e6, 1e6, 1e6, 1e6], avg: [100, 110, 120, 130], af: [1, 1, 1, 1],
    mb: [0, 0, 0, 0], sb: [0, 0, 0, 0], fn: [0, ...fnChip], ffd: [0, ...ffd], tn: [0, 0, 0, 0], dn: [0, 0, 0, 0], dself: [0, 0, 0, 0], dhedge: [0, 0, 0, 0],
    tot: [0, ...fnChip.map((v, i) => v + ffd[i])], sbls: [null, null, null, null], dt: [null, null, null, null],
  };
  return { h, chip };
}

describe('白話重點（2026-10-02 健檢 #3／#11）', () => {
  it('近 20 日淨賣超 → 不顯示估計成本，寫「不估成本」，不再用 pipeline 的 cost 序列（497.9）', () => {
    const { h, chip } = fixture([-100_000, -200_000, -212_000], [0, 0, 0]);
    const r = instInsight(h, 'foreign', chip);
    expect(r.title).toBe('外資近 3 日淨賣 512 張');
    expect(r.est).toBeNull();
    expect(r.lines).toContain('外資近 3 日為淨賣超，不估成本。');
    expect(JSON.stringify(r)).not.toContain('497.9');
  });

  it('淨買超 → 成本＝淨買超日均價 × 還原因子加權（與區間統計 estimatedCost 同定義）；外資含外資自營商（fn＋ffd）', () => {
    // 均價：9/30 110、10/01 120、10/02 130。淨買超日：10/01 +200,000 股 @120、10/02 +(50,000＋50,000) 股 @130（9/30 賣超不計）
    // → (200,000×120 ＋ 100,000×130) ÷ 300,000 ＝ 123.33
    const { h, chip } = fixture([-50_000, 200_000, 50_000], [0, 0, 50_000]);
    const r = recentNetAndCost(h, 'foreign', chip);
    expect(r.net).toBe(250); // 張：−50 ＋ 200 ＋ 100
    expect(r.cost).toBeCloseTo(123.3333, 3);
    const ins = instInsight(h, 'foreign', chip);
    expect(ins.est).toContain('外資近 3 日估計成本約 123.3 元');
    expect(ins.est).toContain('淨買超日均價加權、還原價');
    expect(ins.definition).toBe('外資＝外陸資＋外資自營商（與每日籌碼表相同）');
    // 柱狀圖的值也含外資自營商：10/02 ＝ 50,000 ＋ 50,000 股 ＝ 100 張
    expect(ins.values).toEqual([-50, 200, 100]);
    expect(ins.dates).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('沒有 chip 區塊 → 以個股檔加總、不估成本，並寫明外資不含外資自營商；每一句帶所選法人的名字', () => {
    const { h: base } = fixture([100_000, 100_000, 100_000], [0, 0, 0]);
    // 滾動 20 日加總需要至少 20 個交易日
    const n = 25;
    const h = { ...base, d: Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`), c: Array(n).fill(500), af: Array(n).fill(1), fn: Array(n).fill(100), tn: Array(n).fill(-1), dn: Array(n).fill(2) } as unknown as StockHistory;
    const r = instInsight(h, 'foreign', null);
    expect(r.title).toBe('外資近 20 日淨買 2,000 張');
    expect(r.est).toBeNull();
    expect(r.definition).toBe('外資＝外陸資（不含外資自營商）');
    expect(r.lines.some((l) => l.includes('估計成本需要每日籌碼明細'))).toBe(true);
    for (const who of ['trust', 'dealer'] as const) {
      const x = instInsight(h, who, null);
      expect(x.title.startsWith(who === 'trust' ? '投信' : '自營商')).toBe(true);
      for (const l of x.lines) expect(l).not.toMatch(/^外資/);
    }
    expect(COST_RULE_NOTE).toContain('只在近 20 日合計為淨買超時顯示');
  });

  it('rollingSum：不足 n 日為 null', () => {
    expect(rollingSum([1, 2, 3], 2)).toEqual([null, 3, 5]);
  });
});
