import { useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Card, List, PageTitle, Row, Section, Seg } from '../components/ui';
import { useDb } from '../hooks';
import { getSetting, listActivity, listScreens, listTrades, listWatch, logActivity } from '../db/db';
import { loadSummary } from '../data/api';
import { downloadJson, exportAll, importAll, markBackedUp, previewImport } from '../db/backup';
import { todayTpe } from '../lib/dates';
import { markOnboard } from '../lib/flowTrack';

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
    markOnboard('backup');
    setMsg('已匯出備份檔');
  }

  async function doImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); } catch { throw new Error('檔案不是有效的 JSON'); }
      // E-04：先驗證（不寫入）；取代全部前確認，說明會清除目前這台裝置上的資料
      const { counts: incoming } = previewImport(raw);
      if (mode === 'replace' && !confirm(
        `取代全部會先清除這台裝置目前的資料（自選 ${info?.watch ?? 0} 檔、交易 ${info?.trades ?? 0} 筆、流程紀錄 ${info?.activity ?? 0} 筆），` +
        `再匯入備份檔的自選 ${incoming.watchlist} 檔、交易 ${incoming.trades} 筆、流程紀錄 ${incoming.activity} 筆。確定要取代嗎？`,
      )) {
        setMsg('已取消匯入，現有資料沒有變更。');
        (e.target as HTMLInputElement).value = '';
        return;
      }
      const counts = await importAll(raw, mode);
      setMsg(`匯入完成：自選 ${counts.watchlist}、交易 ${counts.trades}、選股組合 ${counts.screens}、設定 ${counts.settings}、流程紀錄 ${counts.activity ?? 0}。`);
    } catch (err) {
      setMsg(`匯入失敗：${(err as Error).message}`);
    }
  }

  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageTitle title="備份" sub={info?.last ? `上次備份 ${info.last.slice(0, 10)}` : '尚無備份'} />
      <Section title="匯出" info={<p>使用者資料只存在這台裝置的瀏覽器（IndexedDB），不會上傳；清除 Safari 網站資料或換手機會遺失。匯出檔可存到 iCloud 雲碟或其他裝置。</p>}>
        <List>
          <Row label="自選" value={`${info?.watch ?? 0} 檔`} />
          <Row label="交易" value={`${info?.trades ?? 0} 筆`} />
          <Row label="選股組合" value={`${info?.screens ?? 0} 組`} />
          <Row label="流程紀錄" value={`${info?.activity ?? 0} 筆`} />
        </List>
        <Card><button class="btn primary block" onClick={doExport}>匯出全部資料（JSON）</button></Card>
      </Section>
      <Section title="匯入" info={<p>舊版本的備份檔自動升級格式；比 App 新的版本拒絕匯入。取代全部會先清除這台裝置目前的資料。</p>}>
        <Seg options={[['replace', '取代全部'], ['merge', '合併']] as const} value={mode} onChange={setMode} label="匯入方式" />
        <Card>
          <label class="field">
            <span>選擇備份檔（.json）</span>
            <input class="input" type="file" accept="application/json,.json" onChange={doImport} />
          </label>
        </Card>
      </Section>
      {msg ? <div class="banner info" role="status">{msg}</div> : null}
    </div>
  );
}
