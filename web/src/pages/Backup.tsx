import { useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { useDb } from '../hooks';
import { getSetting, listActivity, listScreens, listTrades, listWatch, logActivity } from '../db/db';
import { loadSummary } from '../data/api';
import { downloadJson, exportAll, importAll, markBackedUp } from '../db/backup';
import { todayTpe } from '../lib/dates';

export default function Backup() {
  const info = useDb(async () => ({
    last: await getSetting<string | null>('lastBackupAt', null),
    watch: (await listWatch()).length,
    trades: (await listTrades()).length,
    screens: (await listScreens()).length,
    activity: (await listActivity()).length,
  }));
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [msg, setMsg] = useState('');

  async function doExport() {
    const data = await exportAll();
    downloadJson(data, `twse-money-flow-backup-${todayTpe()}.json`);
    await markBackedUp();
    const day = await loadSummary().then((x) => x.date).catch(() => todayTpe());
    await logActivity('backup', day);
    setMsg('已匯出備份檔。建議存到 iCloud 雲碟或其他裝置。');
  }

  async function doImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const counts = await importAll(JSON.parse(await file.text()), mode);
      setMsg(`匯入完成：自選 ${counts.watchlist}、交易 ${counts.trades}、選股組合 ${counts.screens}、設定 ${counts.settings}、紀律紀錄 ${counts.activity ?? 0}。`);
    } catch (err) {
      setMsg(`匯入失敗：${(err as Error).message}`);
    }
  }

  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead eyebrow="我的" title={info?.last ? `上次備份 ${info.last.slice(0, 10)}` : '還沒有備份過'} />
      <div class="card">
        <p class="body">所有使用者資料只存在這台裝置的瀏覽器（IndexedDB），不會上傳。清除 Safari 網站資料或換手機會遺失，請定期匯出。</p>
        <p class="caption muted" style={{ margin: 'var(--s-2) 0 var(--s-4)' }}>目前：自選 {info?.watch ?? 0} 檔・交易 {info?.trades ?? 0} 筆・選股組合 {info?.screens ?? 0} 組・紀律紀錄 {info?.activity ?? 0} 筆（含遊戲化資料）</p>
        <button class="btn primary block" onClick={doExport}>匯出全部資料（JSON）</button>
      </div>
      <h2 class="section-title">匯入</h2>
      <div class="card">
        <div class="segmented" role="group" aria-label="匯入方式">
          <button aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>取代全部</button>
          <button aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>合併</button>
        </div>
        <label class="field">
          <span>選擇備份檔（.json）</span>
          <input class="input" type="file" accept="application/json,.json" onChange={doImport} />
        </label>
        <p class="caption muted">舊版本的備份檔會自動升級格式；比 App 新的版本會拒絕匯入。</p>
      </div>
      {msg ? <div class="banner info" role="status">{msg}</div> : null}
    </div>
  );
}
