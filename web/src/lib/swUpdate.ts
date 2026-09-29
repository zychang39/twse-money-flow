/**
 * Service worker 更新流程（三層，使用者不需要知道什麼是快取）：
 * 1. 自動更新：啟動時與回到前景時呼叫 registration.update()；新版在等待（waiting）時，
 *    若使用者還沒開始操作（啟動或回到前景後 autoWindowMs 內、沒有點擊或按鍵、沒有開啟面板或表單），
 *    直接送 SKIP_WAITING，新版接手（controllerchange）時重新載入。
 * 2. 更新提示：使用者正在操作時偵測到新版，只顯示不遮擋內容的提示「有新版本，點此更新」，不打斷表單；
 *    點擊後才送 SKIP_WAITING → controllerchange → 重新載入。
 * 3. 手動檢查：設定頁「檢查更新」呼叫 check()。
 *
 * 這裡只依賴最小介面（RegLike／ContainerLike），方便以 mock 測試；瀏覽器的接線在 main.tsx。
 */

export interface WorkerLike {
  state: string;
  postMessage(msg: unknown): void;
  addEventListener(type: 'statechange', fn: () => void): void;
}
export interface RegLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', fn: () => void): void;
}
export interface ContainerLike {
  controller: unknown;
  addEventListener(type: 'controllerchange', fn: () => void): void;
}

/** idle：沒有新版；available：有新版等使用者點擊；applying：已送出 SKIP_WAITING，等待重新載入。 */
export type UpdateState = 'idle' | 'available' | 'applying';
export type CheckResult = 'latest' | 'available' | 'applying' | 'error';

export interface UpdaterDeps {
  reg: RegLike;
  container: ContainerLike;
  now: () => number;
  /** 是否有開啟中的面板、表單或聚焦中的輸入框（這時不自動重新載入）。 */
  isBusy: () => boolean;
  reload: () => void;
  onState: (s: UpdateState) => void;
  /** 啟動或回到前景後，這段時間內且沒有操作才自動套用。預設 3 秒。 */
  autoWindowMs?: number;
  /** 自動套用時間窗的起點（預設為建立 updater 的時間）。 */
  startedAt?: number;
  /** 建立之前使用者是否已經操作過（register 完成前就點擊；建立時若已有新版在等待，要據此判斷） */
  interacted?: boolean;
}

export const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

export function createUpdater(d: UpdaterDeps) {
  const windowMs = d.autoWindowMs ?? 3000;
  let windowStart = d.startedAt ?? d.now();
  let interacted = d.interacted ?? false;
  let requested = false;
  let reloading = false;
  let state: UpdateState = 'idle';
  // 第一次安裝（原本沒有 controller）時 clients.claim 也會觸發 controllerchange，這時不重新載入
  let hadController = !!d.container.controller;

  const setState = (s: UpdateState) => { state = s; d.onState(s); };
  const canAuto = () => !interacted && d.now() - windowStart <= windowMs && !d.isBusy();

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    d.reload();
  }

  d.container.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    // 我們要求的更新，或使用者還沒開始操作：直接重新載入；
    // 其他分頁套用的更新而使用者正在操作：只提示，由使用者決定（舊版外殼快取會保留一版，舊頁面仍可運作）
    if (requested || canAuto()) reloadOnce();
    else { requested = true; setState('available'); }
  });

  function onWaiting() {
    if (!d.container.controller) return; // 第一次安裝不算更新
    if (canAuto()) apply();
    else if (state !== 'applying') setState('available');
  }

  function track(w: WorkerLike) {
    if (w.state === 'installed') { onWaiting(); return; }
    w.addEventListener('statechange', () => { if (w.state === 'installed') onWaiting(); });
  }

  d.reg.addEventListener('updatefound', () => { if (d.reg.installing) track(d.reg.installing); });
  if (d.reg.waiting) onWaiting();
  else if (d.reg.installing) track(d.reg.installing);

  /** 套用新版：送 SKIP_WAITING；已經接手（其他分頁套用）時直接重新載入。 */
  function apply(): boolean {
    const w = d.reg.waiting;
    if (!w) {
      if (requested && state === 'available') { reloadOnce(); return true; }
      return false;
    }
    requested = true;
    setState('applying');
    w.postMessage(SKIP_WAITING);
    return true;
  }

  async function check(): Promise<CheckResult> {
    try {
      await d.reg.update();
    } catch {
      return 'error';
    }
    // update() 完成時新版可能還在下載（installing）；等它裝好或失敗
    const w = d.reg.installing;
    if (w) {
      await new Promise<void>((resolve) => {
        const done = () => { if (w.state !== 'installing') resolve(); };
        w.addEventListener('statechange', done);
        done();
      });
    }
    if (state === 'applying') return 'applying';
    if (d.reg.waiting) return 'available';
    return 'latest';
  }

  return {
    /** 使用者點擊、按鍵：之後偵測到的新版只顯示提示。 */
    markInteraction() { interacted = true; },
    /** 回到前景：重新開始自動套用的時間窗，並檢查更新。 */
    foreground() {
      windowStart = d.now();
      interacted = false;
      if (d.reg.waiting) onWaiting();
      return check();
    },
    check,
    apply,
    get state() { return state; },
  };
}

export type Updater = ReturnType<typeof createUpdater>;

/** 頁面上有面板、表單或聚焦中的輸入框（瀏覽器用）。 */
export function domBusy(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], .search-screen')) return true;
  const a = doc.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

/** 目前版本字串：commit 短碼＋建置日期（build 時由 Vite define 注入）。 */
export function appVersion(): string {
  return `${__APP_COMMIT__}・${__APP_BUILD_DATE__}`;
}

/* ---------- 頁面共用的狀態（main.tsx 建立 updater；提示元件與設定頁訂閱） ---------- */
let current: Updater | null = null;
let currentState: UpdateState = 'idle';
const listeners = new Set<(s: UpdateState) => void>();
let resolveReady: (u: Updater | null) => void = () => undefined;
const ready = new Promise<Updater | null>((r) => { resolveReady = r; });

/** main.tsx 註冊完成後呼叫；不支援 service worker（或開發模式）時傳 null。 */
export function setUpdater(u: Updater | null): void { current = u; resolveReady(u); }
export function getUpdater(): Updater | null { return current; }
/** 等 service worker 註冊完成（手動檢查更新可能在註冊完成前就被點擊）。 */
export function whenUpdater(): Promise<Updater | null> { return ready; }
export function publishState(s: UpdateState): void { currentState = s; listeners.forEach((f) => f(s)); }
export function updateState(): UpdateState { return currentState; }
export function subscribeUpdate(fn: (s: UpdateState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
