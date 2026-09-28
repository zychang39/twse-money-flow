/**
 * 紀律：回答「我該記錄或檢討什麼？」。三環、紀律等級、連續天數，以及日誌、新增持倉前檢查表、個人統計、成就、週報。
 * 只獎勵紀律行為；不因交易次數、頻率或獲利給予任何獎勵或慶祝。
 */
import type { ComponentChildren } from 'preact';
import { PageHead, TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { RitualPanel } from '../components/Ritual';
import { IconBars, IconClipboard, IconMedal, IconNotebook, IconPaper } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadIndex, loadSummary } from '../data/api';
import { useUser } from '../data/useUser';
import { badgeMetrics, badges, hasReview, levelFor, ritualRings, streaks, totalXp } from '../lib/ritual';
import { todayTpe } from '../lib/dates';
import { glueNumbers } from '../lib/format';

/** U-06：數字與單位不斷開（不換行空白），只在「・」後換行（零寬空格）；搭配 CSS word-break: keep-all */
const tileText = (s: string) => glueNumbers(s).replace(/・/g, '・\u200b');

function Tile({ href, icon, label, status }: { href: string; icon: ComponentChildren; label: string; status?: ComponentChildren }) {
  return (
    <a class="tile" href={href}>
      <span class="ico">{icon}</span>
      <span><span class="body w6" style={{ display: 'block' }}>{label}</span><span class="caption muted tile-status">{typeof status === 'string' ? tileText(status) : status}</span></span>
    </a>
  );
}

export default function Discipline() {
  const user = useUser();
  const summary = useAsync(loadSummary, []);
  const index = useAsync(loadIndex, []);
  const day = summary.data?.date ?? null;
  if (!user || !day) return <div class="page"><TopBar caption="紀律" /><PageHead eyebrow="我該記錄或檢討什麼？" title="紀律" /><Loading /></div>;
  const r = ritualRings(day, user.activity, user.trades, todayTpe());
  const st = streaks(index.data?.dates ?? [], user.activity);
  const xp = totalXp(user.activity);
  const lv = levelFor(xp);
  const bs = badges(badgeMetrics(user.activity, user.trades, st.best, !!user.lastBackupAt));
  const open = user.trades.filter((t) => t.status === 'open');
  const closed = user.trades.filter((t) => t.status === 'closed');
  const pending = closed.filter((t) => !hasReview(t)).length;
  const missing = r.rings.filter((x) => !x.done);
  return (
    <div class="page">
      <TopBar caption="紀律" />
      <PageHead twoLine eyebrow="我該記錄或檢討什麼？" title={r.complete ? '今晚的紀律已完成。' : <>今晚還差 {missing.length} 項：<br />{missing.map((x) => x.label).join('、')}</>} />
      <div style={{ marginTop: 'var(--s-6)' }}>
        <RitualPanel rings={r.rings} complete={r.complete} gamification={user.gamification} />
      </div>
      {user.gamification ? (
        <div class="card" style={{ marginTop: 'var(--s-6)' }} aria-label={`紀律等級 ${lv.level}，經驗值 ${xp}，距離下一級 ${lv.next - xp}`} role="group">
          <div class="row between"><span class="body w6">紀律等級 {lv.level}</span><span class="caption muted">{xp} / {lv.next} XP</span></div>
          <div class="xp-bar" style={{ marginTop: 'var(--s-2)' }}><i style={{ width: '100%', transform: `scaleX(${lv.progress})` }} /></div>
          <p class="caption muted" style={{ marginTop: 'var(--s-2)' }}>連續 {st.current} 天完成儀式（最佳 {st.best} 天）・休市日不中斷。經驗值只來自看完簡報、完成檢查表、寫檢討、備份與回測自己的條件。</p>
        </div>
      ) : <p class="caption muted" style={{ marginTop: 'var(--s-4)' }}>遊戲化已關閉（等級、徽章與完成動畫已隱藏）。可在設定重新開啟。</p>}
      <div class="tile-grid" style={{ marginTop: 'var(--s-6)' }}>
        <Tile href="#/discipline/journal" icon={<IconNotebook />} label="日誌" status={`持倉 ${open.length}・已平倉 ${closed.length}${pending ? `・待檢討 ${pending}` : ''}`} />
        <Tile href="#/discipline/checklist" icon={<IconClipboard />} label="新增持倉前檢查表" status="新增持倉前的 7 個問題" />
        <Tile href="#/discipline/stats" icon={<IconBars />} label="個人統計" status="勝率、期望值、錯誤標籤、組合" />
        <Tile href="#/discipline/badges" icon={<IconMedal />} label="成就" status={user.gamification ? `${bs.filter((b) => b.earned).length} / ${bs.length} 個徽章` : '遊戲化已關閉'} />
        <Tile href="#/discipline/weekly" icon={<IconPaper />} label="週報" status="本週分數、籌碼、旗標與下週事件" />
      </div>
    </div>
  );
}
