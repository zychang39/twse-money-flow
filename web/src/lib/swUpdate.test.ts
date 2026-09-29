import { describe, expect, it, vi } from 'vitest';
import { appVersion, createUpdater, SKIP_WAITING, type ContainerLike, type RegLike, type UpdateState, type WorkerLike } from './swUpdate';
import { swSource } from '../../build/service-worker';

class FakeWorker implements WorkerLike {
  state = 'installing';
  sent: unknown[] = [];
  private fns: (() => void)[] = [];
  postMessage(m: unknown) { this.sent.push(m); }
  addEventListener(_t: 'statechange', fn: () => void) { this.fns.push(fn); }
  setState(s: string) { this.state = s; this.fns.forEach((f) => f()); }
}

class FakeReg implements RegLike {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  updates = 0;
  private fns: (() => void)[] = [];
  nextUpdate: FakeWorker | null = null;
  async update() {
    this.updates++;
    if (this.nextUpdate) { this.found(this.nextUpdate); this.nextUpdate = null; }
  }
  addEventListener(_t: 'updatefound', fn: () => void) { this.fns.push(fn); }
  /** 瀏覽器找到新版：installing → installed（waiting） */
  found(w: FakeWorker) {
    this.installing = w;
    this.fns.forEach((f) => f());
    this.installing = null;
    this.waiting = w;
    w.setState('installed');
  }
}

class FakeContainer implements ContainerLike {
  controller: unknown = {};
  private fns: (() => void)[] = [];
  addEventListener(_t: 'controllerchange', fn: () => void) { this.fns.push(fn); }
  change() { this.fns.forEach((f) => f()); }
}

function setup(opts: { busy?: boolean; controller?: boolean } = {}) {
  let t = 0;
  let busy = opts.busy ?? false;
  const reg = new FakeReg();
  const container = new FakeContainer();
  if (opts.controller === false) container.controller = null;
  const reload = vi.fn();
  const states: UpdateState[] = [];
  const make = () => createUpdater({ reg, container, now: () => t, isBusy: () => busy, reload, onState: (s) => states.push(s) });
  return {
    reg, container, reload, states, make,
    advance: (ms: number) => { t += ms; },
    setBusy: (b: boolean) => { busy = b; },
  };
}

describe('SW 更新：自動套用', () => {
  it('啟動時已有新版在等待、使用者尚未操作 → 直接 SKIP_WAITING，接手時重新載入（不需點擊）', () => {
    const s = setup();
    const w = new FakeWorker(); w.state = 'installed'; s.reg.waiting = w;
    s.make();
    expect(w.sent).toEqual([SKIP_WAITING]);
    expect(s.reload).not.toHaveBeenCalled();
    s.container.change();
    expect(s.reload).toHaveBeenCalledTimes(1);
    s.container.change();
    expect(s.reload).toHaveBeenCalledTimes(1); // 只重新載入一次
  });

  it('啟動 3 秒內找到新版（updatefound → installed）也自動套用', async () => {
    const s = setup();
    const u = s.make();
    s.advance(1500);
    const w = new FakeWorker();
    s.reg.nextUpdate = w;
    await u.check();
    expect(w.sent).toEqual([SKIP_WAITING]);
    s.container.change();
    expect(s.reload).toHaveBeenCalled();
  });

  it('回到前景（visibilitychange）時重新開始 3 秒時間窗並呼叫 update()', async () => {
    const s = setup();
    const u = s.make();
    u.markInteraction();
    s.advance(60_000);
    const w = new FakeWorker();
    s.reg.nextUpdate = w;
    await u.foreground();
    expect(s.reg.updates).toBe(1);
    expect(w.sent).toEqual([SKIP_WAITING]);
  });

  it('第一次安裝（原本沒有 controller）不算更新、不重新載入', () => {
    const s = setup({ controller: false });
    s.make();
    s.container.controller = {};
    s.container.change(); // clients.claim
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.states).toEqual([]);
  });
});

describe('SW 更新：提示', () => {
  it('使用者已開始操作 → 只顯示提示；點擊後才送 SKIP_WAITING，接手時重新載入', async () => {
    const s = setup();
    const u = s.make();
    u.markInteraction();
    const w = new FakeWorker();
    s.reg.nextUpdate = w;
    expect(await u.check()).toBe('available');
    expect(w.sent).toEqual([]);
    expect(s.states).toEqual(['available']);
    expect(u.apply()).toBe(true);
    expect(w.sent).toEqual([SKIP_WAITING]);
    expect(s.states.at(-1)).toBe('applying');
    s.container.change();
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('超過 3 秒才找到新版 → 提示', () => {
    const s = setup();
    s.make();
    s.advance(3500);
    const w = new FakeWorker();
    s.reg.found(w);
    expect(w.sent).toEqual([]);
    expect(s.states).toEqual(['available']);
  });

  it('開著面板或表單（busy）→ 即使在 3 秒內也不自動套用', () => {
    const s = setup({ busy: true });
    const w = new FakeWorker(); w.state = 'installed'; s.reg.waiting = w;
    s.make();
    expect(w.sent).toEqual([]);
    expect(s.states).toEqual(['available']);
  });

  it('其他分頁套用了新版、這一頁正在操作 → 不強制重新載入，改提示；點擊提示才重新載入', () => {
    const s = setup();
    const u = s.make();
    u.markInteraction();
    s.container.change();
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.states).toEqual(['available']);
    expect(u.apply()).toBe(true);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('手動檢查：沒有新版回 latest；update 失敗回 error', async () => {
    const s = setup();
    const u = s.make();
    u.markInteraction();
    expect(await u.check()).toBe('latest');
    s.reg.update = () => Promise.reject(new Error('offline'));
    expect(await u.check()).toBe('error');
  });
});

describe('版本字串與 sw.js', () => {
  it('appVersion 是「commit 短碼・建置日期」', () => {
    expect(appVersion()).toMatch(/^[0-9a-z]+・\d{4}-\d{2}-\d{2}$/);
  });

  it('sw.js：安裝後等待 SKIP_WAITING，外殼一律向網路重新取得，並驗證 index.html 是這一版', () => {
    const src = swSource({ version: 'abc', appVersion: '4de32b6・2026-09-28', entry: 'assets/index-X.js', shell: ['./assets/index-X.js'] });
    expect(src).toContain("type === 'SKIP_WAITING'");
    expect(src).toContain("cache: 'reload'");
    expect(src).toContain("'./index.html?v=' + VERSION");
    expect(src).toContain('html.includes(ENTRY)');
    // install 內只有從舊版升級時才 skipWaiting（新協定由頁面決定何時接手）
    const install = src.slice(src.indexOf("addEventListener('install'"), src.indexOf("addEventListener('message'"));
    expect(install).toMatch(/startsWith\('shell-'\)[^\n]*self\.skipWaiting\(\)/);
    expect(() => new Function(src)).not.toThrow(); // 語法正確
  });
});

describe('SW 更新：註冊完成前就操作', () => {
  it('建立 updater 時已有新版在等待，但使用者在註冊完成前已點擊 → 只提示，不自動重新載入', () => {
    const reg = new FakeReg();
    const w = new FakeWorker(); w.state = 'installed'; reg.waiting = w;
    const container = new FakeContainer();
    const states: UpdateState[] = [];
    createUpdater({ reg, container, now: () => 0, isBusy: () => false, reload: () => undefined, onState: (s) => states.push(s), interacted: true });
    expect(w.sent).toEqual([]);
    expect(states).toEqual(['available']);
  });
});
