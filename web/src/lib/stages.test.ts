import { describe, expect, it } from 'vitest';
import { stageItems } from './stages';

const schedule = { close: { label: '收盤行情', time: '14:15' }, insti: { label: '法人', time: '15:30' }, credit: { label: '信用', time: '21:30' } };

describe('分段更新狀態列', () => {
  it('今天：完成／逾時／等待', () => {
    const meta = { schedule, stages: { date: '2026-09-30', close: { status: 'done', at: '14:20', waited: 5 }, insti: { status: 'late', at: '16:30', waited: 60 } } };
    expect(stageItems(meta, '2026-09-30').map((s) => `${s.label} ${s.text}`)).toEqual(['收盤行情 14:20 完成', '法人 逾時・下一段補抓', '信用 等待（約 21:30）']);
  });
  it('狀態是前一天的 → 全部等待', () => {
    const meta = { schedule, stages: { date: '2026-09-29', close: { status: 'done', at: '14:20', waited: 5 } } };
    expect(stageItems(meta, '2026-09-30').every((s) => s.state === 'waiting')).toBe(true);
  });
});
