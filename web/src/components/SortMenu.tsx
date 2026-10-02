/**
 * v3 M5-2「排序」按鈕與選單：選項由 options 決定（指標效度表：判定分級、t、10 日超額…；策略庫：有效性排名、校正後 t、40 日扣成本超額…）；方向可切換。
 * 開關與選擇都不改變捲動位置（focus 用 preventScroll）；動畫 ≤ 200ms，減少動態效果時取消。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { EVIDENCE_SORT, type SortOptions, type SortState, defaultDir, dirLabels, sortLabel } from '../lib/sorting';

/** options：這個列表可用的選項與預設（策略庫用 STRATEGY_SORT；指標效度表、選股用預設的 EVIDENCE_SORT）。 */
export function SortMenu({ value, onChange, id, options = EVIDENCE_SORT }: { value: SortState; onChange: (s: SortState) => void; id: string; options?: SortOptions }) {
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
      <p class="caption muted sort-now" data-testid={`sort-now-${id}`}>排序：{sortLabel(value, options)}</p>
      <button ref={btn} type="button" class="btn small sort-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={`sort-menu-${id}`} onClick={() => setOpen(!open)}>排序</button>
      {open ? (
        <div class="sort-menu" id={`sort-menu-${id}`} role="menu" aria-label="排序方式" ref={menu}>
          {options.options.map((o) => (
            <button key={o.key} type="button" role="menuitemradio" aria-checked={value.key === o.key} class="sort-item"
              onClick={() => pick({ key: o.key, dir: value.key === o.key ? value.dir : defaultDir(o.key) })}>
              {o.label}{value.key === o.key ? <span aria-hidden="true"> ✓</span> : null}
            </button>
          ))}
          <div class="sort-dir" role="group" aria-label="方向">
            <button type="button" role="menuitemradio" aria-checked={value.dir === 'desc'} class="sort-item" onClick={() => pick({ ...value, dir: 'desc' })}>{dirLabels(value.key).desc}</button>
            <button type="button" role="menuitemradio" aria-checked={value.dir === 'asc'} class="sort-item" onClick={() => pick({ ...value, dir: 'asc' })}>{dirLabels(value.key).asc}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
