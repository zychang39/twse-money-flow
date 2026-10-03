import { describe, expect, it } from 'vitest';
import { riskCalc } from './riskCalc';
import { atrLast } from './technical';

describe('風險試算（M2，2026-10-03）：ATR 停損距離 → 股數；連續跌停情境', () => {
  it('ATR14：固定每日高低差 2、無跳空 → ATR ＝ 2；不足 15 日為 null', () => {
    const c = Array.from({ length: 30 }, () => 100);
    expect(atrLast(c.map((v) => v + 1), c.map((v) => v - 1), c)).toBeCloseTo(2, 9);
    expect(atrLast(c.slice(0, 14).map((v) => v + 1), c.slice(0, 14).map((v) => v - 1), c.slice(0, 14))).toBeNull();
  });
  it('本金 100 萬、風險 1%、價 100、ATR 2%（2 元）、k＝2 → 停損 96、每股風險 4、2 張；跌停 1～3 日', () => {
    const r = riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atrPct: 2, k: 2 });
    expect(r.ok).toBe(true);
    expect(r.stop).toBeCloseTo(96, 9);
    expect(r.perShare).toBeCloseTo(4, 9);
    expect(r.shares).toBe(2000);
    expect(r.riskAmount).toBeCloseTo(8000, 6);
    expect(r.budget).toBe(10000);
    // 跌停 1 日：90 → 虧 10 × 2000 ＝ 20,000 ＝ 本金 2%、計畫風險的 2.5 倍
    expect(r.scenarios[0]).toMatchObject({ days: 1 });
    expect(r.scenarios[0].price).toBeCloseTo(90, 9);
    expect(r.scenarios[0].loss).toBeCloseTo(20000, 6);
    expect(r.scenarios[0].lossPct).toBeCloseTo(2, 9);
    expect(r.scenarios[0].r).toBeCloseTo(2.5, 9);
    // 跌停 3 日：72.9 → 虧 27.1 × 2000 ＝ 54,200
    expect(r.scenarios[2].price).toBeCloseTo(72.9, 9);
    expect(r.scenarios[2].loss).toBeCloseTo(54200, 6);
  });
  it('缺資料或停損距離無意義時給原因，不算數字', () => {
    expect(riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: null, atrPct: 2, k: 2 }).reason).toBe('沒有收盤價');
    expect(riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atrPct: null, k: 2 }).reason).toBe('ATR 不足 15 日');
    expect(riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atrPct: 60, k: 2 }).reason).toContain('超過股價');
    // 高價股：風險上限不足 1 張 → 0 張並說明
    const r = riskCalc({ capital: 100_000, riskPct: 1, oddLot: false, price: 1000, atrPct: 2, k: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不足 1 張');
    expect(riskCalc({ capital: 100_000, riskPct: 1, oddLot: true, price: 1000, atrPct: 2, k: 2 }).shares).toBe(25);
  });
});
