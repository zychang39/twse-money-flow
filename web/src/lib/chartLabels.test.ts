import { describe, expect, it } from 'vitest';
import { overlaps, placeLabels, textWidth } from './chartLabels';

describe('圖表註記標籤碰撞（M3）', () => {
  it('台積電 5Y：「起始價 523.2」與「最低 346.4」重疊 → 最低不動，起始價往上下推開', () => {
    const lo = { id: 'lo', x: 20, y: 150, w: textWidth('最低 346.4', 13), h: 15, priority: 2 };
    const base = { id: 'base', x: 16, y: 146, w: textWidth('起始價 523.2', 13) + 4, h: 18, priority: 1 };
    const [pb, pl] = placeLabels([base, lo], [], { top: 0, bottom: 220 });
    expect(pl).toMatchObject({ hidden: false, dy: 0, y: 150 });
    expect(pb.hidden).toBe(false);
    expect(overlaps(pb, pl, 0)).toBe(false);
  });
  it('「昨收」太靠近 X 軸日期 → 往上推，不壓到日期', () => {
    const date = { x: 12, y: 205, w: 64, h: 15 };
    const base = { id: 'base', x: 16, y: 202, w: 90, h: 18, priority: 1 };
    const [pb] = placeLabels([base], [date], { top: 0, bottom: 220 });
    expect(pb.hidden).toBe(false);
    expect(pb.y + pb.h).toBeLessThanOrEqual(205 - 3);
  });
  it('推不開就隱藏低優先的', () => {
    const hi = { id: 'hi', x: 0, y: 0, w: 200, h: 40, priority: 2 };
    const base = { id: 'base', x: 0, y: 10, w: 200, h: 18, priority: 1 };
    const [ph, pb] = placeLabels([hi, base], [], { top: 0, bottom: 44 }, 4, 8);
    expect(ph.hidden).toBe(false);
    expect(pb.hidden).toBe(true);
  });
  it('文字寬度：中文 1em、數字約 0.62em', () => {
    expect(textWidth('最低', 13)).toBe(26);
    expect(textWidth('346.4', 10)).toBe(31);
  });
});

describe('起始價可以換到虛線另一側', () => {
  it('下方被最低與線的起點擋住 → 改放虛線上方', () => {
    const lo = { id: 'lo', x: 57, y: 159, w: 71, h: 15, priority: 2 };
    const base = { id: 'base', x: 16, y: 154, alts: [128], w: 88, h: 18, priority: 1 };
    const p0 = { x: 6, y: 144, w: 12, h: 12 };
    const [, pb] = placeLabels([lo, base], [p0], { top: 0, bottom: 176 });
    expect(pb.hidden).toBe(false);
    expect(pb.y + pb.h).toBeLessThanOrEqual(144 - 3);
  });
});
