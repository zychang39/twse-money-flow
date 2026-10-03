import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageItems, stageLine, stageLineText } from './stages';
import { makeCalendar } from './tradingCalendar';

const schedule = { close: { label: '收盤行情', time: '14:15' }, insti: { label: '法人', time: '15:30' }, credit: { label: '信用', time: '21:30' } };
const golden = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/golden/calendar_2026.json', import.meta.url), 'utf8'),
) as { closed: string[]; years: number[] };
const cal = makeCalendar(golden);

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

describe('狀態列依交易日曆（M1-2）：休市不是等待', () => {
  const meta = { schedule, stages: { date: '2026-10-02', close: { status: 'done', at: '14:20', waited: 5 }, insti: { status: 'done', at: '15:35', waited: 5 } } };
  it('10/3（週六）：最近交易日 10/2 的結果，信用「未更新」而不是「等待」', () => {
    const line = stageLine(meta, '2026-10-03', cal, '10:00');
    expect(line.kind).toBe('holiday');
    expect(stageLineText(line)).toBe('休市・最近交易日 10/2：收盤行情 完成・法人 完成・信用 未更新');
    expect(line.items.map((s) => s.state)).toEqual(['done', 'done', 'waiting']);
  });
  it('10/9、10/10 國慶連假：最近交易日是 10/8；沒有該日的狀態 → 全部未更新（不是等待、不是琥珀）', () => {
    for (const d of ['2026-10-09', '2026-10-10', '2026-10-11']) {
      const line = stageLine(meta, d, cal, '20:00');
      expect(line.prefix).toBe('休市・最近交易日 10/8：');
      expect(line.items.every((s) => s.text === '未更新' && s.state === 'waiting')).toBe(true);
    }
  });
  it('9/28 教師節補假：最近交易日跳過 9/25（臨時休市）與週末 → 9/24', () => {
    const line = stageLine({ schedule, stages: { date: '2026-09-24', close: { status: 'done', at: '14:20', waited: 5 }, insti: { status: 'late', at: '16:30', waited: 60 }, credit: { status: 'done', at: '21:35', waited: 5 } } }, '2026-09-28', cal, '09:00');
    expect(stageLineText(line)).toBe('休市・最近交易日 9/24：收盤行情 完成・法人 逾時・信用 完成');
    expect(line.items[1].state).toBe('late');
  });
  it('交易日 14:15 之前：一句「今天尚未開始更新」，不列三個等待', () => {
    const line = stageLine(meta, '2026-10-05', cal, '09:30');
    expect(line.kind).toBe('before');
    expect(line.items).toEqual([]);
    expect(stageLineText(line)).toBe('今天尚未開始更新（約 14:15 起）');
  });
  it('交易日 14:15 之後：維持原本的今日分段', () => {
    const line = stageLine(meta, '2026-10-02', cal, '16:00');
    expect(line.kind).toBe('today');
    expect(stageLineText(line)).toBe('收盤行情 14:20 完成・法人 15:35 完成・信用 等待（約 21:30）');
    // 已經有今天的分段結果時，即使時間還早（提早完成）也照實列出
    expect(stageLine(meta, '2026-10-02', cal, '09:00').kind).toBe('today');
  });
  it('沒有日曆資料（舊版 meta）：退回今日分段', () => {
    expect(stageLine(meta, '2026-10-03', null, '16:00').kind).toBe('today');
    expect(stageLine({ schedule: undefined, stages: null }, '2026-10-03', cal, '10:00').items).toEqual([]);
  });
});
