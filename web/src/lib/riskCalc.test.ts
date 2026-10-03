import { describe, expect, it } from 'vitest';
import { limitDownPrice, riskCalc, stopVsLimitText, tickSize } from './riskCalc';
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
    // 風險上限連 1 股都不夠（每股風險 40 元 > 上限 10 元）→ 0 股並說明
    const tiny = riskCalc({ capital: 1_000, riskPct: 1, oddLot: false, price: 1000, atrPct: 2, k: 2 });
    expect(tiny.ok).toBe(false);
    expect(tiny.reason).toBe('風險上限低於 1 股的停損距離');
    expect(tiny.scenarios).toHaveLength(3); // 跌停表照常計算價格
  });
  it('高價股不足 1 張：自動改用零股，給股數、部位金額、佔本金 %；跌停表照常計算', () => {
    const r = riskCalc({ capital: 100_000, riskPct: 1, oddLot: false, price: 1000, atrPct: 2, k: 2 });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('odd');
    expect(r.autoOdd).toBe(true);
    expect(r.shares).toBe(25); // 1,000 ÷ 40
    expect(r.lots).toBe(0);
    expect(r.positionValue).toBe(25_000);
    expect(r.positionPct).toBeCloseTo(25, 9);
    expect(r.overCapital).toBe(false);
    expect(r.scenarios[0].price).toBe(900);
    expect(r.scenarios[0].loss).toBe(2_500);
    expect(r.scenarios[0].r).toBeCloseTo(2.5, 9);
    // 使用者設定零股模式：不算「自動」
    const odd = riskCalc({ capital: 100_000, riskPct: 1, oddLot: true, price: 1000, atrPct: 2, k: 2 });
    expect(odd.shares).toBe(25);
    expect(odd.autoOdd).toBe(false);
  });
  it('ATR 用原始價基準：直接給 atr（元）優先於 atrPct', () => {
    const r = riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atr: 3, atrPct: 2, k: 2 });
    expect(r.atr).toBe(3);
    expect(r.stop).toBeCloseTo(94, 9);
  });
  it('升降單位與跌停價：依價位無條件進位', () => {
    expect(tickSize(9.99)).toBe(0.01);
    expect(tickSize(49.95)).toBe(0.05);
    expect(tickSize(99.9)).toBe(0.1);
    expect(tickSize(499.5)).toBe(0.5);
    expect(tickSize(999)).toBe(1);
    expect(tickSize(1000)).toBe(5);
    expect(tickSize(60, true)).toBe(0.05);
    // 18,840 × 0.9 ＝ 16,956 → 5 元單位進位 16,960
    expect(limitDownPrice(18840)).toBe(16960);
    // 1,305 × 0.9 ＝ 1,174.5 → 5 元單位進位 1,175
    expect(limitDownPrice(1305)).toBe(1175);
    // 33.33 × 0.9 ＝ 29.997 → 0.05 進位 30.00
    expect(limitDownPrice(33.33)).toBe(30);
  });
  it('停損價相對一日跌停價的位置', () => {
    // 價 100、ATR 2、k 2 → 停損 96 > 一日跌停 90
    const a = riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atr: 2, k: 2 });
    expect(a.stopVsLimit).toBe('above');
    expect(a.limitDaysToStop).toBe(1);
    expect(stopVsLimitText(a)).toBe('停損價高於一日跌停價(90.00)');
    // 價 100、ATR 7、k 2 → 停損 86 < 一日跌停 90；連續 2 日跌停（81）才觸及
    const b = riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atr: 7, k: 2 });
    expect(b.stopVsLimit).toBe('below');
    expect(b.limitDaysToStop).toBe(2);
    expect(stopVsLimitText(b)).toBe('停損價低於一日跌停價(90.00)，連續 2 日跌停才觸及');
    const c = riskCalc({ capital: 1_000_000, riskPct: 1, oddLot: false, price: 100, atr: 5, k: 2 });
    expect(c.stopVsLimit).toBe('equal');
  });
});
