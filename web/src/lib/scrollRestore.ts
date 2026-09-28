/**
 * 返回時保持捲動位置與元件狀態（v3 M1-2）。
 * - history.scrollRestoration = 'manual'：瀏覽器自己的還原在 hash 路由＋非同步資料下常常還原到資料載入前的高度。
 * - 每一筆歷史紀錄有自己的 key（存在 history.state，hash 導覽時補上）；scrollY 與元件狀態以
 *   「路由＋key」存在 sessionStorage，分頁關閉即清除。
 * - 返回（回到有 key 的紀錄）時，等頁面高度足夠（資料渲染完成）再捲回去；使用者先動手捲動就放棄還原。
 * - 個股頁之間左右滑動是 location.replace（取代目前的紀錄），清單頁那一筆紀錄的位置不受影響。
 */

const PREFIX = 'nav:';
const RESTORE_TIMEOUT = 4000;

export interface EntryState {
  key: string;
  /** 在 App 內的第幾筆紀錄（0＝直接開啟；> 0 時返回鍵用 history.back()） */
  idx: number;
}

let current: EntryState | null = null;
let currentPath = '';
let cancelRestore: (() => void) | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 目前紀錄在 sessionStorage 的鍵：路由＋history key。 */
export function entryId(path: string, key: string): string {
  return `${PREFIX}${path}#${key}`;
}

function readEntry(id: string): { y?: number; s?: Record<string, unknown> } {
  const st = storage();
  if (!st) return {};
  try {
    return JSON.parse(st.getItem(id) ?? '{}') as { y?: number; s?: Record<string, unknown> };
  } catch {
    return {};
  }
}

function writeEntry(id: string, patch: { y?: number; s?: Record<string, unknown> }): void {
  const st = storage();
  if (!st) return;
  try {
    st.setItem(id, JSON.stringify({ ...readEntry(id), ...patch }));
  } catch {
    /* 空間不足或無痕模式：放棄記住 */
  }
}

function currentId(): string | null {
  return current ? entryId(currentPath, current.key) : null;
}

/** 仍在畫面上的元件狀態（離開一筆紀錄時一次寫入，避免漏掉掛載後才改變、但沒有再寫入的值）。 */
const live = new Map<string, () => unknown>();

export function registerState(name: string, get: () => unknown): () => void {
  live.set(name, get);
  return () => { if (live.get(name) === get) live.delete(name); };
}

/** 離開目前紀錄前：寫入捲動位置與所有仍在畫面上的元件狀態。 */
export function snapshot(): void {
  const id = currentId();
  if (!id) return;
  const e = readEntry(id);
  const s = { ...(e.s ?? {}) };
  for (const [name, get] of live) s[name] = get();
  writeEntry(id, { y: Math.round(window.scrollY), s });
}

/** 記下目前紀錄的捲動位置（離開前、捲動時呼叫）。 */
export function saveScroll(): void {
  const id = currentId();
  if (id) writeEntry(id, { y: Math.round(window.scrollY) });
}

/** 元件狀態：讀取目前紀錄已存的值。 */
export function loadState<T>(name: string): T | undefined {
  const id = currentId();
  if (!id) return undefined;
  const s = readEntry(id).s;
  return s && name in s ? (s[name] as T) : undefined;
}

/** 元件狀態：寫入目前紀錄。 */
export function saveState(name: string, value: unknown): void {
  const id = currentId();
  if (!id) return;
  const e = readEntry(id);
  writeEntry(id, { s: { ...(e.s ?? {}), [name]: value } });
}

/**
 * 進入一筆紀錄（初次載入或 hashchange 時由路由呼叫）。回傳該紀錄存過的捲動位置（新紀錄為 null）。
 * 新紀錄：補上 key 與 idx（沿用上一筆 idx + 1；location.replace 取代時沿用同一個 idx）。
 */
export function enterEntry(path: string, replaced = false): number | null {
  const st = history.state as Partial<EntryState> | null;
  if (st && typeof st.key === 'string') {
    current = { key: st.key, idx: typeof st.idx === 'number' ? st.idx : 0 };
    currentPath = path;
    const y = readEntry(entryId(path, current.key)).y;
    return typeof y === 'number' ? y : null;
  }
  const idx = current ? (replaced ? current.idx : current.idx + 1) : 0;
  current = { key: newKey(), idx };
  currentPath = path;
  try {
    history.replaceState({ ...(history.state ?? {}), ...current }, '');
  } catch {
    /* 某些嵌入環境不允許 */
  }
  return null;
}

export function entryIndex(): number {
  return current?.idx ?? 0;
}

/**
 * 等頁面高度足夠再捲到 y（資料是非同步載入的）；使用者先捲動或觸碰就放棄。
 * 回傳取消函式。
 */
export function restoreScroll(y: number, timeout = RESTORE_TIMEOUT): () => void {
  cancelRestore?.();
  let done = false;
  let raf = 0;
  const t0 = performance.now();
  const stop = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    ro?.disconnect();
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(ev, stop);
    if (cancelRestore === stop) cancelRestore = null;
  };
  const attempt = () => {
    if (done) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max >= y - 1) {
      window.scrollTo(0, y);
      // 捲到之後再確認一次（圖表或字型晚一步撐開高度時可能被夾住）
      if (Math.abs(window.scrollY - y) <= 1 || performance.now() - t0 > timeout) { stop(); return; }
    } else if (performance.now() - t0 > timeout) {
      window.scrollTo(0, Math.max(0, max));
      stop();
      return;
    }
    raf = requestAnimationFrame(attempt);
  };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => attempt());
  ro?.observe(document.body);
  for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(ev, stop, { passive: true, once: true });
  cancelRestore = stop;
  attempt();
  return stop;
}

/** 是否正在等待還原捲動位置（頁面應盡快畫出全部內容，高度才夠） */
export function restorePending(): boolean {
  return cancelRestore !== null;
}

let installed = false;

/** 安裝：手動還原＋捲動時記錄位置（節流到每個畫格一次）。 */
export function installScrollRestore(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    history.scrollRestoration = 'manual';
  } catch {
    /* 舊瀏覽器 */
  }
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (!cancelRestore) saveScroll(); });
  }, { passive: true });
  window.addEventListener('pagehide', () => saveScroll());
}

/** 測試用：重設模組狀態。 */
export function _reset(): void {
  live.clear();
  current = null;
  currentPath = '';
  cancelRestore = null;
}
