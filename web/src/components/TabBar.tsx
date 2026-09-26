import { IconBook, IconChart, IconFilter, IconMore, IconStar, IconToday } from './Icons';

const TABS = [
  { path: '/', label: '今日', icon: IconToday, match: (p: string) => p === '/' || p === '/today' },
  { path: '/watchlist', label: '自選', icon: IconStar, match: (p: string) => p.startsWith('/watchlist') },
  { path: '/screener', label: '選股', icon: IconFilter, match: (p: string) => p.startsWith('/screener') || p.startsWith('/backtest') },
  { path: '/market', label: '市場', icon: IconChart, match: (p: string) => p.startsWith('/market') },
  { path: '/journal', label: '日誌', icon: IconBook, match: (p: string) => p.startsWith('/journal') },
  { path: '/more', label: '更多', icon: IconMore, match: (p: string) => p.startsWith('/more') },
];

export function TabBar({ path }: { path: string }) {
  return (
    <nav class="tabbar" aria-label="主要分頁">
      {TABS.map((t) => {
        const Icon = t.icon;
        const current = t.match(path);
        return (
          <a key={t.path} href={`#${t.path}`} aria-current={current ? 'page' : undefined}>
            <Icon />
            <span>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
