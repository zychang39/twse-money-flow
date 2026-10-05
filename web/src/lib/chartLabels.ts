/**
 * 圖表註記標籤的碰撞處理（2026-10-06，M3）：起始價／昨收、最高、最低等標籤彼此不重疊，也不壓到線的端點與 X 軸日期。
 * 規則：依優先順序（最高、最低 > 起始價／昨收）逐一擺放；會重疊時把低優先的往上下推開（每次 step px，最多 maxShift）；
 * 原位置推不開再試其他位置（alts，例：起始價改放虛線另一側）；都不行才隱藏低優先的。純函式，可測。
 */

export interface Rect { x: number; y: number; w: number; h: number }
/** alts：其他可放的位置（y，例：起始價可以在虛線上方或下方）；原位置推不開時依序試 */
export interface LabelBox extends Rect { id: string; priority: number; alts?: number[] }
export interface Placed extends LabelBox { hidden: boolean; dy: number }

/** 估計文字寬度（px）：中日文 1em、其餘（數字、英文、標點）約 0.62em（Inter 等寬數字）。 */
export function textWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) em += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.62;
  return Math.ceil(em * px);
}

export function overlaps(a: Rect, b: Rect, gap = 2): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** 依 text-anchor 算出標籤框的左緣 */
export function anchored(x: number, w: number, anchor: 'start' | 'middle' | 'end'): number {
  return anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
}

export function placeLabels(labels: LabelBox[], obstacles: Rect[], bounds: { top: number; bottom: number }, step = 4, maxShift = 28, gap = 3): Placed[] {
  const order = labels.map((l, i) => ({ l, i })).sort((a, b) => b.l.priority - a.l.priority || a.i - b.i);
  const placed: Placed[] = [];
  const out: Placed[] = new Array(labels.length);
  const shifts = [0];
  for (let s = step; s <= maxShift; s += step) shifts.push(-s, s);
  for (const { l, i } of order) {
    let done: Placed | null = null;
    for (const y0 of [l.y, ...(l.alts ?? [])]) {
      for (const dy of shifts) {
        const r = { ...l, y: y0 + dy };
        if (r.y < bounds.top || r.y + r.h > bounds.bottom) continue;
        if (obstacles.some((o) => overlaps(r, o, gap))) continue;
        if (placed.some((p) => !p.hidden && overlaps(r, p, gap))) continue;
        done = { ...r, hidden: false, dy: r.y - l.y };
        break;
      }
      if (done) break;
    }
    const res = done ?? { ...l, hidden: true, dy: 0 };
    placed.push(res);
    out[i] = res;
  }
  return out;
}
