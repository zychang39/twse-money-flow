/** 簡易 hash 路由（GitHub Pages 友善）：#/stock/2330?list=holdings。舊網址自動轉址到新資訊架構。 */
import { useEffect, useState } from 'preact/hooks';
import { isTabSwitch } from './lib/tabs';
import { enterEntry, entryIndex, installScrollRestore, pauseScrollSave, restoreScroll, snapshot } from './lib/scrollRestore';
import { normCode } from './lib/code';

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return { path: clean, parts: clean.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

/** 舊頁面 → 新位置（書籤與外部連結不失效）。見 docs/design/IA_MAP.md。 */
export function legacyRedirect(path: string, query: string): string | null {
  const q = query ? `?${query}` : '';
  const map: Record<string, string> = {
    '/today': '/',
    '/watchlist': '/mine?seg=watch',
    '/screener': `/explore/screener${q}`,
    '/backtest': `/explore/backtest${q}`,
    '/market': '/explore/market',
    '/journal': '/discipline/journal',
    '/more': '/me',
    '/more/health': '/me/health',
    '/more/methodology': '/me/methodology',
    '/more/settings': '/me/settings',
    '/more/backup': '/me/backup',
    '/more/weekly': '/discipline/weekly',
    '/more/calendar': '/explore/calendar',
    '/more/disposition': '/explore/disposition',
  };
  if (map[path]) return map[path];
  // E-08：小寫代號（#/stock/00980a）→ 大寫網址
  const st = path.match(/^\/stock\/([^/]+)(.*)$/);
  if (st && normCode(st[1]) !== st[1]) return `/stock/${normCode(st[1])}${st[2]}${q}`;
  const m = path.match(/^\/market\/(.+)$/);
  if (m) return `/explore/sectors/${m[1]}`;
  return null;
}

/** 路由深度：用來決定轉場方向（往深處推入、往淺處返回）。 */
export function depth(path: string): number {
  if (path === '/' || path === '/mine' || path === '/explore' || path === '/discipline') return 0;
  return path.split('/').filter(Boolean).length;
}

let lastPath = typeof location === 'undefined' ? '/' : parseHash(location.hash).path;
/** none：不做整頁轉場、也不捲回頂端（個股頁左右滑動換股時，主角區已經自己滑過去了） */
type NavDir = 'push' | 'pop' | 'none';
let pendingDir: NavDir | null = null;
let pendingReplace = false;

/** 目前這筆歷史紀錄的識別（路由＋查詢字串）；捲動位置與元件狀態以此加上 history key 儲存。 */
const entryPath = () => location.hash.replace(/^#/, '') || '/';

let booted = false;
let current: Route | null = null;
const subscribers = new Set<(r: Route) => void>();

/**
 * 路由切換的副作用（記下離開頁的捲動位置、進入新紀錄、捲到頂端或還原）每次 hashchange 只做一次，
 * 再通知所有 useRoute 的元件（#12）。
 * 原本每個呼叫 useRoute 的元件（App、我的股票、日誌、回測…）各自註冊一個 hashchange 處理：第二個處理
 * 會把「清單頁在轉場中縮短時被夾住的捲動位置」存成新紀錄的位置、再還原回去，個股頁打開時就不在頂端。
 */
function onHashChange(): void {
  const next = parseHash(location.hash);
  const redirect = legacyRedirect(next.path, next.query.toString());
  if (redirect) {
    location.replace(`#${redirect}`);
    return;
  }
  const dir = pendingDir ?? (depth(next.path) > depth(lastPath) ? 'push' : depth(next.path) < depth(lastPath) ? 'pop' : 'swap');
  pendingDir = null;
  // 離開前記下上一筆紀錄的捲動位置與元件狀態，再進入新的紀錄（返回時 saved 為當時的位置）
  snapshot();
  // 新頁面畫出來之前，舊頁面縮短造成的捲動不能記成新紀錄的位置
  pauseScrollSave(true);
  const saved = enterEntry(entryPath(), pendingReplace);
  pendingReplace = false;
  // 切換分頁（例：今晚 → 搜尋）：內容直接替換，只有底部導覽的選取膠囊滑過去（Instagram 的做法）
  const tabSwitch = isTabSwitch(lastPath, next.path);
  lastPath = next.path;
  const apply = () => {
    current = next;
    subscribers.forEach((f) => f(next));
    if (saved !== null) restoreScroll(saved);
    else if (dir !== 'none') window.scrollTo(0, 0);
    pauseScrollSave(false);
  };
  type VT = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT | undefined };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduce && !tabSwitch && dir !== 'none') {
    document.documentElement.dataset.nav = dir;
    const vt = doc.startViewTransition(apply);
    // 快速連續切換時前一個轉場會被略過（"Transition was skipped"），apply 仍會執行；吞掉這個預期中的拒絕，
    // 不讓它變成未處理的錯誤
    for (const p of [vt?.ready, vt?.finished, vt?.updateCallbackDone]) p?.catch(() => undefined);
  } else apply();
}

/** 開啟或重新整理時只做一次：安裝捲動記錄與 hashchange 處理、進入目前紀錄、還原重新整理前的位置。 */
function boot(): void {
  if (booted) return;
  booted = true;
  installScrollRestore();
  const saved = enterEntry(entryPath());
  if (saved !== null && saved > 0) restoreScroll(saved); // 重新整理後還原（0 不需要捲動；更新後重新載入時 forgetScroll 已寫成 0）
  current = parseHash(location.hash);
  window.addEventListener('hashchange', onHashChange);
  const redirect = legacyRedirect(current.path, current.query.toString());
  if (redirect) location.replace(`#${redirect}`);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => {
    boot();
    return current ?? parseHash(location.hash);
  });
  useEffect(() => {
    subscribers.add(setRoute);
    // 掛載前剛好切換過路由（轉場進行中）：同步到最新
    if (current && current !== route) setRoute(current);
    return () => { subscribers.delete(setRoute); };
  }, []);
  return route;
}

export function navigate(path: string, replace = false, dir?: NavDir): void {
  const h = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === h) return; // 同一個網址不會觸發 hashchange
  pendingDir = dir ?? null;
  pendingReplace = replace;
  if (replace) location.replace(h);
  else location.hash = h;
}

/**
 * 左上角返回：App 內有上一筆紀錄時用 history.back()（與螢幕左緣右滑相同，會還原捲動位置與狀態）；
 * 直接開啟的網址沒有上一筆，改為前往 fallback（取代目前紀錄）。
 */
export function goBack(fallback: string): void {
  if (entryIndex() > 0) history.back();
  else navigate(fallback, true, 'pop');
}

export const href = (path: string) => `#${path}`;
