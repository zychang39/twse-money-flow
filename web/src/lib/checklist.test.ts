import { describe, expect, it } from 'vitest';
import { checklistCalc, priceOf, type ChecklistInput } from './checklist';

const P = { capital: 1_000_000, riskPct: 1, oddLot: false };
const done: ChecklistInput = { hasStock: true, entry: '', stop: '', target: '', shares: '' };

describe('#10 新增持倉前檢查表', () => {
  it('空字串不是 0', () => {
    expect(priceOf('')).toBeNull();
    expect(priceOf('  ')).toBeNull();
    expect(priceOf('0')).toBeNull();
    expect(priceOf('112.4')).toBe(112.4);
  });

  it('重現 A：停損與目標都還沒填 → 不算風險報酬比與建議部位', () => {
    const c = checklistCalc({ ...done, entry: '112.4' }, P);
    expect(c.rr).toBeNull();
    expect(c.rrText).toBe('—（未填停損與目標，無法計算）');
    expect(c.size).toBeNull();
    expect(c.sizeText).toBe('—（未填停損，無法依單筆風險換算）');
    expect(c.lossIfStopped).toBeNull();
    // 2026-10-06：停損選填 → 沒有建議部位時卡在「實際股數」，不再卡在停損
    expect(c.blocker).toBe('請填入「實際股數」');
    const typed = checklistCalc({ ...done, entry: '112.4', shares: '1000' }, P);
    expect(typed.blocker).toBeNull();
  });

  it('只填停損 → 可算建議部位，風險報酬比等目標', () => {
    const c = checklistCalc({ ...done, entry: '100', stop: '95' }, P);
    expect(c.size).toEqual({ shares: 2000, lots: 2 });
    expect(c.rrText).toBe('—（未填目標，無法計算）');
    expect(c.blocker).toBeNull(); // 目標選填；股數預設為建議部位
  });

  it('停損 ≥ 進場、目標 ≤ 進場 → 不計算，只在欄位下方說明，不擋送出', () => {
    const c = checklistCalc({ ...done, entry: '100', stop: '100', target: '120', shares: '1000' }, P);
    expect(c.rr).toBeNull();
    expect(c.size).toBeNull();
    expect(c.rrText).toBe('—（停損不低於進場價，無法計算）');
    expect(c.stopNote).toMatch(/^停損價不低於進場價/);
    expect(c.blocker).toBeNull();
    const t = checklistCalc({ ...done, entry: '100', stop: '95', target: '100' }, P);
    expect(t.rr).toBeNull();
    expect(t.rrText).toBe('—（目標不高於進場價，無法計算）');
    expect(t.targetNote).toMatch(/^目標價不高於進場價/);
    expect(t.blocker).toBeNull();
  });

  it('重現 B：進場 190、停損 170、目標 250 → 建議 0 張；按鈕寫出真正卡住的是股數 0', () => {
    const c = checklistCalc({ ...done, entry: '190', stop: '170', target: '250' }, P);
    expect(c.rr).toBeCloseTo(3); // (250 − 190) ÷ (190 − 170)
    expect(c.size).toEqual({ shares: 0, lots: 0 }); // 100 萬 × 1% ÷ 20 = 500 股 → 0 張
    expect(c.shares).toBe(0);
    expect(c.blocker).toBe('股數為 0：風險上限換算的股數小於 1 張，請改用零股或自行輸入股數');
    // 自行輸入 500 股 → 可以加入
    const typed = checklistCalc({ ...done, entry: '190', stop: '170', target: '250', shares: '500' }, P);
    expect(typed.blocker).toBeNull();
    expect(typed.lossIfStopped).toBe(10_000);
    // 零股模式 → 建議 500 股
    expect(checklistCalc({ ...done, entry: '190', stop: '170', target: '250' }, { ...P, oddLot: true }).shares).toBe(500);
    expect(checklistCalc({ ...done, entry: '190', stop: '170', target: '250', shares: '0' }, P).blocker).toBe('請輸入大於 0 的股數');
  });

  it('2026-10-06：只有選股、進場價、股數會擋送出；1–5 與理由空白不擋', () => {
    expect(checklistCalc({ ...done, market: '', reason: '', entry: '100', shares: '1000' }, P).blocker).toBeNull();
    expect(checklistCalc({ ...done, shares: '1000' }, P).blocker).toBe('請填入「進場價」');
    expect(checklistCalc({ ...done, hasStock: false }, P).blocker).toBe('請先選擇股票');
    expect(checklistCalc({ ...done, hasStock: false }, P).qualitative).toBe(false);
    expect(checklistCalc({ ...done, reason: '' }, P).qualitative).toBe(true);
    // 舊的阻擋文案不再出現
    for (const c of [checklistCalc({ ...done, entry: '100' }, P), checklistCalc(done, P)]) expect(c.blocker).not.toMatch(/請選擇「|請填寫理由|停損價要低於|目標價要高於/);
  });
});
