import { describe, expect, it } from 'vitest';
import { inactiveText, tradeStatusLabel, tradeStatusNote } from './tradeStatus';

describe('停牌、無成交、下市（U-01／U-02）', () => {
  it('正常交易不顯示；無成交與停牌各有文字與最後成交日', () => {
    expect(tradeStatusLabel({ trade_status: null })).toBeNull();
    expect(tradeStatusNote({ trade_status: 'no_trade', last_trade_date: '2026-09-23' })).toBe('今日無成交・最後成交 9/23');
    expect(tradeStatusNote({ trade_status: 'halted', last_trade_date: null }, '2026-09-01')).toBe('停牌中・最後成交 9/1');
  });
  it('下市或長期停牌的友善文字（不露出 HTTP 404）', () => {
    expect(inactiveText({ code: '1589', name: '永冠-KY', market: 'twse', last_trade_date: '2026-08-20', status: 'halted' })).toBe('最後成交 8/20・長期停牌中，暫停更新');
    expect(inactiveText({ code: '00883B', name: 'x', market: 'twse', last_trade_date: '2026-06-02', status: 'inactive' })).toContain('可能已下市或長期停牌');
    expect(inactiveText(undefined)).not.toContain('HTTP');
  });
});
