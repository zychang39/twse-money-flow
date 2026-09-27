/** 頭像選單的整頁版（桌機或直接連結時使用）：設定、備份、資料健康、方法說明。 */
import { MenuList, PageHead, TopBar } from '../components/Chrome';

export default function Me() {
  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageHead eyebrow="我的" title="設定與資料" />
      <div style={{ marginTop: 'var(--s-5)' }}><MenuList /></div>
      <p class="caption muted" style={{ marginTop: 'var(--s-6)' }}>所有使用者資料只存在這台裝置，不會上傳。</p>
    </div>
  );
}
