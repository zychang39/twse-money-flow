/**
 * 清單列：名稱＋代號、sparkline（虛線＝昨收）、價格＋漲跌膠囊、綜合分小環。
 * 手勢：點一下開啟個股頁；左滑露出動作（移動群組／移除…）；長按（或滑鼠右鍵）叫出快速預覽面板。
 * 鍵盤：Enter 開啟、ContextMenu／Shift+F10 預覽；動作也可在預覽面板中完成。
 */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { StockHistory, StockRow } from '../data/types';
import { adjClose } from '../lib/history';
import { direction, fmtPrice } from '../lib/format';
import { ChangePill } from './Change';
import { ScoreRing, Sparkline } from './Viz';

export interface RowAction { id: string; label: string; kind?: 'move' | 'remove'; onClick: () => void }

const ACTION_W = 76;

export function StockListRow({ code, row, hist, sub, onOpen, onPreview, actions = [], ariaExtra }: {
  code: string;
  row: StockRow | undefined;
  hist?: StockHistory | null;
  sub?: ComponentChildren;
  onOpen: () => void;
  onPreview?: () => void;
  actions?: RowAction[];
  ariaExtra?: string;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef<{ x: number; y: number; base: number; lock: 'h' | 'v' | null; timer: number; long: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const maxOpen = actions.length * ACTION_W;
  const open = dx < -4;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const timer = window.setTimeout(() => {
      if (g.current && !g.current.lock) {
        g.current.long = true;
        suppressClick.current = true;
        if (navigator.vibrate) navigator.vibrate(8);
        onPreview?.();
      }
    }, 480);
    g.current = { x: e.clientX, y: e.clientY, base: dx, lock: null, timer, long: false, id: e.pointerId };
  }
  function move(e: PointerEvent) {
    const s = g.current;
    if (!s || s.long) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { s.lock = 'v'; clearTimeout(s.timer); return; }
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) && actions.length) {
        s.lock = 'h';
        clearTimeout(s.timer);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (s.lock === 'h') {
      const next = Math.min(0, Math.max(-maxOpen - 24, s.base + mx));
      setDx(next);
    }
  }
  function up() {
    const s = g.current;
    g.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (s.lock === 'h') {
      suppressClick.current = true;
      setDragging(false);
      setDx(dx < -maxOpen / 2 ? -maxOpen : 0);
    }
  }
  function click(e: MouseEvent) {
    if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); return; }
    if (open) { setDx(0); return; }
    onOpen();
  }

  const d = direction(row?.change ?? null);
  const spark = hist ? adjClose(hist).slice(-21) : null;
  const label = row ? `${row.name} ${code}，收盤 ${fmtPrice(row.close)}${ariaExtra ? `，${ariaExtra}` : ''}` : `${code}（無資料）`;
  return (
    <div class="srow-wrap">
      {actions.length ? (
        <div class="srow-actions" aria-hidden={!open}>
          {actions.map((a) => (
            <button key={a.id} class={a.kind ?? 'move'} tabIndex={open ? 0 : -1} onClick={() => { setDx(0); a.onClick(); }}>{a.label}</button>
          ))}
        </div>
      ) : null}
      <button class={`srow ${dragging ? 'dragging' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={click} onContextMenu={(e) => { e.preventDefault(); onPreview?.(); }}
        aria-label={label} aria-haspopup={onPreview ? 'dialog' : undefined}>
        <span style={{ minWidth: 0 }}>
          <span class="name body ellipsis" style={{ display: 'block' }}>{row?.name ?? code}</span>
          <span class="sub">{code}{sub ? <>・{sub}</> : null}</span>
        </span>
        <Sparkline values={spark} dir={d} />
        <span class="price">
          <span class="body" style={{ display: 'block' }}>{row ? fmtPrice(row.close) : '—'}</span>
          <ChangePill change={row?.change} pct={row?.change_pct} />
        </span>
        <ScoreRing value={(row?.composite as number | null | undefined) ?? null} size={32} stroke={3} label="綜合分" />
      </button>
    </div>
  );
}

/** 精簡清單列（不含 sparkline）：用於今晚的變化清單、選股結果等不需要走勢的地方。 */
export function StockMiniRow({ row, text, onOpen, risk }: { row: StockRow; text: ComponentChildren; onOpen: () => void; risk?: boolean }) {
  return (
    <button class="srow" style={{ gridTemplateColumns: 'minmax(0,1fr) 5.5rem 2rem' }} onClick={onOpen}
      aria-label={`${row.name} ${row.code}，收盤 ${fmtPrice(row.close)}${typeof text === 'string' ? `，${text}` : ''}`}>
      <span style={{ minWidth: 0 }}>
        <span class="name body ellipsis" style={{ display: 'block' }}>{row.name} <span class="caption muted">{row.code}</span></span>
        <span class={`sub ${risk ? 'risk w6' : ''}`}>{text}</span>
      </span>
      <span class="price"><span class="body" style={{ display: 'block' }}>{fmtPrice(row.close)}</span><ChangePill change={row.change} pct={row.change_pct} /></span>
      <ScoreRing value={(row.composite as number | null | undefined) ?? null} size={32} stroke={3} label="綜合分" />
    </button>
  );
}
