/** 使用者資料（IndexedDB）：自選、交易、紀律紀錄、偏好設定。資料變更時自動重讀。 */
import { useDb } from '../hooks';
import { getSetting, listActivity, listTrades, listWatch } from '../db/db';

export function useUser() {
  return useDb(async () => ({
    watch: await listWatch(),
    trades: await listTrades(),
    activity: await listActivity(),
    gamification: await getSetting<boolean>('gamification', true),
    lastBackupAt: await getSetting<string | null>('lastBackupAt', null),
  }));
}
