import { describe, expect, it } from 'vitest';
import { instReasonText } from './changes';

describe('#8 清單列理由：數字在前、格式精簡', () => {
  it('「外資＋投信 −2.4 萬張・量 70%」：萬張中間沒有空格，數字與單位不換行', () => {
    expect(instReasonText(-24_000, 34_286)).toBe('外資＋投信 −2.4 萬張・量 70%');
    expect(instReasonText(315, 1_000)).toBe('外資＋投信 +315 張・量 32%');
  });
  it('比原本的「外資＋投信淨賣 2.4 萬 張（量的 70%）」短', () => {
    expect(instReasonText(-24_000, 34_286).length).toBeLessThan('外資＋投信淨賣 2.4 萬 張（量的 70%）'.length);
  });
});
