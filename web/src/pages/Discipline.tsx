/**
 * 流程頁（原「紀律」，§8.9）：三環 → 連續 → 近 20 個交易日逐日小點 → 等級卡 → 入口列表。
 * 只獎勵流程，不獎勵損益、交易次數、開啟次數；沒有扣分、不催促。遊戲化關閉時只留三環的文字狀態與入口。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { Card, List, NavRow, PageTitle, Row, Section, Table } from '../components/ui';
import { FlowDots, FlowRings, RingDot, ringsSummary, useRingAnimation } from '../components/Ritual';
import { mdw } from '../components/Brief';
import { IconBars, IconClipboard, IconMedal, IconNotebook, IconPaper, IconPulse } from '../components/Icons';
import { FLOW_PROGRESS_KEY, useFlow, type FlowProgress, type FlowState } from '../data/useFlow';
import { setSetting } from '../db/db';
import { completionRate, hasReview, xpTable } from '../lib/ritual';
import { weeklyFlow } from '../lib/flowStats';
import { uiConfig } from '../lib/config';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** 升級、取得成就：只顯示一列橫幅一次（比對設定 flowProgress，顯示後立即寫回；第一次使用只建立基準、不顯示）。 */
function useProgressBanner(flow: FlowState | null): string | null {
  const [banner, setBanner] = useState<string | null>(null);
  const level = flow?.level.level ?? 0;
  const earned = flow ? flow.badges.filter((b) => b.earned).map((b) => b.id) : [];
  const key = `${level}:${earned.join(',')}`;
  useEffect(() => {
    if (!flow || !flow.gamification) return;
    const prev = flow.progress;
    const next: FlowProgress = { maxLevel: Math.max(level, prev?.maxLevel ?? 1), badges: [...new Set([...(prev?.badges ?? []), ...earned])] };
    if (prev && next.maxLevel === prev.maxLevel && next.badges.length === prev.badges.length) return;
    if (prev) {
      const parts: string[] = [];
      if (level > prev.maxLevel) parts.push(`升到等級 ${level}`);
      const added = flow.badges.filter((b) => b.earned && !prev.badges.includes(b.id));
      if (added.length) parts.push(`取得成就：${added.map((b) => b.label).join('、')}`);
      if (parts.length) setBanner(parts.join('・'));
    }
    setSetting(FLOW_PROGRESS_KEY, next).catch(() => undefined);
  }, [key, !!flow?.gamification]);
  return banner;
}

function XpInfo() {
  const g = uiConfig.gamification;
  return (
    <>
      <p>經驗值只來自下表 7 項，其他行為（交易次數、損益、開啟次數）一律 0；沒有扣分。</p>
      <Table cols={[
        { key: 'l', label: '項目', render: (r) => r.label },
        { key: 'x', label: '經驗值', align: 'r', width: '4.5rem', render: (r) => r.xp },
        { key: 'm', label: '限制', align: 'r', width: '8.5rem', render: (r) => r.limit },
      ]} rows={xpTable()} rowKey={(r) => r.kind} caption="經驗值表" />
      <p>升到等級 n 所需累計經驗值＝{g.level_base} × (2^(n−1) − 1)：等級 2 為 100、3 為 300、4 為 700、5 為 1,500，上限等級 {g.level_max}。等級不會下降，不解鎖或鎖住任何功能。</p>
      <p>依計畫出場：出場原因為停損、時間停損或規則出場，且虧損時實際虧損 ≤ 計畫風險 × {g.loss_tolerance}。改版前的經驗值原樣保留為「既有經驗值」。</p>
    </>
  );
}

function RingsInfo() {
  const g = uiConfig.gamification;
  return (
    <>
      <p>只算交易日（證交所休市日曆）；休市日顯示上一交易日。每個交易日的期限是下一交易日 09:00。</p>
      <ul>
        <li>簡報：當日盤後簡報捲到底。</li>
        <li>進場：當日新增的每一筆持倉都完成檢查表 7 題、有停損價、計畫風險（(進場價 − 停損價) × 股數）≤ 每筆風險上限（本金 × 每筆風險 %）。當日無新持倉＝不適用。</li>
        <li>檢討：沒有平倉後超過 {g.review_due_trading_days} 個交易日仍未檢討的部位，且當日到期的檢討已完成。近 {g.review_due_trading_days} 個交易日無平倉且無逾期＝不適用。</li>
      </ul>
      <p>不適用的環不計入分母，分數為完成數／適用數。連續以交易日計，休市日不計也不中斷；每個日曆月 {g.grace_days_per_month} 個寬限日自動套用在連續中未完成的交易日，不累積到下月，逐日小點畫成空心。</p>
    </>
  );
}

