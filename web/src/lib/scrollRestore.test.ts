/**
 * 捲動還原（2026-10-09）：位置沒對上時不再每一格重捲（最多 3 次、只在頁面長高後），更新前 forgetScroll 不記位置。
 * node 環境：以最小的 window／document 替身測試。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset, enterEntry, forgetScroll, restoreScroll, saveScroll } from './scrollRestore';

type Frame = (t: number) => void;

function setup(opts: { scrollHeight: number; innerHeight: number; takes: boolean }) {
  let scrollY = 0;
  let now = 0;
  const frames: Frame[] = [];
  const store = new Map<string, string>();
  const doc = { documentElement: { scrollHeight: opts.scrollHeight }, body: {} };
  const win = {
    get scrollY() { return scrollY; },
    innerHeight: opts.innerHeight,
    scrollTo: vi.fn((_x: number, y: number) => { if (opts.takes) scrollY = y; }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  vi.stubGlobal('history', { state: null as unknown, replaceState: vi.fn(), scrollRestoration: 'auto' });
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (f: Frame) => { frames.push(f); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const tick = (ms = 16) => { now += ms; for (const f of frames.splice(0)) f(now); };
  return { win, doc, store, tick, pending: () => frames.length };
}

describe('restoreScroll', () => {
  beforeEach(() => _reset());
  afterEach(() => vi.unstubAllGlobals());

  it('高度足夠就捲一次；位置對上即停止', () => {
    const t = setup({ scrollHeight: 5000, innerHeight: 800, takes: true });
    restoreScroll(1000);
    expect(t.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(t.win.scrollTo).toHaveBeenCalledWith(0, 1000);
    expect(t.pending()).toBe(0);
  });

  it('位置沒對上：不每一格重捲，只在頁面長高後再試，最多 3 次', () => {
    const t = setup({ scrollHeight: 5000, innerHeight: 800, takes: false });
    restoreScroll(1000);
    expect(t.win.scrollTo).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) t.tick();
    expect(t.win.scrollTo).toHaveBeenCalledTimes(1); // 高度沒變：不再捲
    t.doc.documentElement.scrollHeight = 6000;
    t.tick();
    expect(t.win.scrollTo).toHaveBeenCalledTimes(2);
    t.doc.documentElement.scrollHeight = 7000;
    t.tick();
    expect(t.win.scrollTo).toHaveBeenCalledTimes(3);
    expect(t.pending()).toBe(0); // 第 3 次後放棄
    t.doc.documentElement.scrollHeight = 8000;
    t.tick();
    expect(t.win.scrollTo).toHaveBeenCalledTimes(3);
  });

  it('高度不夠：等到逾時才捲到可捲的最底', () => {
    const t = setup({ scrollHeight: 1000, innerHeight: 800, takes: true });
    restoreScroll(5000, 100);
    expect(t.win.scrollTo).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) t.tick(16);
    expect(t.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(t.win.scrollTo).toHaveBeenCalledWith(0, 200);
  });
});

describe('forgetScroll（App 更新前）', () => {
  beforeEach(() => _reset());
  afterEach(() => vi.unstubAllGlobals());

  it('把目前紀錄的位置寫成 0，之後的 saveScroll 不再覆寫', () => {
    const t = setup({ scrollHeight: 5000, innerHeight: 800, takes: true });
    expect(enterEntry('/stock/2330')).toBeNull();
    t.win.scrollTo(0, 900);
    saveScroll();
    const [id] = [...t.store.keys()];
    expect(JSON.parse(t.store.get(id) ?? '{}').y).toBe(900);
    forgetScroll();
    expect(JSON.parse(t.store.get(id) ?? '{}').y).toBe(0);
    saveScroll();
    expect(JSON.parse(t.store.get(id) ?? '{}').y).toBe(0);
  });
});
