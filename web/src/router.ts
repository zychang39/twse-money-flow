/** 簡易 hash 路由（GitHub Pages 友善）：#/stock/2330?list=holdings。舊網址自動轉址到新資訊架構。 */
import { useEffect, useState } from 'preact/hooks';
import { isTabSwitch } from './lib/tabs';

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

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      const next = parseHash(location.hash);
      const redirect = legacyRedirect(next.path, next.query.toString());
      if (redirect) {
        location.replace(`#${redirect}`);
        return;
      }
      const dir = pendingDir ?? (depth(next.path) > depth(lastPath) ? 'push' : depth(next.path) < depth(lastPath) ? 'pop' : 'swap');
      pendingDir = null;
      // 切換分頁（例：今晚 → 搜尋）：內容直接替換，只有底部導覽的選取膠囊滑過去（Instagram 的做法）
      const tabSwitch = isTabSwitch(lastPath, next.path);
      lastPath = next.path;
      const apply = () => {
        setRoute(next);
        if (dir !== 'none') window.scrollTo(0, 0);
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (doc.startViewTransition && !reduce && !tabSwitch && dir !== 'none') {
        document.documentElement.dataset.nav = dir;
        doc.startViewTransition(apply);
      } else apply();
    };
    window.addEventListener('hashchange', on);
    const first = parseHash(location.hash);
    const redirect = legacyRedirect(first.path, first.query.toString());
    if (redirect) location.replace(`#${redirect}`);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string, replace = false, dir?: NavDir): void {
  const h = path.startsWith('#') ? path : `#${path}`;
  pendingDir = dir ?? null;
  if (replace) location.replace(h);
  else location.hash = h;
}

export const href = (path: string) => `#${path}`;
