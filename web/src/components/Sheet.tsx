/**
 * 可拖曳的底部面板（仿 iOS detents）：預設高度依內容（half＝依內容，最高到全高），可上拉到全高、下拉關閉。
 * - 拖曳頂部把手區切換高度，往下拖超過門檻或快速下滑即關閉；點背景、按 Esc 也會關閉。
 * - 只用 transform 位移，spring 緩動；減少動態效果時無動畫。
 */
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconBack, IconClose } from './Icons';

export type Detent = 'half' | 'full';

let openCount = 0;

export function Sheet({ open, onClose, title, children, detent = 'half', actions, labelledTitle = true, back }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  detent?: Detent;
  actions?: ComponentChildren;
  labelledTitle?: boolean;
  /** 面板內推入的子頁（2026-10-06 檢查表說明頁）：標題左側顯示「‹ 上一頁名稱」；Esc 先返回上一頁 */
  back?: { label: string; onBack: () => void };
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<Detent>(detent);
  const [drag, setDrag] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const start = useRef<{ y: number; t: number; base: number } | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setPos(detent);
      lastFocus.current = document.activeElement as HTMLElement | null;
    } else if (mounted) {
      setShown(false);
      const t = setTimeout(() => setMounted(false), 380);
      return () => clearTimeout(t);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted || !open) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    openCount++;
    document.documentElement.style.overflow = 'hidden';
    // 焦點移入面板：有指定欄位（data-autofocus）就聚焦該欄位，否則聚焦面板本身（不在關閉鈕上顯示焦點框）
    (sheetRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? sheetRef.current)?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      openCount--;
      if (!openCount) document.documentElement.style.overflow = '';
      lastFocus.current?.focus?.({ preventScroll: true });
    };
  }, [mounted, open]);

  // 依內容的高度：內容改變（例：展開「進階」）時重新計算
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!mounted || !el) return;
    const measure = () => {
      const head = el.querySelector<HTMLElement>('.sheet-head');
      const inner = el.querySelector<HTMLElement>('.sheet-inner');
      const body = el.querySelector<HTMLElement>('.sheet-body');
      const pad = body ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 0;
      const need = (head?.offsetHeight ?? 0) + (inner?.offsetHeight ?? 0) + pad;
      setFit(Math.max(0, el.getBoundingClientRect().height - need));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const inner = el.querySelector('.sheet-inner');
    if (inner) ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (back) back.onBack();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, back]);

  if (!mounted) return null;

  const height = () => sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight;
  /** 依內容的高度：面板總高減去（把手區＋內容）高度；內容超過全高時為 0（＝全高） */
  const halfOffset = () => fit;
  const baseOffset = () => (pos === 'full' ? 0 : halfOffset());

  function onDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, t: performance.now(), base: baseOffset() };
    setDrag(start.current.base);
  }
  function onMove(e: PointerEvent) {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    const next = start.current.base + dy;
    setDrag(next < 0 ? next * 0.2 : next); // 往上超出全頁時加阻尼
  }
  function onUp(e: PointerEvent) {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    const v = dy / Math.max(1, performance.now() - start.current.t); // px/ms
    const at = start.current.base + dy;
    start.current = null;
    setDrag(null);
    if (Math.abs(dy) < 4) {
      setPos(pos === 'full' ? 'half' : 'full'); // 點一下把手：切換高度
      return;
    }
    if (v > 0.9 || at > halfOffset() + height() * 0.2) {
      onClose();
      return;
    }
    if (v < -0.6) setPos('full');
    else setPos(at < halfOffset() / 2 ? 'full' : 'half');
  }

  const offset = !shown ? '100%' : drag !== null ? `${Math.max(drag, -24)}px` : pos === 'full' ? '0px' : `${fit}px`;
  // 2026-10 改版：導覽列是 sticky＋backdrop-filter（會成為 fixed 子元素的定位容器），面板一律掛到 body
  return createPortal((
    <>
      <div class={`sheet-backdrop ${shown ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} tabIndex={-1} class={`sheet ${drag !== null ? 'dragging' : ''}`} role="dialog" aria-modal="true" aria-label={title}
        style={{ transform: `translateY(${offset})` }}>
        <div class="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div class="grabber" aria-hidden="true" />
          <div class="row between">
            {back ? (
              <button type="button" class="sheet-back" onClick={back.onBack} aria-label={`返回${back.label}`} data-testid="sheet-back">
                <IconBack /><span>{back.label}</span>
              </button>
            ) : null}
            {labelledTitle ? <h2 class={`section ${back ? 'sheet-title-sub' : ''}`}>{title}</h2> : <span />}
            <div class="row">
              {actions}
              <button class="icon-btn sheet-close" onClick={onClose} aria-label="關閉"><IconClose /></button>
            </div>
          </div>
        </div>
        <div class="sheet-body"><div class="sheet-inner">{children}</div></div>
      </div>
    </>), document.body
  );
}
