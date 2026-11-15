/**
 * 自選群組：群組列與頁面上直接展開的編輯區（2026-11-15／16；DECISIONS #466、#467、#469）。
 *
 * 操作方式參考 iOS 的清單管理（股市 App 的觀察清單、提醒事項的列表、主畫面排列 App）：
 * - 群組列：小膠囊（依名稱寬度，放不下才橫向捲動），最後一顆是「＋」；右邊固定「編輯」。沒有「全部」。
 * - 換順序：在群組列上按住一個群組約 0.3 秒，它會浮起來，直接左右拖到想要的位置放開（#469）。
 *   按住不會進編輯；按住後沒有移動就放開＝一般的點選。
 * - 按「編輯」：群組列原地換成編輯區，不另開一層面板——每列左邊圓圈減號（刪除）、右邊鉛筆（改名）
 *   與三條線的把手（上下拖曳排序；鍵盤用上下鍵）；系統清單用開關顯示或隱藏；
 *   不在列上的「預設」與隱藏的系統清單出現在「快速加入」；右上「完成」收起來。
 * - 刪除不跳確認視窗：空群組直接刪；有股票的群組在那一列展開兩個選擇（股票移到別的群組／一起移除）。
 *   刪除後頁面底部出現「復原」（可逆的動作用復原，不用「你確定嗎？」）。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createWatchGroup, deleteWatchGroup, renameWatchGroup, setWatchGroupOrder, setWatchListHidden, type WatchGroupUndo } from '../db/db';
import { DEFAULT_GROUP, GROUP_NAME_MAX, HOT_LIST, cleanGroupName, defaultMoveTarget, groupNameError, moveItem, type WatchPrefs } from '../lib/watchGroups';
import { IconGrip, IconMinusCircle, IconPencil, IconPlus } from './Icons';

/** 按住多久算「拿起來」（比一般點選久一點，又不用等太久） */
const HOLD_MS = 300;
/** 按住期間手指移動超過這個距離＝在捲動群組列，不拿起來 */
const HOLD_SLOP = 8;
/** 拖到群組列邊緣這麼近時自動捲動（群組多、有一部分在畫面外時） */
const EDGE = 28;
/** 改名的輸入框一出現就取得焦點並全選（ref callback；只在掛上時執行一次） */
const focusOnMount = (el: HTMLInputElement | null) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } };

/**
 * 排序先在畫面上生效：local 留到設定追上為止（順序一樣了），或群組增減了才放掉。
 * 不能「groups 一變就放掉」：連續移動兩次時，第一次的重讀結果會晚到，那一刻放掉會讓順序先跳回去。
 */
function useOptimisticOrder(groups: string[]): [string[], (next: string[]) => void] {
  const [local, setLocal] = useState<string[] | null>(null);
  const sameSet = !!local && local.length === groups.length && local.every((g) => groups.includes(g));
  const caughtUp = sameSet && local!.every((g, i) => groups[i] === g);
  useEffect(() => { if (local && (!sameSet || caughtUp)) setLocal(null); }, [local, sameSet, caughtUp]);
  return [sameSet ? local! : groups, setLocal];
}

interface BarDrag { from: number; to: number; dx: number; w: number; gap: number }