export default function Discipline() {
  const flow = useFlow();
  const banner = useProgressBanner(flow);
  const animate = useRingAnimation(flow && flow.gamification ? `page:${flow.day}:${flow.rings.score}` : null);
  if (!flow) return <div class="page"><TopBar /><PageTitle title="流程" /><Loading /></div>;
  const { rings, streak, level, badges, gamification, isTradingDay, day, user, input } = flow;
  const open = user.trades.filter((t) => t.status === 'open');
  const closed = user.trades.filter((t) => t.status === 'closed');
  const pendingReviews = closed.filter((t) => !hasReview(t)).length;
  const recent = completionRate(streak.days);
  const week = weeklyFlow(input);
  const earned = badges.filter((b) => b.earned).length;
  const action = rings.rings.find((r) => r.status === 'todo' && r.action)?.action;

  return (
    <div class="page flow-page">
      <TopBar />
      <PageTitle title="流程" sub={isTradingDay ? mdw(day) : `休市・顯示 ${mdw(day)}`} />
      {banner ? <div class="ui-sec"><Card testid="flow-banner"><p class="ui-foot" role="status">{banner}</p></Card></div> : null}

      <Section title="三環" info={<RingsInfo />} aside={rings.score} testid="flow-rings">
        <Card label={ringsSummary(rings)}>
          {gamification ? (
            <div class="flow-ring-card">
              <FlowRings rings={rings.rings} animate={animate} />
              <div class="flow-ring-rows">
                {rings.rings.map((r) => <Row key={r.id} icon={<RingDot id={r.id} />} label={r.label} value={r.text} testid={`ring-${r.id}`} />)}
              </div>
            </div>
          ) : (
            <div class="flow-ring-rows">
              {rings.rings.map((r) => <Row key={r.id} label={r.label} value={r.text} testid={`ring-${r.id}`} />)}
            </div>
          )}
        </Card>
        {action ? <List chev><Row label={action.label} href={action.href} testid="flow-action" /></List> : null}
        {gamification ? (
          <Card testid="flow-streak" label={`近 ${streak.days.length} 個交易日流程完成 ${recent.done}／${recent.total}`}>
            <p class="ui-body">{streak.text}</p>
            <FlowDots days={streak.days} />
          </Card>
        ) : null}
      </Section>

      {gamification ? (
        <Section title="等級" info={<XpInfo />} infoTitle="經驗值與等級" testid="flow-level">
          <Card label={`等級 ${level.level}，經驗值 ${fmt(level.xp)}${level.next !== null ? `，下一級 ${fmt(level.next)}` : ''}`}>
            <Row label={`等級 ${level.level}`} strong value={level.next === null ? fmt(level.xp) : `${fmt(level.xp)} / ${fmt(level.next)}`} testid="flow-xp" />
            <div class="flow-bar" aria-hidden="true"><i style={{ transform: `scaleX(${level.progress})` }} /></div>
          </Card>
        </Section>
      ) : null}

      <div class="ui-sec">
        <List chev testid="flow-entries">
          <NavRow icon={<IconNotebook />} title="日誌" sub={`持倉 ${open.length}・已平倉 ${closed.length}${pendingReviews ? `・待檢討 ${pendingReviews}` : ''}`} href="#/discipline/journal" />
          <NavRow icon={<IconClipboard />} title="新增持倉前檢查表" sub="7 題・停損・計畫風險" href="#/discipline/checklist" />
          <NavRow icon={<IconBars />} title="個人統計" sub={recent.total ? `近 ${recent.total} 日完成率 ${pct(recent.rate)}・以 R 計` : '以 R 計・合規與不合規'} href="#/discipline/stats" />
          <NavRow icon={<IconMedal />} title="成就" sub={gamification ? `${earned}/${badges.length}` : '遊戲化已關閉'} href="#/discipline/badges" />
          <NavRow icon={<IconPaper />} title="週報" sub={week.completion.total ? `本週完成率 ${pct(week.completion.rate)}・違規 ${week.total} 次` : `本週違規 ${week.total} 次`} href="#/discipline/weekly" />
          <NavRow icon={<IconPulse />} title="訊號追蹤" sub="新觸發・紙上交易" href="#/discipline/tracking" />
        </List>
      </div>
    </div>
  );
}
