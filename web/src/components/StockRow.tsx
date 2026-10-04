/**
 * 清單列：名稱＋代號、sparkline（虛線＝昨收）、價格＋漲跌膠囊、RS 百分位（綜合分已移除）。
 * 手勢：點一下開啟個股頁；左滑露出動作（移動群組／移除…）；長按（或滑鼠右鍵）叫出快速預覽面板。
 * 鍵盤：Enter 開啟、ContextMenu／Shift+F10 預覽；動作也可在預覽面板中完成。
 */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { StockHistory, StockRow } from '../data/types';
import { adjClose } from '../lib/history';
import { direction, fmtPrice, glueNumbers } from '../lib/format';
import { tradeStatusLabel } from '../lib/tradeStatus';
import { ChangePill } from './Change';
import { Sparkline } from './Viz';

/** 副資訊文字：數字黏住單位；括號前允許換行、括號內第一個詞黏住後面（不出現行尾「（佔」） */
const rowText = (t: string) => glueNumbers(t).replace(/（(\S+) /g, '\u200b（$1\u00a0');

/** RS 百分位（0–100）：清單列右側的數字＋小進度條。 */
function RsCell({ v }: { v: unknown }) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  return (
    <span class="srow-rs caption" role="img" aria-label={n === null ? 'RS 百分位無資料' : `RS 百分位 ${n}`}>
      <span class="num" aria-hidden="true"><span class="muted">RS </span>{n === null ? '—' : n}</span>
      <span class="srow-rs-bar" aria-hidden="true"><i style={{ transform: `scaleX(${n === null ? 0 : n / 100})` }} /></span>
    </span>
  );
}

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
    <div class={`srow-wrap ${dx !== 0 || dragging ? 'swiping' : ''}`}>
      {actions.length ? (
        <div class="srow-actions" aria-hidden={!open}>
          {actions.map((a) => (
            <button key={a.id} class={a.kind ?? 'move'} tabIndex={open ? 0 : -1} onClick={() => { setDx(0); a.onClick(); }}>{a.label}</button>
          ))}
        </div>
      ) : null}
      <button class={`srow srow-l ${dragging ? 'dragging' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onClick={click} onContextMenu={(e) => { e.preventDefault(); onPreview?.(); }}
        aria-haspopup={onPreview ? 'dialog' : undefined} aria-description={label}>
        <span class="name body srow-n">{row?.name ?? code}</span>
        <span class="sub srow-s">{code}{sub ? <>・{typeof sub === 'string' ? rowText(sub) : sub}</> : null}</span>
        <span class="srow-k"><Sparkline values={spark} dir={d} /></span>
        <span class="price srow-p">
          <span class="body" style={{ display: 'block' }}>{row ? fmtPrice(row.close) : '—'}</span>
          <ChangePill change={row?.change} pct={row?.change_pct} status={tradeStatusLabel(row)} />
        </span>
        <RsCell v={row?.rs_percentile} />
      </button>
    </div>
  );
}

/** 精簡清單列（不含 sparkline）：用於今晚的變化清單、選股結果等不需要走勢的地方。 */
export function StockMiniRow({ row, text, onOpen, risk }: { row: StockRow; text: ComponentChildren; onOpen: () => void; risk?: boolean }) {
  return (
    <button class="srow" style={{ gridTemplateColumns: 'minmax(0,1fr) 5.5rem 2rem' }} onClick={onOpen}>
      <span style={{ minWidth: 0 }}>
        <span class="name body" style={{ display: 'block' }}>{row.name} <span class="caption muted">{row.code}</span></span>
        <span class={`sub ${risk ? 'risk w6' : ''}`}>{typeof text === 'string' ? rowText(text) : text}</span>
      </span>
      <span class="price"><span class="body" style={{ display: 'block' }}>{fmtPrice(row.close)}</span><ChangePill change={row.change} pct={row.change_pct} status={tradeStatusLabel(row)} /></span>
      <RsCell v={row.rs_percentile} />
    </button>
  );
}