/** 群組列：使用者群組…｜系統清單｜＋；右邊固定「編輯」。編輯中換成標題與「完成」。 */
export function GroupBar({ groups, group, onPick, hot, editing, onNew, onEdit, onDone }: {
  groups: string[];
  group: string;
  onPick: (g: string) => void;
  /** 系統清單（熱門動能）：null＝沒有資料或已隱藏 */
  hot: { id: string; label: string } | null;
  editing: boolean;
  onNew: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [shown, setLocal] = useOptimisticOrder(groups);
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<BarDrag | null>(null);
  const [said, setSaid] = useState('');
  // 按住中的狀態：active＝已經拿起來；rects＝拿起來那一刻每個群組的位置（之後的位移都以它為準）
  const hold = useRef<{ id: number; el: HTMLElement; from: number; x0: number; y0: number; x: number; timer: number; active: boolean; moved: boolean; rects: { left: number; width: number }[]; scroll0: number; raf: number } | null>(null);
  const skipClick = useRef(false);

  // 拿起來之後擋掉瀏覽器的捲動（觸控）：這時手指還沒移動，捲動還沒開始，擋得住
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const stop = (e: TouchEvent) => { if (hold.current?.active) e.preventDefault(); };
    row.addEventListener('touchmove', stop, { passive: false });
    return () => row.removeEventListener('touchmove', stop);
  }, [editing]);
  useEffect(() => () => { if (hold.current) { clearTimeout(hold.current.timer); cancelAnimationFrame(hold.current.raf); } }, []);

  /** 依目前手指位置算位移與落點（位移夾在第一個到最後一個群組之間） */
  function place(h: NonNullable<typeof hold.current>): BarDrag {
    const row = rowRef.current!;
    const r = h.rects, me = r[h.from], last = r[r.length - 1];
    const raw = h.x - h.x0 + (row.scrollLeft - h.scroll0);
    const dx = Math.max(r[0].left - me.left, Math.min(last.left + last.width - (me.left + me.width), raw));
    // 落點用手指實際的位置算（沒有夾住的位移）：膠囊寬度不一，用夾住後的位置會讓比較寬的那一顆拖不到最前面或最後面
    const center = me.left + me.width / 2 + raw;
    let to = 0;
    r.forEach((x, j) => { if (j !== h.from && x.left + x.width / 2 < center) to++; });
    const gap = r.length > 1 ? Math.max(0, r[1].left - (r[0].left + r[0].width)) : 0;
    return { from: h.from, to, dx, w: me.width, gap };
  }
  /** 拖到列的邊緣：自動捲動，露出還在畫面外的群組 */
  function autoScroll() {
    const h = hold.current, row = rowRef.current;
    if (!h?.active || !row) return;
    const box = row.getBoundingClientRect();
    const v = h.x < box.left + EDGE ? -6 : h.x > box.right - EDGE ? 6 : 0;
    if (v) {
      const before = row.scrollLeft;
      row.scrollLeft += v;
      if (row.scrollLeft !== before) setDrag(place(h));
    }
    h.raf = requestAnimationFrame(autoScroll);
  }
  function lift() {
    const h = hold.current, row = rowRef.current;
    if (!h || !row) return;
    h.active = true;
    h.rects = [...row.querySelectorAll<HTMLElement>('[data-drag]')].map((el) => { const b = el.getBoundingClientRect(); return { left: b.left, width: b.width }; });
    h.scroll0 = row.scrollLeft;
    try { h.el.setPointerCapture(h.id); } catch { /* 指標已經放開 */ }
    if (navigator.vibrate) navigator.vibrate(8);
    setDrag(place(h));
    h.raf = requestAnimationFrame(autoScroll);
  }
  function end(commit: boolean) {
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    clearTimeout(h.timer); cancelAnimationFrame(h.raf);
    if (!h.active) return;
    const d = place(h);
    setDrag(null);
    skipClick.current = h.moved; // 拿起來又移動過＝排序，不算點選；沒移動就放開＝一般的點選
    if (commit && d.to !== d.from) {
      const next = moveItem(shown, d.from, d.to);
      setLocal(next);
      setSaid(`「${shown[d.from]}」移到第 ${d.to + 1} 個`);
      void setWatchGroupOrder(next);
    }
  }
  const dragEvents = (i: number) => (shown.length > 1 ? {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (hold.current) end(false);
      const el = e.currentTarget as HTMLElement;
      hold.current = { id: e.pointerId, el, from: i, x0: e.clientX, y0: e.clientY, x: e.clientX, timer: window.setTimeout(lift, HOLD_MS), active: false, moved: false, rects: [], scroll0: 0, raf: 0 };
    },
    onPointerMove: (e: PointerEvent) => {
      const h = hold.current;
      if (!h || e.pointerId !== h.id) return;
      if (!h.active) {
        if (Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > HOLD_SLOP) end(false); // 在捲動，不是按住
        return;
      }
      h.x = e.clientX;
      if (Math.abs(e.clientX - h.x0) > 3) h.moved = true;
      setDrag(place(h));
    },
    onPointerUp: (e: PointerEvent) => { if (hold.current) { hold.current.x = e.clientX; end(true); } },
    onPointerCancel: () => end(false),
    onContextMenu: (e: Event) => e.preventDefault(), // 長按不要跳系統選單
  } : {});
  /** 拖曳中的位移：被拖的跟著手指；它經過的群組往旁邊讓出它的寬度 */
  const shift = (j: number): string | undefined => {
    if (!drag) return undefined;
    if (j === drag.from) return `translateX(${drag.dx}px) scale(1.06)`;
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return `translateX(${-(drag.w + drag.gap)}px)`;
    if (drag.from > drag.to && j >= drag.to && j < drag.from) return `translateX(${drag.w + drag.gap}px)`;
    return undefined;
  };

  if (editing) {
    return (
      <div class="group-bar editing">
        <h2 class="body w6 grow group-bar-title">編輯群組</h2>
        <button class="text-btn group-edit-btn w6" onClick={onDone} data-testid="group-done">完成</button>
      </div>
    );
  }
  return (
    <div class="group-bar">
      <div class={`chips group-chips ${drag ? 'sorting' : ''}`} role="group" aria-label="群組" ref={rowRef}>
        {shown.map((g, i) => (
          <button key={g} class={`chip ${drag?.from === i ? 'dragging' : ''}`} aria-pressed={group === g} data-group={g} data-drag=""
            aria-description={shown.length > 1 ? '按住可以左右拖曳換順序' : undefined} style={{ transform: shift(i) }} {...dragEvents(i)}
            onClick={() => { if (skipClick.current) { skipClick.current = false; return; } onPick(g); }}>{g}</button>
        ))}
        {hot ? (
          <button class="chip system" aria-pressed={group === hot.id} data-group={hot.id} onClick={() => onPick(hot.id)}>
            {hot.label}<span class="sys-mark">系統</span>
          </button>
        ) : null}
        <button class="chip chip-icon" aria-label="新增群組" onClick={onNew} data-testid="group-new"><IconPlus /></button>
      </div>
      {/* 「編輯」固定在右邊，群組再多也看得到（群組在它左邊橫向捲動） */}
      <button class="text-btn group-edit-btn" onClick={onEdit} data-testid="group-edit">編輯</button>
      <span class="sr-only" role="status">{said}</span>
    </div>
  );
}

