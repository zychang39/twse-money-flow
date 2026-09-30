/**
 * v3 M5-2「排序」按鈕與選單：證據強度（t）、10 日超額、近期健康度、今日新觸發數、名稱；方向可切換。
 * 開關與選擇都不改變捲動位置（focus 用 preventScroll）；動畫 ≤ 200ms，減少動態效果時取消。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { SORT_OPTIONS, type SortState, sortLabel } from '../lib/sorting';

export function SortMenu({ value, onChange, id }: { value: SortState; onChange: (s: SortState) => void; id: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    first?.focus({ preventScroll: true });
    const onDoc = (e: Event) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus({ preventScroll: true }); } };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const pick = (s: SortState) => {
    const y = window.scrollY;
    onChange(s);
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
    requestAnimationFrame(() => { if (window.scrollY !== y) window.scrollTo(0, y); });
  };
  return (
    <div class="sort-head" ref={wrap}>
      <p class="caption muted sort-now" data-testid={`sort-now-${id}`}>排序：{sortLabel(value)}</p>
      <button ref={btn} type="button" class="btn small sort-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={`sort-menu-${id}`} onClick={() => setOpen(!open)}>排序</button>
      {open ? (
        <div class="sort-menu" id={`sort-menu-${id}`} role="menu" aria-label="排序方式" ref={menu}>
          {SORT_OPTIONS.map((o) => (
            <button key={o.key} type="button" role="menuitemradio" aria-checked={value.key === o.key} class="sort-item"
              onClick={() => pick({ key: o.key, dir: value.key === o.key ? value.dir : o.key === 'name' ? 'asc' : 'desc' })}>
              {o.label}{value.key === o.key ? <span aria-hidden="true"> ✓</span> : null}
            </button>
          ))}
          <div class="sort-dir" role="group" aria-label="方向">
            <button type="button" role="menuitemradio" aria-checked={value.dir === 'desc'} class="sort-item" onClick={() => pick({ ...value, dir: 'desc' })}>{value.key === 'name' ? '筆畫多到少' : '由高到低'}</button>
            <button type="button" role="menuitemradio" aria-checked={value.dir === 'asc'} class="sort-item" onClick={() => pick({ ...value, dir: 'asc' })}>{value.key === 'name' ? '筆畫少到多' : '由低到高'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
