/** 線條圖示（仿 SF Symbols 風格）。aria-hidden，文字標籤另外提供。 */
import type { JSX } from 'preact';

const base = (children: JSX.Element | JSX.Element[]) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconToday = () => base([<rect x="3.5" y="4.5" width="17" height="16" rx="3" />, <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />, <path d="M8 14h3v3H8z" />]);
export const IconStar = () => base(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />);
export const IconFilter = () => base([<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />]);
export const IconChart = () => base([<path d="M4 19.5h16" />, <path d="M6 16l4-5 3.5 3L19 7" />, <circle cx="19" cy="7" r="1.2" />]);
export const IconBook = () => base([<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" />, <path d="M5 16a3 3 0 0 1 3-3h11" />]);
export const IconMore = () => base([<circle cx="6" cy="12" r="1.4" />, <circle cx="12" cy="12" r="1.4" />, <circle cx="18" cy="12" r="1.4" />]);
export const IconBack = () => base(<path d="M15 5l-7 7 7 7" />);
export const IconPlus = () => base(<path d="M12 5v14M5 12h14" />);
export const IconStarFill = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
export const IconChevron = () => base(<path d="M9 5l7 7-7 7" />);
