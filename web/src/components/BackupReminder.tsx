import { useDb } from '../hooks';
import { getSetting, listTrades, listWatch, setSetting } from '../db/db';
import { thresholds } from '../lib/config';
import { Banner } from './DataStatus';
import { IconExport } from './Icons';

/** App 內定期提醒備份（有本機資料且超過設定天數未備份）。語氣平靜，可稍後再說。 */
export function BackupReminder() {
  const state = useDb(async () => {
    const last = await getSetting<string | null>('lastBackupAt', null);
    let firstUse = await getSetting<string | null>('firstUseAt', null);
    if (!firstUse) {
      firstUse = new Date().toISOString();
      await setSetting('firstUseAt', firstUse);
    }
    const dismissed = await getSetting<string | null>('backupReminderDismissedAt', null);
    const hasData = (await listWatch()).length + (await listTrades()).length > 0;
    return { last, dismissed, hasData, firstUse };
  });
  if (!state || !state.hasData) return null;
  const days = Number(thresholds.portfolio?.backup_reminder_days ?? 14);
  const ref = [state.last, state.dismissed, state.firstUse].filter(Boolean).sort().pop();
  const since = ref ? (Date.now() - Date.parse(ref)) / 86400000 : Infinity;
  if (since < days) return null;
  return (
    <div style={{ padding: 'calc(var(--safe-top) + var(--s-2)) var(--gutter) 0', position: 'relative', zIndex: 2 }}>
      <Banner icon={<IconExport />} title={state.last ? `上次備份是 ${state.last.slice(0, 10)}` : '還沒有備份過本機資料'}
        action={<div class="row" style={{ marginTop: 'var(--s-2)' }}><a class="btn small" href="#/me/backup">前往備份</a><button class="btn small" onClick={() => setSetting('backupReminderDismissedAt', new Date().toISOString())}>稍後</button></div>}>
        資料只存在這台裝置，建議定期匯出。
      </Banner>
    </div>
  );
}
