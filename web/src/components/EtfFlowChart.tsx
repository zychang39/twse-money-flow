/**
 * 主動式 ETF 資金流向圖（2026-10-10）：一張圖一眼看完——加碼（紅）在上、減碼（綠）在下，以中線為 0、同一刻度。
 * 每列 22px：名稱｜減碼半邊｜加碼半邊；數值標在中線另一側的空白處（加碼的數字在左半、減碼的數字在右半），橫條可用滿半邊。
 * 列數依螢幕高度決定（量清單上緣到底部切換列），首屏放得下整張圖；圖本身不可點（每列不到 44pt），點選在下方「明細」。
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EtfItem } from '../data/types';
import { chartRows, yi } from '../lib/etfFlows';

const ROW_H = 22;
const MIN_SLOTS = 8;
const MAX_SLOTS = 24;

/** 圖能放幾列：圖上緣到底部切換列上緣（量不到時用畫面底部），扣掉中間的分隔線 */
function useSlots(ref: { current: HTMLElement | null }, deps: unknown[]): number {
  const [slots, setSlots] = useState(16);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const dock = document.querySelector('.tabbar')?.getBoundingClientRect().top;
      const bottom = dock && dock > 0 ? dock + window.scrollY - 12 : window.innerHeight + window.scrollY - 12;
      setSlots(Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, Math.floor((bottom - top) / ROW_H) - 1)));
    };
    fit();
    // 圖上方的內容（例：「資料落後」橫幅）晚一點才出現時圖會被往下推：頁面高度一變就重算（圖自己的高度不影響上緣，不會來回跳）
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(document.body);
    window.addEventListener('resize', fit);
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
  }, deps);
  return slots;
}

function Bar({ x, max }: { x: EtfItem; max: number }) {
  const v = x.value_yi ?? 0;
  const w = `${Math.max(1.5, (Math.abs(v) / max) * 100)}%`;
  const num = yi(v).replace(' 億', '');
  return (
    <div class="fc-row" data-testid="etf-flow-bar">
      <span class="fc-name">{x.name}</span>
      <span class="fc-half fc-neg">{v < 0 ? <i class="fc-bar down" style={{ width: w }} /> : <span class="fc-val up">{num}</span>}</span>
      <span class="fc-half fc-pos">{v > 0 ? <i class="fc-bar up" style={{ width: w }} /> : <span class="fc-val down">{num}</span>}</span>
    </div>
  );
}

export function EtfFlowChart({ items, label }: { items: EtfItem[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const slots = useSlots(ref, [items.length > 0]);
  const { adds, reduces, max } = chartRows(items, slots);
  const say = (xs: EtfItem[]) => xs.slice(0, 5).map((x) => `${x.name} ${yi(Math.abs(x.value_yi ?? 0), false)}`).join('、');
  const aria = `${label}：加碼最多 ${say(adds) || '無'}；減碼最多 ${say(reduces.slice().reverse()) || '無'}。完整清單在下方明細。`;
  return (
    <div ref={ref} class="fc" role="img" aria-label={aria} data-testid="etf-flow-chart" data-slots={slots}>
      {adds.map((x) => <Bar key={`a${x.code}`} x={x} max={max} />)}
      {adds.length && reduces.length ? <div class="fc-sep" aria-hidden="true" /> : null}
      {reduces.map((x) => <Bar key={`r${x.code}`} x={x} max={max} />)}
    </div>
  );
}
