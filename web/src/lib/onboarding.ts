/**
 * 新手導覽（M6）：一次性任務，每項 10 經驗值、各領一次（ritual.xpLedger 依 'onboard' 紀錄計分）。
 * 完成由系統自動判定：多數由操作當下記一筆 onboard（lib/flowTrack.ts markOnboard）；
 * 加入自選、讀名詞、填本金、備份也可由既有資料推得（logged=false 時由流程頁補記，經驗值從補記時起算）。
 */
import type { Activity } from '../db/db';

export interface OnboardTask { id: string; title: string; how: string; href: string }

export const ONBOARD_TASKS: OnboardTask[] = [
  { id: 'first_watch', title: '加入第一檔自選', how: '我的股票右上角「＋」，搜尋代號或名稱', href: '#/mine?seg=watch' },
  { id: 'range', title: '雙指看一段區間報酬', how: '個股主圖上兩指各按一點，看兩點之間的漲跌', href: '#/stock/2330' },
  { id: 'period_1d', title: '切到 1D 看當日走勢', how: '個股主圖下方的期間膠囊點「1D」', href: '#/stock/2330' },
  { id: 'swipe', title: '左右滑動切換自選股', how: '從自選清單進個股頁，在內容區左右滑動', href: '#/mine?seg=watch' },
  { id: 'ring_jump', title: '點四環跳分段', how: '個股頁總覽的四個環，點一個跳到對應分段', href: '#/stock/2330' },
  { id: 'term', title: '點開一個指標的說明', how: '點虛線底的名詞，看白話與進階說明', href: '#/stock/2330' },
  { id: 'group_page', title: '看一個族群頁', how: '探索 › 族群輪動，點一個族群', href: '#/explore/sectors' },
  { id: 'risk_settings', title: '在設定填本金與每筆風險', how: '設定 › 風險：本金、每筆風險 %', href: '#/me/settings' },
  { id: 'risk_to_checklist', title: '做一次風險試算並帶入檢查表', how: '個股頁 › 動能 › 波動與部位「用 ATR 試算部位」，再按帶入檢查表', href: '#/stock/2330/m/risk' },
  { id: 'strategy_period', title: '策略頁切換一次期間', how: '策略詳情 › 績效，切換期間；再到標的看新觸發與篩出的差別', href: '#/explore/strategies' },
  { id: 'backup', title: '做一次備份', how: '我 › 備份，匯出一個 JSON 檔', href: '#/me/backup' },
];

export interface OnboardState extends OnboardTask { done: boolean; logged: boolean }

/** 每項的完成狀態：有 onboard 紀錄＝完成（logged）；否則看既有資料能否推得（尚未記錄） */
export function onboardingTasks(activities: Activity[], ctx: { watchCount: number; riskSet: boolean }): OnboardState[] {
  const logged = new Set(activities.filter((a) => a.type === 'onboard' && a.meta?.task).map((a) => String(a.meta?.task)));
  const has = (t: Activity['type']) => activities.some((a) => a.type === t);
  const derived: Record<string, boolean> = {
    first_watch: ctx.watchCount > 0,
    term: has('term_read'),
    risk_settings: ctx.riskSet,
    backup: has('backup'),
  };
  return ONBOARD_TASKS.map((t) => ({ ...t, logged: logged.has(t.id), done: logged.has(t.id) || !!derived[t.id] }));
}
