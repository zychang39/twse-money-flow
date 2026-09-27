/**
 * 可拖曳的底部面板：半頁／全頁兩段高度（仿 iOS detents）。
 * - 拖曳頂部把手區切換高度，往下拖超過門檻或快速下滑即關閉；點背景、按 Esc 也會關閉。
 * - 只用 transform 位移，spring 緩動；減少動態效果時無動畫。
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconClose } from './Icons';

export type Detent = 'half' | 'full';

let openCount = 0;

export function Sheet({ open, onClose, title, children, detent = 'half', actions, labelledTitle = true }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  detent?: Detent;
  actions?: ComponentChildren;
  labelledTitle?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<Detent>(detent);
  const [drag, setDrag] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const height = () => sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight;
  const halfOffset = () => height() * 0.42;
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

  const offset = !shown ? '100%' : drag !== null ? `${Math.max(drag, -24)}px` : pos === 'full' ? '0px' : '42%';
  return (
    <>
      <div class={`sheet-backdrop ${shown ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} tabIndex={-1} class={`sheet ${drag !== null ? 'dragging' : ''}`} role="dialog" aria-modal="true" aria-label={title}
        style={{ transform: `translateY(${offset})` }}>
        <div class="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div class="grabber" aria-hidden="true" />
          <div class="row between">
            {labelledTitle ? <h2 class="section">{title}</h2> : <span />}
            <div class="row">
              {actions}
              <button class="icon-btn sheet-close" onClick={onClose} aria-label="關閉"><IconClose /></button>
            </div>
          </div>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </>
  );
}
