import { describe, expect, it } from 'vitest';
import { checklistCalc, priceOf, type ChecklistInput } from './checklist';

const P = { capital: 1_000_000, riskPct: 1, oddLot: false };
const done: ChecklistInput = { hasStock: true, market: '中性', trend: '多頭（年線、季線之上）', revenue: '成長', valuation: '合理', reason: '法人連買', entry: '', stop: '', target: '', shares: '' };

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
    expect(c.rrText).toBe('—（填入停損與目標後計算）');
    expect(c.size).toBeNull();
    expect(c.sizeText).toBe('—（填入停損後計算）');
    expect(c.lossIfStopped).toBeNull();
    expect(c.blocker).toBe('請填入「6. 停損價」');
  });

  it('只填停損 → 可算建議部位，風險報酬比等目標', () => {
    const c = checklistCalc({ ...done, entry: '100', stop: '95' }, P);
    expect(c.size).toEqual({ shares: 2000, lots: 2 });
    expect(c.rrText).toBe('—（填入目標後計算）');
    expect(c.blocker).toBe('請填入「7. 目標價」');
  });

  it('停損 ≥ 進場 → 不計算，提示價格順序', () => {
    const c = checklistCalc({ ...done, entry: '100', stop: '100', target: '120' }, P);
    expect(c.rr).toBeNull();
    expect(c.size).toBeNull();
    expect(c.rrText).toBe('—（停損要低於進場價）');
    expect(c.blocker).toBe('停損價要低於進場價');
    expect(checklistCalc({ ...done, entry: '100', stop: '95', target: '100' }, P).blocker).toBe('目標價要高於進場價');
  });

  it('重現 B：進場 190、停損 170、目標 250 → 建議 0 張；按鈕寫出真正卡住的是股數 0', () => {
    const c = checklistCalc({ ...done, entry: '190', stop: '170', target: '250' }, P);
    expect(c.rr).toBeCloseTo(3); // (250 − 190) ÷ (190 − 170)
    expect(c.size).toEqual({ shares: 0, lots: 0 }); // 100 萬 × 1% ÷ 20 = 500 股 → 0 張
    expect(c.shares).toBe(0);
    expect(c.blocker).toBe('股數為 0：依風險上限不足 1 張，請改用零股或自行輸入股數');
    // 自行輸入 500 股 → 可以加入
    const typed = checklistCalc({ ...done, entry: '190', stop: '170', target: '250', shares: '500' }, P);
    expect(typed.blocker).toBeNull();
    expect(typed.lossIfStopped).toBe(10_000);
    // 零股模式 → 建議 500 股
    expect(checklistCalc({ ...done, entry: '190', stop: '170', target: '250' }, { ...P, oddLot: true }).shares).toBe(500);
    expect(checklistCalc({ ...done, entry: '190', stop: '170', target: '250', shares: '0' }, P).blocker).toBe('請輸入大於 0 的股數');
  });

  it('缺理由或題目 → 依序指出第一個缺少的', () => {
    expect(checklistCalc({ ...done, market: '' }, P).blocker).toBe('請選擇「1. 市場燈號」');
    expect(checklistCalc({ ...done, reason: ' ' }, P).blocker).toBe('請填寫理由');
    expect(checklistCalc({ ...done, hasStock: false }, P).blocker).toBe('請先選擇股票');
    expect(checklistCalc({ ...done, reason: '' }, P).qualitative).toBe(false);
  });
});
