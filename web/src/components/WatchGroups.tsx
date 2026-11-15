/**
 * 自選群組：膠囊列與「編輯群組」面板（2026-11-15；DECISIONS #466）。
 *
 * 操作方式參考 iOS 的清單管理（股市 App 的「管理觀察清單」、提醒事項的列表）：
 * - 膠囊列最後一顆是「＋」（新群組）；「編輯」固定在列的右邊；長按（桌機按右鍵）任一個群組＝直接編輯那一個。
 * - 編輯面板：每列左邊是圓圈減號（刪除）、右邊是鉛筆（改名）；系統清單用開關顯示或隱藏；
 *   不在列上的「預設」與隱藏的系統清單出現在「快速加入」，一點就回來。
 * - 刪除不跳確認視窗：空群組直接刪；有股票的群組在那一列展開兩個選擇（股票移到別的群組／一起移除）。
 *   刪除後頁面底部出現「復原」（可逆的動作用復原，不用「你確定嗎？」）。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createWatchGroup, deleteWatchGroup, renameWatchGroup, setWatchListHidden, type WatchGroupUndo } from '../db/db';
import { ALL_GROUPS, DEFAULT_GROUP, GROUP_NAME_MAX, HOT_LIST, cleanGroupName, defaultMoveTarget, groupNameError, type WatchPrefs } from '../lib/watchGroups';
import { IconMinusCircle, IconPencil, IconPlus } from './Icons';
import { Sheet } from './Sheet';

const LONG_MS = 480;
/** 改名的輸入框一出現就取得焦點並全選（ref callback；只在掛上時執行一次） */
const focusOnMount = (el: HTMLInputElement | null) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } };

/** 長按（觸控）或右鍵（滑鼠）：回傳要綁在按鈕上的事件；長按觸發後那一次點擊不算。 */
function useLongPress(onLong: () => void) {
  const t = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const clear = () => { if (t.current) clearTimeout(t.current.timer); };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      clear();
      const s = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
      s.timer = window.setTimeout(() => { s.fired = true; if (navigator.vibrate) navigator.vibrate(8); onLong(); }, LONG_MS);
      t.current = s;
    },
    onPointerMove: (e: PointerEvent) => {
      const s = t.current;
      if (s && !s.fired && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear(); // 在捲動膠囊列
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    // 右鍵（桌機）或系統的長按選單（Android）：計時器還沒觸發才由這裡觸發，兩邊不會重複
    onContextMenu: (e: Event) => {
      e.preventDefault(); clear();
      const fired = !!t.current?.fired;
      if (t.current) t.current.fired = true;
      if (!fired) onLong();
    },
    /** 長按已經觸發 → 這次點擊略過 */
    consumed: () => { const f = !!t.current?.fired; if (t.current) t.current.fired = false; return f; },
  };
}

function GroupChip({ name, label, pressed, system, onPick, onEdit }: { name: string; label?: string; pressed: boolean; system?: boolean; onPick: () => void; onEdit?: () => void }) {
  const lp = useLongPress(() => onEdit?.());
  const { consumed, ...events } = lp;
  return (
    <button class={`chip ${system ? 'system' : ''}`} aria-pressed={pressed} {...(onEdit ? events : {})}
      aria-description={onEdit ? '長按可編輯' : undefined}
      onClick={() => { if (onEdit && consumed()) return; onPick(); }} data-group={name}>
      {label ?? name}{system ? <span class="sys-mark">系統</span> : null}
    </button>
  );
}

/** 群組膠囊列：全部｜使用者群組…｜系統清單｜＋｜編輯 */
export function GroupChips({ groups, group, onPick, hot, onNew, onEdit }: {
  groups: string[];
  group: string;
  onPick: (g: string) => void;
  /** 系統清單（熱門動能）：null＝沒有資料或已隱藏 */
  hot: { id: string; label: string } | null;
  onNew: () => void;
  /** focus＝直接編輯哪一個（長按帶入）；不給＝打開整個編輯面板 */
  onEdit: (focus?: string) => void;
}) {
  return (
    <div class="group-bar">
      <div class="chips group-chips" role="group" aria-label="群組">
        <GroupChip name={ALL_GROUPS} pressed={group === ALL_GROUPS} onPick={() => onPick(ALL_GROUPS)} />
        {groups.map((g) => <GroupChip key={g} name={g} pressed={group === g} onPick={() => onPick(g)} onEdit={() => onEdit(g)} />)}
        {hot ? <GroupChip name={hot.id} label={hot.label} system pressed={group === hot.id} onPick={() => onPick(hot.id)} onEdit={() => onEdit(HOT_LIST)} /> : null}
        <button class="chip chip-icon" aria-label="新增群組" onClick={onNew} data-testid="group-new"><IconPlus /></button>
      </div>
      {/* 「編輯」固定在右邊，群組再多也看得到（膠囊在它左邊橫向捲動） */}
      <button class="text-btn group-edit-btn" onClick={() => onEdit()} data-testid="group-edit">編輯</button>
    </div>
  );
}