/** 新群組的輸入列（編輯區最上面） */
function NewGroup({ existing, onCreate, autoFocus }: { existing: string[]; onCreate: (name: string) => void; autoFocus: boolean }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  function submit(e?: Event) {
    e?.preventDefault();
    const bad = groupNameError(name, existing);
    if (bad) { setErr(bad); return; }
    onCreate(cleanGroupName(name));
    setName(''); setErr('');
  }
  return (
    <form class="group-new" onSubmit={submit}>
      <input ref={ref} class="input grow" value={name} maxLength={GROUP_NAME_MAX * 2} placeholder="新群組名稱" aria-label="新群組名稱" enterkeyhint="done"
        onInput={(e) => { setName((e.target as HTMLInputElement).value); setErr(''); }} data-testid="group-new-name" />
      <button type="submit" class="btn primary" disabled={!name.trim()} data-testid="group-new-submit">建立</button>
      {err ? <p class="caption group-err" role="alert">{err}</p> : null}
    </form>
  );
}

export interface GroupEditorProps {
  /** 按「＋」進來：游標放在新群組名稱 */
  focusNew: boolean;
  onClose: () => void;
  groups: string[];
  counts: Map<string, number>;
  prefs: WatchPrefs;
  /** 系統清單（熱門動能）目前的檔數與名稱；沒有資料時為 null（不顯示那一區） */
  hot: { label: string; count: number } | null;
  onCreated: (name: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (undo: WatchGroupUndo) => void;
}

/** 群組的編輯區：直接接在群組列下面（不是面板）。Esc 或「完成」收起來。 */
export function GroupEditor({ focusNew, onClose, groups, counts, prefs, hot, onCreated, onRenamed, onDeleted }: GroupEditorProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const rootRef = useRef<HTMLElement>(null);
  // 拖曳排序：drag＝正在拖的那一列（from 原位置、to 目前落點、dy 位移、h 一列的高度）；順序先在畫面上生效（useOptimisticOrder）
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null);
  const [shown, setLocal] = useOptimisticOrder(groups);
  const grab = useRef<{ y: number; from: number; h: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    // 鍵盤移動後節點換了位置，焦點放回同一個把手
    if (!refocus.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  });
  async function reorder(from: number, to: number, viaKey = false) {
    if (to === from || to < 0 || to >= shown.length) return;
    const next = moveItem(shown, from, to);
    setLocal(next);
    setMsg(`「${shown[from]}」移到第 ${to + 1} 個`);
    if (viaKey) refocus.current = shown[from];
    await setWatchGroupOrder(next);
  }
  /** 位移夾在清單範圍內（第一列的上緣到最後一列的下緣） */
  const clampDy = (g: { y: number; from: number; h: number }, y: number) => Math.max(-g.from * g.h, Math.min((shown.length - 1 - g.from) * g.h, y - g.y));
  const gripEvents = (i: number) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setRenaming(null); setDeleting(null); setErr('');
      const row = (e.currentTarget as HTMLElement).closest('.group-row') as HTMLElement | null;
      const h = (row?.getBoundingClientRect().height ?? 56) + 1; // 一列＋分隔線
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      grab.current = { y: e.clientY, from: i, h };
      setDrag({ from: i, to: i, dy: 0, h });
    },
    onPointerMove: (e: PointerEvent) => {
      const g = grab.current;
      if (!g) return;
      const dy = clampDy(g, e.clientY);
      setDrag({ from: g.from, to: g.from + Math.round(dy / g.h), dy, h: g.h });
    },
    // 落點用放開那一刻的位置算（不靠上一次畫面更新的狀態：手指動得快時畫面可能還沒跟上）
    onPointerUp: (e: PointerEvent) => {
      const g = grab.current;
      grab.current = null; setDrag(null);
      if (g) void reorder(g.from, g.from + Math.round(clampDy(g, e.clientY) / g.h));
    },
    onPointerCancel: () => { grab.current = null; setDrag(null); },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      void reorder(i, i + (e.key === 'ArrowUp' ? -1 : 1), true);
    },
  });
  /** 拖曳中的位移：被拖的那一列跟著手指；它經過的列讓出一格 */
  const shift = (j: number): string | undefined => {
    if (!drag) return undefined;
    if (j === drag.from) return `translateY(${drag.dy}px)`;
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return `translateY(${-drag.h}px)`;
    if (drag.from > drag.to && j >= drag.to && j < drag.from) return `translateY(${drag.h}px)`;
    return undefined;
  };
  useEffect(() => { rootRef.current?.scrollIntoView({ block: 'nearest' }); }, []);

  // 開關按下去先照新狀態顯示（hotLocal），等設定重讀後交還——不然重讀前的畫面更新會讓開關彈回去一下
  const [hotLocal, setHotLocal] = useState<boolean | null>(null);
  const hotStored = prefs.hidden.includes(HOT_LIST);
  useEffect(() => { if (hotLocal !== null && hotLocal === hotStored) setHotLocal(null); }, [hotLocal, hotStored]); // 設定追上了才交還
  const hotHidden = hotLocal ?? hotStored;
  const setHot = (hidden: boolean) => { setHotLocal(hidden); setMsg(''); void setWatchListHidden(HOT_LIST, hidden); }; // 之前的訊息（例：已加回）不再適用
  const quick: { key: string; label: string; add: () => void }[] = [];
  if (!groups.includes(DEFAULT_GROUP)) quick.push({ key: 'default', label: DEFAULT_GROUP, add: () => create(DEFAULT_GROUP) });
  if (hot && hotHidden) quick.push({ key: 'hot', label: `${hot.label}（系統）`, add: () => { setHot(false); setMsg(`已加回「${hot.label}」`); } });

  async function create(name: string) {
    const g = await createWatchGroup(name);
    setMsg(`已建立「${g}」`);
    onCreated(g);
  }
  async function saveRename(from: string) {
    const to = cleanGroupName(draft);
    if (to === from) { setRenaming(null); return; }
    const bad = groupNameError(to); // 改成已存在的名稱＝合併，不擋
    if (bad) { setErr(bad); return; }
    const merged = groups.includes(to);
    await renameWatchGroup(from, to);
    setRenaming(null); setErr('');
    setMsg(merged ? `已把「${from}」併入「${to}」` : `已改名為「${to}」`);
    onRenamed(from, to);
  }
  async function remove(name: string, moveTo: string | null) {
    const undo = await deleteWatchGroup(name, moveTo);
    setDeleting(null); setMsg('');
    onDeleted(undo);
  }
  function askDelete(name: string) {
    setRenaming(null); setErr('');
    if (!(counts.get(name) ?? 0)) { void remove(name, null); return; } // 空群組：直接刪（可復原）
    setTarget(defaultMoveTarget(name, groups) ?? '');
    setDeleting(deleting === name ? null : name);
  }

  const others = (name: string) => [...new Set([DEFAULT_GROUP, ...groups])].filter((g) => g !== name);
  return (
    <section class="card group-editor" aria-label="編輯群組" ref={rootRef} data-testid="group-editor"
      onKeyDown={(e) => { if (e.key === 'Escape' && !renaming) onClose(); }}>
      <NewGroup existing={groups} autoFocus={focusNew} onCreate={(n) => void create(n)} />
      {quick.length ? (
        <div class="group-quick" role="group" aria-label="快速加入">
          <span class="caption muted">快速加入</span>
          {quick.map((q) => (
            <button key={q.key} class="chip chip-add" onClick={q.add} data-testid={`group-quick-${q.key}`}><IconPlus />{q.label}</button>
          ))}
        </div>
      ) : null}
      {msg ? <p class="caption muted" role="status" data-testid="group-msg">{msg}</p> : null}

      <h3 class="eyebrow group-h">我的群組</h3>
      {groups.length ? (
        <ul class={`group-list ${drag ? 'sorting' : ''}`} data-testid="group-list" ref={listRef}>
          {shown.map((g, i) => {
            const n = counts.get(g) ?? 0;
            return (
              <li key={g} class={`group-row-wrap ${drag?.from === i ? 'dragging' : ''}`} data-testid={`group-row-${g}`} style={{ transform: shift(i) }}>
                <div class="group-row">
                  <button class="icon-btn group-del" aria-label={`刪除群組「${g}」`} aria-expanded={n ? deleting === g : undefined} onClick={() => askDelete(g)}><IconMinusCircle /></button>
                  {renaming === g ? (
                    <form class="group-rename grow" onSubmit={(e) => { e.preventDefault(); void saveRename(g); }}>
                      <input class="input grow" value={draft} aria-label={`「${g}」的新名稱`} enterkeyhint="done" ref={focusOnMount}
                        onInput={(e) => { setDraft((e.target as HTMLInputElement).value); setErr(''); }} />
                      <button type="submit" class="btn small primary">儲存</button>
                      <button type="button" class="btn small" onClick={() => { setRenaming(null); setErr(''); }}>取消</button>
                    </form>
                  ) : (
                    <>
                      <span class="grow group-name"><span class="body ellipsis">{g}</span><span class="caption muted">{n ? `${n} 檔` : '還沒有股票'}</span></span>
                      <button class="icon-btn group-edit" aria-label={`把「${g}」改名`} onClick={() => { setDeleting(null); setErr(''); setRenaming(g); setDraft(g); }}><IconPencil /></button>
                      {shown.length > 1 ? (
                        <button class="icon-btn group-grip" data-grip={g} aria-label={`調整「${g}」的順序`} aria-description={`第 ${i + 1} 個，共 ${shown.length} 個；按住上下拖曳，或用上下鍵移動`}
                          {...gripEvents(i)}><IconGrip /></button>
                      ) : null}
                    </>
                  )}
                </div>
                {renaming === g && err ? <p class="caption group-err" role="alert">{err}</p> : null}
                {renaming === g && cleanGroupName(draft) !== g && groups.includes(cleanGroupName(draft)) ? (
                  <p class="caption muted">已經有「{cleanGroupName(draft)}」：儲存後這 {n} 檔會併進去。</p>
                ) : null}
                {deleting === g ? (
                  <div class="group-confirm" role="group" aria-label={`刪除「${g}」`}>
                    <p class="caption">「{g}」裡有 {n} 檔股票，要怎麼處理？</p>
                    {others(g).length ? (
                      <div class="group-move">
                        <label class="caption muted" for={`move-${g}`}>移到</label>
                        <select id={`move-${g}`} class="select" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
                          {others(g).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <button class="btn primary grow" onClick={() => void remove(g, target || others(g)[0])} data-testid="group-delete-move">只刪群組，股票留著</button>
                      </div>
                    ) : null}
                    <div class="row" style={{ gap: 'var(--s-2)' }}>
                      <button class="btn danger grow" onClick={() => void remove(g, null)} data-testid="group-delete-all">連同 {n} 檔一起移除</button>
                      <button class="btn" onClick={() => setDeleting(null)}>取消</button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p class="caption muted">還沒有群組。在上面輸入名稱就能建立。</p>}

      {hot ? (
        <>
          <h3 class="eyebrow group-h">系統清單</h3>
          <div class="switch-row group-sys" data-testid="group-sys-hot">
            <span class="grow"><span class="body">{hot.label}<span class="sys-mark">系統</span></span>
              <span class="caption muted" style={{ display: 'block' }}>{hot.count} 檔・每天依規則產生，非推薦</span></span>
            <label class="switch"><input type="checkbox" role="switch" aria-label={`在群組列顯示${hot.label}`} checked={!hotHidden}
              onChange={(e) => setHot(!(e.target as HTMLInputElement).checked)} /><span /></label>
          </div>
        </>
      ) : null}
      <p class="caption muted group-tip">按住三條線上下拖曳可以調整順序；刪除後畫面下方可以按「復原」。平常在群組列上按住一個群組，也可以直接左右拖曳換順序。</p>
    </section>
  );
}

/** 刪除群組後的「復原」提示（浮在底部導覽上方；幾秒後自動消失） */
export function UndoToast({ text, onUndo, onDone, ms = 8000 }: { text: string; onUndo: () => void; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div class="update-toast undo-toast glass" role="status" data-testid="undo-toast">
      <span class="ellipsis">{text}</span>
      <button class="update-toast-main" onClick={onUndo}>復原</button>
    </div>
  );
}

/** 復原提示的文字 */
export function undoText(u: WatchGroupUndo): string {
  const n = u.items.length;
  if (!n) return `已刪除「${u.name}」`;
  return u.movedTo ? `已刪除「${u.name}」，${n} 檔移到「${u.movedTo}」` : `已刪除「${u.name}」與 ${n} 檔自選`;
}
