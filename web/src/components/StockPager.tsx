/**
 * 個股頁的左右換股（Apple 股市式）：主角區（名稱、股價、走勢圖）是一條「前一檔｜目前｜後一檔」的軌道，
 * 手指左右拖曳時整條軌道跟著手指移動，前一檔或後一檔同時被帶出來；放開後依距離與速度吸附到相鄰一檔或彈回。
 * - 頂列與下方內容不動；吸附完成才更新網址（不做整頁轉場、不捲回頂端），下方內容換成新的一檔。
 * - 相鄰兩檔（與再下一檔）預先載入，換股時直接顯示、不出現載入畫面或黑屏。
 * - 只有水平拖曳會換股；垂直捲動交給瀏覽器（touch-action: pan-y）。走勢圖改為按住約 0.2 秒才查價。
 * - 非目前的一檔 aria-hidden＋inert（螢幕閱讀器與 Tab 鍵不會進入）；頂列的 ‹ › 也走同一個動畫。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import { loadStock } from '../data/api';
import { prefersReducedMotion } from '../hooks';

export interface PagerApi {
  /** 以動畫切到前一檔（-1）或後一檔（+1）；已在動畫中或沒有相鄰一檔時不動作 */
  go: (step: 1 | -1) => void;
}

const LOCK = 10; // 判斷水平／垂直的距離
const SNAP_RATIO = 0.28; // 拖曳超過寬度的這個比例就換股
const FLICK_V = 0.45; // 或放開時速度超過（px/ms）
const DUR = 380;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function StockPager({ codes, index, renderPane, onCommit, apiRef }: {
  codes: string[];
  index: number;
  renderPane: (code: string, current: boolean) => ComponentChildren;
  /** 動畫結束後呼叫：由外層更新網址 */
  onCommit: (step: 1 | -1) => void;
  apiRef?: Ref<PagerApi>;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; x: number; y: number; lock: 'h' | 'v' | null; samples: [number, number][] } | null>(null);
  const busy = useRef(false);
  const suppressClick = useRef(false);
  // 第一次開啟：先畫目前這一檔，瀏覽器閒置後才畫相鄰兩檔（不拖慢首次載入）；之後換股時直接畫
  const [neighbors, setNeighbors] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => setNeighbors(true), { timeout: 800 });
    else window.setTimeout(() => setNeighbors(true), 300);
  }, []);
  const hasPrev = index > 0;
  const hasNext = index < codes.length - 1;
  const panes = [hasPrev ? codes[index - 1] : null, codes[index], hasNext ? codes[index + 1] : null].filter((c): c is string => !!c);
  const offset = hasPrev ? 1 : 0; // 目前這一檔在軌道上的位置

  const base = () => `translateX(${-offset * 100}%)`;
  const setX = (px: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${DUR}ms ${EASE}` : 'none';
    el.style.transform = `translateX(calc(${-offset * 100}% + ${px}px))`;
  };

  // 換股完成（index 改變）後，同一個畫面內把軌道放回「目前」的位置：內容與位置都沒有變，看不出跳動
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = base();
    busy.current = false;
  }, [index, offset]);

  // 預先載入相鄰的兩檔（再往外一檔也先載，連續滑動時不必等待）
  useEffect(() => {
    for (const d of [1, -1, 2, -2]) {
      const c = codes[index + d];
      if (c) loadStock(c).catch(() => undefined);
    }
  }, [index, codes.join(',')]);

  const width = () => viewRef.current?.getBoundingClientRect().width ?? window.innerWidth;

  function settle(step: 0 | 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    if (step === 0) { setX(0, !prefersReducedMotion()); return; }
    busy.current = true;
    if (prefersReducedMotion()) { onCommit(step); return; }
    setX(-step * width(), true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', finish);
      onCommit(step);
    };
    el.addEventListener('transitionend', finish);
    window.setTimeout(finish, DUR + 80); // transitionend 沒觸發時的保險
  }

  useImperativeHandle(apiRef ?? null, () => ({
    go: (step: 1 | -1) => {
      if (busy.current || (step > 0 ? !hasNext : !hasPrev)) return;
      settle(step);
    },
  }), [index, hasNext, hasPrev]);

  const onDown = (e: PointerEvent) => {
    if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lock: null, samples: [[e.timeStamp, e.clientX]] };
  };
  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId || s.lock === 'v') return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dy) > LOCK && Math.abs(dy) > Math.abs(dx)) { s.lock = 'v'; return; }
      if (Math.abs(dx) > LOCK && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.lock = 'h';
        try { viewRef.current?.setPointerCapture(e.pointerId); } catch { /* 手指已離開 */ }
        viewRef.current?.classList.add('dragging');
      } else return;
    }
    s.samples.push([e.timeStamp, e.clientX]);
    if (s.samples.length > 6) s.samples.shift();
    // 沒有相鄰一檔的方向：橡皮筋阻尼
    const edge = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
    setX(edge ? dx * 0.3 : dx, false);
  };
  const onUp = (e: PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s || s.id !== e.pointerId || s.lock !== 'h') return;
    viewRef.current?.classList.remove('dragging');
    suppressClick.current = true;
    const dx = e.clientX - s.x;
    const [t0, x0] = s.samples[0];
    const v = e.timeStamp > t0 ? (e.clientX - x0) / (e.timeStamp - t0) : 0;
    const w = width();
    let step: 0 | 1 | -1 = 0;
    if ((dx < -w * SNAP_RATIO || v < -FLICK_V) && hasNext && dx < 0) step = 1;
    else if ((dx > w * SNAP_RATIO || v > FLICK_V) && hasPrev && dx > 0) step = -1;
    settle(step);
  };
  const onCancel = () => {
    if (g.current?.lock === 'h') settle(0);
    g.current = null;
    viewRef.current?.classList.remove('dragging');
  };

  return (
    <div ref={viewRef} class="pager" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}>
      <div ref={trackRef} class="pager-track">
        {panes.map((c) => {
          const current = c === codes[index];
          return (
            <div key={c} class="pager-pane" data-code={c} aria-hidden={current ? undefined : 'true'} ref={(el) => { el?.toggleAttribute('inert', !current); }}>
              {current || neighbors ? renderPane(c, current) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
