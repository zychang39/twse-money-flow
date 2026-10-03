/** 成就（§8.7）：8 個，只看流程（合規、連續、依計畫停損、檢討、風險上限）。每個顯示條件與進度 n/N；未取得用次文字色，不遮住條件。 */
import { TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { BADGE_ICONS, IconMedal } from '../components/Icons';
import { Button, Card, EmptyRow, List, PageTitle, Row, Section } from '../components/ui';
import { useFlow } from '../data/useFlow';
import { LEGACY_BADGE_MAP } from '../lib/achievements';
import '../styles/flow.css';

export default function Badges() {
  const flow = useFlow();
  if (!flow) return <div class="page"><TopBar back="/discipline" /><PageTitle title="成就" /><Loading /></div>;
  if (!flow.gamification) {
    return (
      <div class="page">
        <TopBar back="/discipline" />
        <PageTitle title="成就" sub="遊戲化已關閉" />
        <div class="ui-sec">
          <Card><EmptyRow>流程紀錄仍保存在本機；重新開啟後立即顯示。</EmptyRow><Button block href="#/me/settings">前往設定</Button></Card>
        </div>
      </div>
    );
  }
  const bs = flow.badges;
  const earned = bs.filter((b) => b.earned).length;
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageTitle title="成就" sub={`已取得 ${earned}/${bs.length}`} />
      <Section title="全部成就" testid="badges" info={<>
        <p>只看流程：合規交易、連續交易日、依計畫停損、檢討、風險上限。不看損益、交易次數或開啟次數。</p>
        <ul>{bs.map((b) => <li key={b.id}>{b.label}：{b.description}</li>)}</ul>
        <p>改版前已取得的成就保留，對應到最接近的一項（{Object.keys(LEGACY_BADGE_MAP).length} 項舊成就對應到連續、檢討、依計畫停損與第一筆合規交易）。</p>
      </>}>
        <List>
          {bs.map((b) => {
            const Icon = BADGE_ICONS[b.id] ?? IconMedal;
            return (
              <Row key={b.id} testid={`badge-${b.id}`}
                icon={<span class={`flow-badge-ico ${b.earned ? 'earned' : ''}`}><Icon /></span>}
                label={<span class={b.earned ? '' : 'ui-muted'}>{b.label}</span>}
                sub={b.retained ? '由舊成就保留' : b.short ?? b.description}
                value={<span class={b.earned ? '' : 'ui-muted'}>{b.progressText}</span>}
                ariaLabel={`${b.label}：${b.earned ? '已取得' : `進度 ${b.progressText}`}。${b.description}`} />
            );
          })}
        </List>
      </Section>
    </div>
  );
}
