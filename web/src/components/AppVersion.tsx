/**
 * 目前版本（commit 短碼＋建置時間，到分鐘）、資料產生時間與「檢查更新」（設定頁）。資料健康頁只顯示版本字串。
 */
import { useEffect, useState } from 'preact/hooks';
import { loadMeta } from '../data/api';
import { appVersion, getUpdater, subscribeUpdate, updateState, whenUpdater, type UpdateState } from '../lib/swUpdate';

/** meta.generated_at（ISO，含時區）→「2026-10-08 19:12」（台北時間）。 */
export function dataTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
}

const MSG: Record<string, string> = {
  checking: '檢查中…',
  latest: '已是最新版本',
  available: '有新版本，點上方按鈕更新',
  applying: '更新中，完成後會自動重新載入…',
  error: '暫時無法檢查（可能沒有網路），稍後再試',
  // 2026-10-08：有網路卻檢查失敗（例：背景更新元件沒有裝好）不再說成沒有網路；重新整理就會取得最新版
  failed: '這次沒有檢查成功，重新整理頁面即可取得最新版本',
  unsupported: '這個瀏覽器不支援自動更新；重新開啟網頁即可取得最新版本',
};

export function AppVersion({ withCheck = false }: { withCheck?: boolean }) {
  const [state, setState] = useState<UpdateState>(updateState());
  const [msg, setMsg] = useState('');
  const [data, setData] = useState<string | null>(null);
  useEffect(() => subscribeUpdate(setState), []);
  useEffect(() => { loadMeta().then((m) => setData(dataTime(m.generated_at))).catch(() => undefined); }, []);
  async function check() {
    setMsg(MSG.checking);
    const u = await whenUpdater();
    if (!u) { setMsg(MSG.unsupported); return; }
    const r = await u.check();
    setMsg(r === 'error' && navigator.onLine !== false ? MSG.failed : MSG[r]);
  }
  return (
    <div data-testid="app-version">
      <div class="row between"><span>目前版本</span><span class="num mono" data-testid="app-version-string">{appVersion()}</span></div>
      {data ? <div class="row between"><span>資料產生</span><span class="num mono" data-testid="app-data-time">{data}</span></div> : null}
      {withCheck ? (
        <>
          <button class="btn small" style={{ marginTop: 'var(--s-2)' }} disabled={state === 'applying'}
            onClick={() => (state === 'available' ? getUpdater()?.apply() : check())}>
            {state === 'available' ? '立即更新' : '檢查更新'}
          </button>
          {msg ? <p class="caption muted" role="status" style={{ marginTop: 'var(--s-2)' }}>{state === 'applying' ? MSG.applying : msg}</p> : null}
        </>
      ) : null}
    </div>
  );
}