/** 新群組的輸入列（面板最上面；mode＝new 時只有這一塊） */
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

export interface ManageGroupsProps {
  /** null＝關閉；new＝只建立新群組；manage＝完整的編輯面板 */
  mode: 'new' | 'manage' | null;
  /** manage 時直接展開哪一個群組的改名（長按帶入）；HOT_LIST＝捲到系統清單 */
  focus?: string | null;
  onClose: () => void;
  groups: string[];
  counts: Map<string, number>;
  prefs: WatchPrefs;
  /** 系統清單（熱門動能）目前的檔數與名稱；沒有資料時為 null（不顯示那一區） */
  hot: { label: string; count: number } | null;
  onCreated: (name: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (undo: WatchGroupUndo) => void;
  /** 剛刪除、還可以復原的群組（面板開著時復原鈕顯示在面板裡；頁面底部的提示被面板蓋住） */
  undo: WatchGroupUndo | null;
  onUndo: () => void;
}

export function ManageGroupsSheet({ mode, focus, onClose, groups, counts, prefs, hot, onCreated, onRenamed, onDeleted, undo, onUndo }: ManageGroupsProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const open = mode !== null;
  useEffect(() => {
    if (!open) return;
    setDeleting(null); setErr(''); setMsg('');
    const g = focus && focus !== HOT_LIST && groups.includes(focus) ? focus : null;
    setRenaming(g); setDraft(g ?? '');
  }, [open, focus]);

  const hotHidden = prefs.hidden.includes(HOT_LIST);
  const quick: { key: string; label: string; add: () => void }[] = [];
  if (!groups.includes(DEFAULT_GROUP)) quick.push({ key: 'default', label: DEFAULT_GROUP, add: () => create(DEFAULT_GROUP) });
  if (hot && hotHidden) quick.push({ key: 'hot', label: `${hot.label}（系統）`, add: () => { void setWatchListHidden(HOT_LIST, false); setMsg(`已加回「${hot.label}」`); } });

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

  if (mode === 'new') {
    return (
      <Sheet open onClose={onClose} title="新群組">
        <NewGroup existing={groups} autoFocus onCreate={(n) => { void create(n).then(onClose); }} />
        <p class="caption muted">建立後就可以把股票加進來；一檔股票只在一個群組。</p>
      </Sheet>
    );
  }
  const others = (name: string) => [...new Set([DEFAULT_GROUP, ...groups])].filter((g) => g !== name);
  return (
    <Sheet open={open} onClose={onClose} title="編輯群組" detent="full">
      <NewGroup existing={groups} autoFocus={false} onCreate={(n) => void create(n)} />
      {quick.length ? (
        <div class="group-quick" role="group" aria-label="快速加入">
          <span class="caption muted">快速加入</span>
          {quick.map((q) => (
            <button key={q.key} class="chip chip-add" onClick={q.add} data-testid={`group-quick-${q.key}`}><IconPlus />{q.label}</button>
          ))}
        </div>
      ) : null}
      {undo ? (
        <div class="group-undo" role="status" data-testid="group-undo">
          <span class="caption grow">{undoText(undo)}</span>
          <button class="text-btn" onClick={onUndo}>復原</button>
        </div>
      ) : msg ? <p class="caption muted" role="status" data-testid="group-msg">{msg}</p> : null}

      <h3 class="eyebrow group-h">我的群組</h3>
      {groups.length ? (
        <ul class="group-list" data-testid="group-list">
          {groups.map((g) => {
            const n = counts.get(g) ?? 0;
            return (
              <li key={g} class="group-row-wrap" data-testid={`group-row-${g}`}>
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
              onChange={(e) => void setWatchListHidden(HOT_LIST, !(e.target as HTMLInputElement).checked)} /><span /></label>
          </div>
        </>
      ) : null}
      <p class="caption muted group-tip">長按群組列上的任一個群組，可以直接編輯它。刪除後可以按「復原」。</p>
    </Sheet>
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
