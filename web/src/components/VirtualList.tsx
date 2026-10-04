/**
 * 虛擬捲動清單（F 節：長清單只畫看得到的列）：跟著視窗捲動，列高先用估計值、畫出後量實際高度再修正（名稱可換行，列高不固定）。
 * 前後各多畫 overscan 列；減少動態效果不影響（沒有動畫）。清單本身是 role="list"，每列 role="listitem"。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

export function VirtualList<T>({ items, keyOf, render, estimate = 76, overscan = 6, label, testid, class: cls }: {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ComponentChildren;
  /** 列高估計（px） */
  estimate?: number;
  overscan?: number;
  label?: string;
  testid?: string;
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const [win, setWin] = useState<[number, number]>([0, Math.min(items.length, 24)]);
  const offsets = useMemo(() => {
    const o = [0];
    for (const it of items) o.push(o[o.length - 1] + (heights.current.get(keyOf(it)) ?? estimate));
    return o;
  }, [items, tick, estimate]);

  const calc = () => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const lo = -top, hi = vh - top;
    let s = 0;
    while (s < items.length && offsets[s + 1] < lo) s++;
    let e = s;
    while (e < items.length && offsets[e] < hi) e++;
    const start = Math.max(0, s - overscan), end = Math.min(items.length, e + overscan);
    setWin((w) => (w[0] === start && w[1] === end ? w : [start, end]));
  };
  useEffect(() => {
    calc();
    window.addEventListener('scroll', calc, { passive: true });
    window.addEventListener('resize', calc);
    return () => { window.removeEventListener('scroll', calc); window.removeEventListener('resize', calc); };
  }, [offsets, items.length]);
  // 畫出後量實際列高；有變才重新計算位置
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    let changed = false;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const k = child.dataset.vkey;
      if (!k) continue;
      const h = child.getBoundingClientRect().height;
      if (h > 0 && Math.abs((heights.current.get(k) ?? -1) - h) > 0.5) { heights.current.set(k, h); changed = true; }
    }
    if (changed) setTick((t) => t + 1);
  });

  const [start, end] = win;
  return (
    <div ref={ref} class={`vlist ${cls ?? ''}`} role="list" aria-label={label} data-testid={testid} data-count={items.length}
      style={{ position: 'relative', height: `${offsets[items.length]}px` }}>
      <div ref={inner} style={{ position: 'absolute', left: 0, right: 0, top: `${offsets[start]}px` }}>
        {items.slice(start, end).map((it, i) => (
          <div key={keyOf(it)} data-vkey={keyOf(it)} role="listitem">{render(it, start + i)}</div>
        ))}
      </div>
    </div>
  );
}
