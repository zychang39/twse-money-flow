/**
 * 原創線條圖示集（24 × 24、1.6 描邊、圓角端點）。一律 aria-hidden，文字標籤由使用端提供。
 * 不使用 emoji，也不沿用任何第三方 App 的圖示。
 */
import type { ComponentChildren } from 'preact';

function base(children: ComponentChildren, strokeWidth = 1.6) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

// ---------- Tab ----------
export const IconTonight = () => base(<><path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z" /><path d="M16.5 4.2v2.6M15.2 5.5h2.6" /></>);
export const IconMine = () => base(<><path d="M3.5 16.5 8.5 11l3.6 3.4L20.5 6" /><path d="M3.5 20.5h17" /></>);
export const IconExplore = () => base(<><circle cx="12" cy="12" r="8.6" /><path d="m15.4 8.6-2 4.8-4.8 2 2-4.8 4.8-2Z" /></>);
export const IconDiscipline = () => base(<><circle cx="12" cy="12" r="8.6" /><path d="M12 7.2a4.8 4.8 0 1 1-4.8 4.8" /><circle cx="12" cy="12" r="1.2" /></>);

// ---------- 導覽與動作 ----------
export const IconPerson = () => base(<><circle cx="12" cy="8.6" r="3.4" /><path d="M5.2 19.4c1.2-3.2 3.8-4.8 6.8-4.8s5.6 1.6 6.8 4.8" /></>);
export const IconSearch = () => base(<><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.6 4.6" /></>);
export const IconBack = () => base(<path d="M14.8 5.2 8 12l6.8 6.8" />);
export const IconChevron = () => base(<path d="m9.5 6.5 5.5 5.5-5.5 5.5" />);
export const IconChevronDown = () => base(<path d="m6.5 9.5 5.5 5.5 5.5-5.5" />);
export const IconPlus = () => base(<path d="M12 5.5v13M5.5 12h13" />);
export const IconClose = () => base(<path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />);
export const IconCheck = () => base(<path d="m5.5 12.5 4.2 4.2 8.8-9.4" />, 1.8);
export const IconStar = () => base(<path d="m12 4.2 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7L12 4.2Z" />);
export const IconStarFill = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m12 4.2 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7L12 4.2Z" />
  </svg>
);
export const IconMore = () => base(<><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>, 2);
export const IconTrash = () => base(<><path d="M5 7h14M9.5 7V5.2h5V7M7 7l.8 12h8.4L17 7" /></>);
export const IconFolder = () => base(<path d="M3.8 7.5a2 2 0 0 1 2-2h3.6l2 2h6.8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2Z" />);
export const IconExpand = () => base(<><path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15" /></>);
export const IconInfo = () => base(<><circle cx="12" cy="12" r="8.6" /><path d="M12 11v5.2M12 7.9v.2" /></>);
export const IconRisk = () => base(<><path d="M12 4.5 20.2 18.8H3.8Z" /><path d="M12 10v4M12 16.6v.2" /></>);
export const IconClock = () => base(<><circle cx="12" cy="12" r="8.6" /><path d="M12 7.5V12l3 2" /></>);
export const IconCloudOff = () => base(<><path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .6-7.5 5.5 5.5 0 0 0-10.3-1.5A4.5 4.5 0 0 0 7.5 18.5Z" /><path d="m4.5 4.5 15 15" /></>);
export const IconMoonRest = () => base(<><path d="M17.8 15.6A6.6 6.6 0 0 1 9 6.8a6.6 6.6 0 1 0 8.8 8.8Z" /><path d="M4 20.5h16" /></>);
export const IconSeed = () => base(<><path d="M12 20.5v-8" /><path d="M12 12.5c0-3.6 2.6-6 6.5-6 0 3.6-2.6 6-6.5 6Z" /><path d="M12 14.5c0-2.8-2-4.8-5.2-4.8 0 2.8 2 4.8 5.2 4.8Z" /></>);

// ---------- 頭像選單 ----------
export const IconSliders = () => base(<><path d="M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9" /><circle cx="15.5" cy="7" r="2" /><circle cx="8.5" cy="17" r="2" /></>);
export const IconExport = () => base(<><path d="M12 14.5V4.5M8 8.5l4-4 4 4" /><path d="M4.5 13.5v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" /></>);
export const IconPulse = () => base(<><rect x="3.5" y="4.5" width="17" height="15" rx="3.5" /><path d="M6.5 12.5h2.6l1.6-3.6 2.6 7 1.6-3.4h2.6" /></>);
export const IconDoc = () => base(<><path d="M7 3.8h7l4 4v12.4H7Z" /><path d="M14 3.8v4h4M9.8 12h5M9.8 15.5h5" /></>);

// ---------- 探索 ----------
export const IconFilter = () => base(<path d="M4.5 5.5h15l-5.8 7.2v5.6l-3.4 1.5v-7.1Z" />);
export const IconHistory = () => base(<><path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" /><path d="M4.5 4.8v3.4h3.4" /><path d="M12 8.2V12l2.6 1.8" /></>);
export const IconGrid = () => base(<><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>);
export const IconLayers = () => base(<><path d="m12 4.5 8 4-8 4-8-4Z" /><path d="m4 12.5 8 4 8-4M4 16.5l8 4 8-4" /></>);
export const IconThermo = () => base(<><path d="M10 14.6V5.5a2 2 0 0 1 4 0v9.1a3.8 3.8 0 1 1-4 0Z" /><path d="M12 9.5v7" /></>);
export const IconCalendar = () => base(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" /><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" /></>);
export const IconShield = () => base(<><path d="M12 3.8 18.8 6.5v5.2c0 4.2-2.9 7.3-6.8 8.5-3.9-1.2-6.8-4.3-6.8-8.5V6.5Z" /><path d="M12 9v4M12 15.6v.2" /></>);
// 2026-10-02 健檢：探索九宮格每格一個不重複的圖示
/** 燒瓶：指標效度表（統計檢定） */
export const IconFlask = () => base(<><path d="M9.5 3.8h5M10.5 3.8v5.6L5.6 18a1.6 1.6 0 0 0 1.4 2.4h10a1.6 1.6 0 0 0 1.4-2.4l-4.9-8.6V3.8" /><path d="M8.2 14.5h7.6" /></>);
/** 書架：策略庫 */
export const IconBooks = () => base(<><path d="M4.5 4.5h4v15h-4ZM10.5 4.5h4v15h-4Z" /><path d="m15.6 6.1 3.9-1 3.8 14.5-3.9 1Z" /><path d="M4.5 15.5h4M10.5 15.5h4" /></>);
/** 警示三角：處置預警 */
export const IconAlert = () => base(<><path d="M12 4.2 20.4 19H3.6L12 4.2Z" /><path d="M12 9.5v4.4M12 16.4v.2" /></>);
/** 公事包：主動式 ETF（基金） */
export const IconBriefcase = () => base(<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M3.5 12.5h17" /></>);

// ---------- 流程 ----------
export const IconNotebook = () => base(<><path d="M6.5 3.8h11a1.5 1.5 0 0 1 1.5 1.5v13.4a1.5 1.5 0 0 1-1.5 1.5h-11Z" /><path d="M6.5 3.8v16.4M4.5 8h4M4.5 12h4M4.5 16h4M11 8.5h5" /></>);
export const IconClipboard = () => base(<><path d="M8.5 5H7a1.5 1.5 0 0 0-1.5 1.5v12.5A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 17 5h-1.5" /><rect x="8.5" y="3.5" width="7" height="3" rx="1" /><path d="m9 13.2 2.2 2.2 4-4.4" /></>);
export const IconBars = () => base(<><path d="M5 19.5V13M10 19.5V8M15 19.5v-4.5M20 19.5V5.5" /></>);
export const IconMedal = () => base(<><circle cx="12" cy="14" r="5.5" /><path d="m9 8.8-2.5-5h4L12 7l1.5-3.2h4L15 8.8" /><path d="m12 11.6.9 1.6 1.7.3-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.7-.3Z" /></>);
export const IconPaper = () => base(<><rect x="4" y="4.5" width="16" height="15" rx="2.5" /><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" /></>);

/** 成就徽章：圓框 ＋ 內部線條圖形（原創）。 */
const badgeFrame = (inner: ComponentChildren) => base(<><circle cx="12" cy="12" r="10" stroke-dasharray="2.2 1.6" /><g transform="translate(6 6) scale(0.5)">{inner}</g></>, 1.2);
export const BADGE_ICONS: Record<string, () => preact.JSX.Element> = {
  first_ritual: () => badgeFrame(<><path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z" stroke-width="2.4" /></>),
  streak_7: () => badgeFrame(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke-width="2.4" /><path d="M9 11h6l-3.5 6" stroke-width="2.4" /></>),
  streak_30: () => badgeFrame(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke-width="2.4" /><path d="M7.5 10.5h3l-2 2.4a1.8 1.8 0 1 1-1.2 3.1M14 10.5h2.5v6H14z" stroke-width="2.2" /></>),
  reviews_20: () => badgeFrame(<><path d="M7 3.8h7l4 4v12.4H7Z" stroke-width="2.4" /><path d="m10 15.5 5-5 1.5 1.5-5 5H10Z" stroke-width="2.2" /></>),
  stops_10: () => badgeFrame(<><path d="M12 3.8 18.8 6.5v5.2c0 4.2-2.9 7.3-6.8 8.5-3.9-1.2-6.8-4.3-6.8-8.5V6.5Z" stroke-width="2.4" /><path d="M8.5 12.5h7" stroke-width="2.4" /></>),
  checklists_10: () => badgeFrame(<><rect x="5.5" y="4.5" width="13" height="16" rx="2" stroke-width="2.4" /><path d="m9 12.5 2.2 2.2 4-4.4" stroke-width="2.4" /></>),
  backtest_own: () => badgeFrame(<><path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" stroke-width="2.4" /><path d="M4.5 4.8v3.4h3.4M12 8.2V12l2.6 1.8" stroke-width="2.4" /></>),
  first_backup: () => badgeFrame(<><path d="M12 14.5V4.5M8 8.5l4-4 4 4" stroke-width="2.4" /><path d="M4.5 13.5v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" stroke-width="2.4" /></>),
  // 2026-10 流程成就（§8.7）
  first_compliant: () => badgeFrame(<><rect x="5.5" y="4.5" width="13" height="16" rx="2" stroke-width="2.4" /><path d="m9 12.5 2.2 2.2 4-4.4" stroke-width="2.4" /></>),
  streak_5: () => badgeFrame(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke-width="2.4" /><path d="M8 13h8" stroke-width="2.4" /></>),
  streak_20: () => badgeFrame(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke-width="2.4" /><path d="M8 11h8M8 15h8" stroke-width="2.4" /></>),
  streak_60: () => badgeFrame(<><rect x="4" y="5.5" width="16" height="14.5" rx="3" stroke-width="2.4" /><path d="M8 10h8M8 13h8M8 16h8" stroke-width="2.2" /></>),
  first_plan_stop: () => badgeFrame(<><path d="M12 3.8 18.8 6.5v5.2c0 4.2-2.9 7.3-6.8 8.5-3.9-1.2-6.8-4.3-6.8-8.5V6.5Z" stroke-width="2.4" /><path d="M8.5 12.5h7" stroke-width="2.4" /></>),
  reviews_10: () => badgeFrame(<><path d="M7 3.8h7l4 4v12.4H7Z" stroke-width="2.4" /><path d="m10 15.5 5-5 1.5 1.5-5 5H10Z" stroke-width="2.2" /></>),
  compliant_30: () => badgeFrame(<><rect x="5.5" y="4.5" width="13" height="16" rx="2" stroke-width="2.4" /><path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4" stroke-width="2.2" /></>),
  risk_run_20: () => badgeFrame(<><path d="M12 3.8 18.8 6.5v5.2c0 4.2-2.9 7.3-6.8 8.5-3.9-1.2-6.8-4.3-6.8-8.5V6.5Z" stroke-width="2.4" /><path d="m9 12.5 2.2 2.2 4-4.4" stroke-width="2.2" /></>),
};
