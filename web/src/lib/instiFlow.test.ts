import { describe, expect, it } from 'vitest';
import golden from '../../../tests/fixtures/golden/chip_3450_20261005.json';
import type { ChipBlock } from './chips';
import { cellText } from './chips';
import { INSTI_COLS, DEFAULT_PREFS, instiWindow, maxAbsLots, parsePrefs, shownCount, streakTitle } from './instiFlow';
import { springEase } from '../components/stock/InstiBars';

const chip = golden.chip as unknown as ChipBlock;
const lots = (v: number | null) => (v === null ? null : Math.round(v));

describe('法人區塊（3450 聯鈞，線上 10/5 22:42 版資料：10/5 三大法人尚未取得）', () => {
  it('10 日區間合計：外資 ▼8,408、投信 ▲1,813、自營商 ▼83、合計 ▼6,678；標註「不含 10/05」', () => {
    const w = instiWindow(chip, 10)!;
    expect(w.rows).toHaveLength(10);
    expect(w.rows[0].date).toBe('2026-10-05');
    expect(w.rows[9].date).toBe('2026-09-18');
    expect(lots(w.totals.foreign.lots)).toBe(-8408);
    expect(lots(w.totals.trust.lots)).toBe(1813);
    expect(lots(w.totals.dealer.lots)).toBe(-83);
    expect(lots(w.totals.total.lots)).toBe(-6678);
    expect(w.missing).toEqual(['2026-10-05']);
    expect(cellText(w.totals.foreign.lots, INSTI_COLS.foreign, 'lots', true, { digits: 0 }).text).toBe('▼8,408');
  });

  it('20 日：外資 −13,619（佔量 10.2%）、合計 −14,252（佔量 10.7%）', () => {
    const w = instiWindow(chip, 20)!;
    expect(lots(w.totals.foreign.lots)).toBe(-13619);
    expect(w.totals.foreign.pctVolume!.toFixed(1)).toBe('-10.2');
    expect(lots(w.totals.total.lots)).toBe(-14252);
    expect(w.totals.total.pctVolume!.toFixed(1)).toBe('-10.7');
  });

  it('合計用官方數字（chip.tot），不自行加總', () => {
    const w = instiWindow(chip, 5)!;
    const r = w.rows.find((x) => x.date === '2026-10-02')!;
    expect(r.total).toBe(-241075);
  });

  it('60 日：60 列；最大單日絕對值＝圖表右上角「最大 X 張」', () => {
    const w = instiWindow(chip, 60)!;
    expect(w.rows).toHaveLength(60);
    const w10 = instiWindow(chip, 10)!;
    expect(Math.round(maxAbsLots(w10.rows, 'total')!)).toBe(2394);
  });

  it('連續天數略過尚未公布的最新一日（10/5 沒有資料不會把連續歸零）', () => {
    const w = instiWindow(chip, 20)!;
    expect(w.totals.foreign.streak).toBeLessThan(0);
    expect(streakTitle(w.totals)).toMatch(/^外資連賣 \d+ 日・投信/);
  });

  it('折疊：5、10 日全部列出；20、60 日預設 10 列', () => {
    expect(shownCount(5, false)).toBe(5);
    expect(shownCount(10, false)).toBe(10);
    expect(shownCount(20, false)).toBe(10);
    expect(shownCount(60, true)).toBe(60);
  });
});

describe('區間與法人偏好（localStorage，壞資料退回預設）', () => {
  it('parsePrefs', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"days":60,"party":"total"}')).toEqual({ days: 60, party: 'total' });
    expect(parsePrefs('{"days":7,"party":"x"}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
  });
});

describe('spring', () => {
  it('從 0 開始、到 1 結束、中間略過衝', () => {
    expect(springEase(0)).toBe(0);
    expect(springEase(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 20 }, (_, i) => springEase(i / 20)))).toBeGreaterThan(1);
  });
});
