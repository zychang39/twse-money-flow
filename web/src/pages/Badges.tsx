/** 成就：原創線條徽章。只獎勵紀律（儀式、檢討、守住停損、檢查表、回測自己的條件、備份）。 */
import { PageHead, TopBar } from '../components/Chrome';
import { EmptyState, Loading } from '../components/DataStatus';
import { BADGE_ICONS, IconMedal } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadIndex } from '../data/api';
import { useUser } from '../data/useUser';
import { badgeMetrics, badges, streaks } from '../lib/ritual';

export default function Badges() {
  const user = useUser();
  const index = useAsync(loadIndex, []);
  if (!user) return <div class="page"><TopBar back="/discipline" /><Loading /></div>;
  if (!user.gamification) {
    return (
      <div class="page">
        <TopBar back="/discipline" />
        <PageHead eyebrow="成就" title="遊戲化已關閉" />
        <EmptyState icon={<IconMedal />} title="徽章已隱藏" text="你的紀律紀錄仍會保存，重新開啟後會立即顯示。" action={<a class="btn primary" href="#/me/settings">前往設定</a>} />
      </div>
    );
  }
  const st = streaks(index.data?.dates ?? [], user.activity);
  const bs = badges(badgeMetrics(user.activity, user.trades, st.best, !!user.lastBackupAt));
  const earned = bs.filter((b) => b.earned).length;
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageHead eyebrow="成就" title={`已獲得 ${earned} / ${bs.length} 個徽章`}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>只獎勵紀律行為；不因下單次數、交易頻率或獲利給予任何徽章。</p>
      </PageHead>
      <div class="badges" style={{ marginTop: 'var(--s-6)' }}>
        {bs.map((b) => {
          const Icon = BADGE_ICONS[b.id] ?? IconMedal;
          return (
            <div key={b.id} class={`badge-card ${b.earned ? 'earned' : ''}`} role="group" aria-label={`${b.label}：${b.earned ? '已獲得' : `進度 ${Math.min(b.value, b.target)} / ${b.target}`}。${b.description}`}>
              <Icon />
              <div class="caption t1 w6">{b.label}</div>
              <div class="caption muted">{b.earned ? '已獲得' : `${Math.min(b.value, b.target)} / ${b.target}`}</div>
              {!b.earned ? <div class="xp-bar" style={{ marginTop: 'var(--s-2)' }}><i style={{ width: '100%', transform: `scaleX(${b.progress})` }} /></div> : null}
            </div>
          );
        })}
      </div>
      <div class="list" style={{ marginTop: 'var(--s-6)' }}>
        {bs.map((b) => <div key={b.id} class="list-item" style={{ alignItems: 'flex-start' }}><span class="grow"><span class="body">{b.label}</span><span class="caption muted" style={{ display: 'block' }}>{b.description}</span></span></div>)}
      </div>
    </div>
  );
}
