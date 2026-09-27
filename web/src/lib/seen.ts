/**
 * 「上次查看」：每個範圍（今晚、我的股票…）在本次開啟 App 時讀取上一次的快照作為基準，
 * 並把目前的資料寫成下一次的基準。同一次使用期間基準固定，來回切頁不會把變化「看掉」。
 */
import { getSetting, setSetting } from '../db/db';
import type { Snapshot } from './changes';

const baselines = new Map<string, Promise<Snapshot | null>>();
const committed = new Set<string>();

export function baseline(scope: string): Promise<Snapshot | null> {
  if (!baselines.has(scope)) baselines.set(scope, getSetting<Snapshot | null>(`seen:${scope}`, null));
  return baselines.get(scope)!;
}

export async function commit(scope: string, snap: Snapshot): Promise<void> {
  if (committed.has(scope)) return;
  committed.add(scope);
  await baseline(scope);
  await setSetting(`seen:${scope}`, snap);
}

const heroBase = new Map<string, Promise<number | null>>();
const heroCommitted = new Set<string>();

/** 主角數字上次查看的值（數字滾動的起點）。 */
export function heroSeen(key: string): Promise<number | null> {
  if (!heroBase.has(key)) heroBase.set(key, getSetting<Record<string, number>>('heroSeen', {}).then((m) => m[key] ?? null));
  return heroBase.get(key)!;
}

export async function commitHero(key: string, value: number | null | undefined): Promise<void> {
  if (value === null || value === undefined || !Number.isFinite(value) || heroCommitted.has(key)) return;
  heroCommitted.add(key);
  await heroSeen(key);
  const m = await getSetting<Record<string, number>>('heroSeen', {});
  await setSetting('heroSeen', { ...m, [key]: value });
}

/** 測試用 */
export function resetSeen(): void {
  baselines.clear(); committed.clear(); heroBase.clear(); heroCommitted.clear();
}
