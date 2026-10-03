/** 頭像選單的整頁版（桌機或直接連結時使用）：設定、備份、資料健康、方法說明。 */
import { MenuList, TopBar } from '../components/Chrome';
import { PageTitle, Section } from '../components/ui';

export default function Me() {
  return (
    <div class="page">
      <TopBar back="/" avatar={false} />
      <PageTitle title="設定與資料" sub="使用者資料只存在這台裝置，不會上傳" />
      <Section title="選單"><MenuList /></Section>
    </div>
  );
}
