/**
 * 流程頁與簡報頁「今日流程」一列共用：讀使用者資料（IndexedDB）、交易日曆（meta.json）、風險上限設定，算出每日步驟、連續、等級、成就、新手導覽與名詞圖鑑進度。
 * 等級不下降：曾達到的最高等級存在設定 `flowProgress.maxLevel`（流程頁寫入；這裡只讀）。
 */
import { useMemo } from 'preact/hooks';
import { useAsync, useDb } from '../hooks';
import { loadMeta } from './api';
import { useUser } from './useUser';
import { getSetting } from '../db/db';
import { DEFAULT_PORTFOLIO, riskLimitOf, type PortfolioSettings } from '../lib/settings';
import { makeCalendar } from '../lib/tradingCalendar';
import { dayRings, daySteps, displayDay, flowStreak, flowXp, legacyOf, levelFor, type FlowInput } from '../lib/ritual';
import { onboardingTasks } from '../lib/onboarding';
import { TERMS } from '../lib/glossary';
import { flowBadges } from '../lib/achievements';

/** 已顯示過的進度（升級、取得成就的橫幅只顯示一次；等級不下降） */
export interface FlowProgress { maxLevel: number; badges: string[] }
export const FLOW_PROGRESS_KEY = 'flowProgress';

export function useFlow() {
  const user = useUser();
  const meta = useAsync(loadMeta, []);
  const extra = useDb(async () => ({
    portfolio: await getSetting<PortfolioSettings>('portfolio', DEFAULT_PORTFOLIO),
    portfolioSet: (await getSetting<PortfolioSettings | null>('portfolio', null)) !== null,
    progress: await getSetting<FlowProgress | null>(FLOW_PROGRESS_KEY, null),
  }));
  const ready = !!user && !!extra && !meta.loading;
  return useMemo(() => {
    if (!ready || !user || !extra) return null;
    const cal = makeCalendar(meta.data?.calendar);
    const input: FlowInput = { cal, activities: user.activity, trades: user.trades, riskLimit: riskLimitOf(extra.portfolio), now: new Date().toISOString(), watchCount: user.watch.length };
    const { day, isTradingDay } = displayDay(cal, input.now);
    const rings = dayRings(day, input);
    const steps = daySteps(day, input);
    const onboarding = onboardingTasks(user.activity, { watchCount: user.watch.length, riskSet: extra.portfolioSet });
    const termsRead = new Set(user.activity.filter((a) => a.type === 'term_read').map((a) => String(a.meta?.id ?? ''))).size;
    const streak = flowStreak(input);
    const xp = flowXp(input);
    const floorLevel = Math.max(legacyOf(input.activities)?.level ?? 1, extra.progress?.maxLevel ?? 1);
    const level = levelFor(xp, floorLevel);
    const badges = flowBadges(input, streak.best, user.lastBackupAt);
    return { user, input, day, isTradingDay, rings, steps, onboarding, terms: { read: termsRead, total: TERMS.length }, streak, xp, level, badges, progress: extra.progress, gamification: user.gamification, portfolio: extra.portfolio };
  }, [ready, user, extra, meta.data]);
}

export type FlowState = NonNullable<ReturnType<typeof useFlow>>;
