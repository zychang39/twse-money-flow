/**
 * 目前版本（commit 短碼＋建置日期）與「檢查更新」（設定頁）。資料健康頁只顯示版本字串。
 */
import { useEffect, useState } from 'preact/hooks';
import { appVersion, getUpdater, subscribeUpdate, updateState, whenUpdater, type UpdateState } from '../lib/swUpdate';

const MSG: Record<string, string> = {
  checking: '檢查中…',
  latest: '已是最新版本',
  available: '有新版本，點上方按鈕更新',
  applying: '更新中，完成後會自動重新載入…',
  error: '暫時無法檢查（可能沒有網路），稍後再試',
  unsupported: '這個瀏覽器不支援自動更新；重新開啟網頁即可取得最新版本',
};

export function AppVersion({ withCheck = false }: { withCheck?: boolean }) {
  const [state, setState] = useState<UpdateState>(updateState());
  const [msg, setMsg] = useState('');
  useEffect(() => subscribeUpdate(setState), []);
  async function check() {
    setMsg(MSG.checking);
    const u = await whenUpdater();
    if (!u) { setMsg(MSG.unsupported); return; }
    const r = await u.check();
    setMsg(MSG[r]);
  }
  return (
    <div data-testid="app-version">
      <div class="row between"><span>目前版本</span><span class="num mono" data-testid="app-version-string">{appVersion()}</span></div>
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
