import { describe, expect, it } from 'vitest';
import { lightSub } from '../components/Market';
import { dispositionSub, md } from '../pages/Disposition';
import { eventSub } from '../pages/Calendar';
import type { MarketLight } from '../data/types';

const light = (o: Partial<MarketLight>): MarketLight => ({ id: 'futures', label: '外資台指期淨未平倉', state: 'red', value: '-80,345 口（2026-10-02）', basis: '', ...o });

describe('市場溫度、處置與注意、行事曆的副資訊（2026-10 改版）', () => {
  it('燈號副資訊：日期縮成 M/D，外資期貨加近 250 日百分位', () => {
    expect(lightSub(light({ detail: '2026-10-02', pct250: 16.4 }))).toBe('10/2・近 250 日百分位 16');
    expect(lightSub(light({ id: 'fx', detail: 'USD/TWD・20 日 +0.32%', pct250: null }))).toBe('USD/TWD・20 日 +0.32%');
    // 舊資料沒有 detail → 用 value
    expect(lightSub(light({ id: 'ma240', value: '+30.6%' }))).toBe('+30.6%');
  });
  it('處置列：期間與措施，不含預測字眼', () => {
    const r = { code: '3016', name: '嘉晶', start: '2026-10-01', end: '2026-10-12', reason: '連續三次', measure: '第一次處置', interval_minutes: 2 };
    expect(dispositionSub(r)).toBe('10/1–10/12・第一次處置');
    expect(dispositionSub({ ...r, measure: null })).toBe('10/1–10/12');
    expect(md('2026-09-05')).toBe('9/5');
    expect(dispositionSub(r)).not.toMatch(/可能/);
  });
  it('行事曆副資訊最多一行：長說明只留第一個子句', () => {
    expect(eventSub('現金股利 3.5 元')).toBe('現金股利 3.5 元');
    expect(eventSub('14:30 115年第三季營運報告，及說明115年第四季營運展望')).toBe('14:30 115年第三季營運報告');
    expect(eventSub('一二三四五六七八九十一二三四五六七八九十一二三四')).toHaveLength(22);
  });
});
