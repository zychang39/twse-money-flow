/**
 * 流程頁（M6，2026-10）：大標題「今日流程」＋「已完成 n/m」→ 一個進度環（旁邊連續、等級、經驗值；下方近 20 個交易日小點）→
 * 新手導覽（一次性任務，完成後收合）→ 每日步驟 1–6 → 每週步驟 → 名詞圖鑑「已讀 n／N」→ 工具列表。
 * 步驟完成由系統自動判定（lib/ritual.ts daySteps），下一步高亮。只獎勵流程，不獎勵損益、交易次數；沒有扣分、不催促。
 * 遊戲化關閉時不畫環、不顯示連續與經驗值，只留文字狀態。
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { TopBar } from '../components/Chrome';
import { Loading } from '../components/DataStatus';
import { Card, List, NavRow, PageTitle, Row, Section, Table } from '../components/ui';
import { Conclusion, Interp, RollNum, Term, reduceMotion } from '../components/kit';
import { FlowDots, useRingAnimation } from '../components/Ritual';
import { mdw } from '../components/Brief';
import { IconBars, IconBooks, IconClipboard, IconMedal, IconNotebook, IconPaper, IconPulse } from '../components/Icons';
import { FLOW_PROGRESS_KEY, useFlow, type FlowProgress, type FlowState } from '../data/useFlow';
import { setSetting } from '../db/db';
import { completionRate, hasReview, weekOf, xpTable, type Step } from '../lib/ritual';
import { markOnboard } from '../lib/flowTrack';
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
      <p>經驗值只來自下表各項，其他行為（交易次數、損益、開啟次數）一律 0；沒有扣分。</p>
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

function StepsInfo() {
  const g = uiConfig.gamification;
  return (
    <>
      <p>只算交易日（證交所休市日曆）；休市日顯示上一交易日並標日期，不計也不中斷連續。每個交易日的期限是下一交易日 09:00。</p>
      <ul>
        <li>1 看大盤：簡報的市場分段看到底。</li>
        <li>2 看持倉：開過持股清單。當日沒有持倉＝不適用。</li>
        <li>3 看自選異動：異動清單上的每一檔都開過；沒有異動＝開過清單即可。沒有自選股＝不適用。</li>
        <li>4 看新觸發：開過選股頁（選做，不影響當日完成）。</li>
        <li>5 進場前檢查：當日每一筆新持倉都完成檢查表、有停損價、計畫風險 ≤ 每筆風險上限。沒有新持倉＝不適用。</li>
        <li>6 平倉後檢討：沒有平倉後超過 {g.review_due_trading_days} 個交易日仍未檢討的部位。沒有待檢討＝不適用。</li>
      </ul>
      <p>當日完成＝1、2、3、5、6 中適用的步驟全部完成。連續以交易日計；每個日曆月 {g.grace_days_per_month} 個寬限日自動套用在連續中未完成的交易日，不累積到下月。</p>
    </>
  );
}

/** 進度環：完成數／適用數（直徑 96）；完成一步時前進（只用 transform 與 stroke-dashoffset） */
function ProgressRing({ done, total, label }: { done: number; total: number; label: string }) {
  const size = 96, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = total ? done / total : 0;
  const [on, setOn] = useState(reduceMotion());
  useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <span class="flow-pring" role="img" aria-label={label} data-testid="flow-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" stroke-width={stroke} />
        <circle class="flow-pring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-1)" stroke-width={stroke} stroke-linecap="round"
          stroke-dasharray={`${c} ${c}`} style={{ strokeDashoffset: on ? c * (1 - v) : c }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span class="flow-pring-t" data-audit-skip="">{done}<span class="ui-muted">/{total}</span></span>
    </span>
  );
}

/** 步驟編號圓點（完成時畫勾）：整個是 SVG，與列首圖示同一種對齊 */
function StepBadge({ done, n }: { done: boolean; n: string }) {
  return (
    <svg class="flow-step-n" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx={12} cy={12} r={12} />
      {done ? <path class="ck" d="M7 12.5l3.2 3.2L17 9" /> : <text x={12} y={16.2} text-anchor="middle">{n}</text>}
    </svg>
  );
}

const STATUS_TEXT: Record<Step['status'], string> = { done: '已完成', todo: '待辦', na: '今日不適用' };

function StepCard({ s, next }: { s: Step; next: boolean }) {
  const href = s.action?.href ?? s.href;
  return (
    <a class={`flow-step ${s.status} ${next ? 'next' : ''}`} href={href} data-testid={`step-${s.id}`} aria-current={next ? 'step' : undefined}>
      <span class="flow-step-body">
        <span class="flow-step-t"><StepBadge done={s.status === 'done'} n={String(s.n)} />{s.title}{s.optional ? <span class="ui-foot ui-muted">（選做）</span> : null}</span>
        <span class="flow-step-w">{s.what}</span>
        <span class={`flow-step-s ui-foot ${s.status === 'done' ? '' : 'ui-muted'}`}>{STATUS_TEXT[s.status]}{s.note && s.note !== '選做' ? `：${s.note}` : ''}</span>
      </span>
      {s.status !== 'na' ? <span class="flow-step-go">{s.status === 'done' ? '查看' : '前往'}</span> : null}
    </a>
  );
}

function Onboarding({ flow }: { flow: FlowState }) {
  const tasks = flow.onboarding;
  const left = tasks.filter((t) => !t.done).length;
  const [open, setOpen] = useState(false);
  // 由既有資料推得的完成（自選、名詞、本金、備份）：補記一次，經驗值從補記時起算
  useEffect(() => { for (const t of tasks) if (t.done && !t.logged) markOnboard(t.id); }, [tasks.map((t) => `${t.id}:${t.done}:${t.logged}`).join()]);
  // 未完成的先列、只列前 3 項（其餘展開）；頁面長度不超過約 3 個螢幕
  const ordered = [...tasks.filter((t) => !t.done), ...tasks.filter((t) => t.done)];
  const shown = open ? ordered : ordered.filter((t) => !t.done).slice(0, 3);
  const list = (
    <List testid="onboard-list">
      {shown.map((t) => (
        <Row key={t.id} label={t.title} sub={t.how} href={t.done ? undefined : t.href} testid={`onboard-${t.id}`}
          value={t.done ? '已完成' : <span class="ui-foot">前往</span>} />
      ))}
    </List>
  );
  return (
    <Section title="新手導覽" aside={`${tasks.length - left}/${tasks.length}`} testid="flow-onboard"
      info={<p>一次性任務，每項 {uiConfig.gamification.xp.onboard} 經驗值、各領一次；完成由系統自動判定。全部完成後收合。</p>}>
      {left ? (
        <>
          <Conclusion>還有 {left} 項</Conclusion>
          {list}
          {tasks.length > 3 ? <List chev><Row label={open ? '收合' : `全部 ${tasks.length} 項`} onClick={() => setOpen(!open)} testid="onboard-more" /></List> : null}
        </>
      ) : (
        <>
          <List chev><Row label={open ? '收合' : '新手導覽已完成'} value={open ? undefined : `${tasks.length}/${tasks.length}`} onClick={() => setOpen(!open)} testid="onboard-fold" /></List>
          {open ? list : null}
        </>
      )}
    </Section>
  );
}

function Hero({ flow, children }: { flow: FlowState; children?: ComponentChildren }) {
  const { steps, streak, level, gamification } = flow;
  return (
    <Card testid="flow-hero">
      <div class="flow-hero">
        <ProgressRing done={steps.done} total={steps.applicable} label={`今日流程 ${steps.score}`} />
        {gamification ? (
          <div class="flow-hero-stats">
            <span class="flow-stat"><span class="ui-foot ui-muted"><Term id="streak_days">連續</Term></span><span class="flow-stat-v">{streak.current}<span class="ui-unit">日</span></span></span>
            <span class="flow-stat"><span class="ui-foot ui-muted"><Term id="xp">等級</Term></span><span class="flow-stat-v">{level.level}</span></span>
            <span class="flow-stat"><span class="ui-foot ui-muted"><Term id="xp">經驗值</Term></span><span class="flow-stat-v" data-testid="flow-xp">
              <RollNum value={level.xp} format={fmt} label="經驗值" />{level.next !== null ? <span class="ui-foot ui-muted"> / {fmt(level.next)}</span> : null}</span></span>
          </div>
        ) : <p class="ui-body">{steps.complete ? '今日已完成' : `已完成 ${steps.score}`}</p>}
      </div>
      {gamification ? <div class="flow-bar" aria-hidden="true"><i style={{ transform: `scaleX(${level.progress})` }} /></div> : null}
      {children}
    </Card>
  );
}

export default function Discipline() {
  const flow = useFlow();
  const banner = useProgressBanner(flow);
  useRingAnimation(flow && flow.gamification ? `page:${flow.day}:${flow.steps.score}` : null);
  if (!flow) return <div class="page"><TopBar /><PageTitle title="今日流程" /><Loading /></div>;
  const { steps, streak, badges, gamification, isTradingDay, day, user, input } = flow;
  const open = user.trades.filter((t) => t.status === 'open');
  const closed = user.trades.filter((t) => t.status === 'closed');
  const pendingReviews = closed.filter((t) => !hasReview(t)).length;
  const recent = completionRate(streak.days);
  const week = weeklyFlow(input);
  const earned = badges.filter((b) => b.earned).length;
  const next = steps.steps.find((x) => x.status === 'todo' && !x.optional) ?? null;
  const weekDone = user.activity.some((a) => a.type === 'weekly_review' && weekOf(a.day) === weekOf(day));
  return (
    <div class="page flow-page">
      <TopBar />
      <PageTitle title="今日流程" sub={<>已完成 {steps.score}・{isTradingDay ? mdw(day) : `休市・顯示上一交易日 ${mdw(day)}`}</>} />
      {banner ? <div class="ui-sec"><Card testid="flow-banner"><p class="ui-foot" role="status">{banner}</p></Card></div> : null}

      <Section title="進度" info={gamification ? <XpInfo /> : undefined} infoTitle="經驗值與等級" testid="flow-progress">
        <Hero flow={flow}>
          {gamification ? (
            <div data-testid="flow-streak">
              <FlowDots days={streak.days} />
              <p class="ui-foot ui-muted flow-streak-t">{streak.text}・近 {streak.days.length} 日完成 {recent.done}／{recent.total}</p>
            </div>
          ) : null}
        </Hero>
      </Section>

      <Onboarding flow={flow} />

      <Section title="每日步驟" aside={steps.score} info={<StepsInfo />} testid="flow-steps">
        <Conclusion testid="flow-next">{steps.complete ? '今日已完成' : next ? `下一步：${next.n} ${next.title}` : '今日已完成'}</Conclusion>
        <div class="flow-steps">
          {steps.steps.map((x) => <StepCard key={x.id} s={x} next={!!next && x.id === next.id} />)}
        </div>
        <Interp>{isTradingDay ? <>5、6 依<Term id="checklist">檢查表</Term>與<Term id="compliant_trade">合規交易</Term>自動判定</> : '今天休市：不計也不中斷連續'}</Interp>
      </Section>

      <Section title="每週步驟" testid="flow-weekly">
        <div class="flow-steps">
          <a class={`flow-step ${weekDone ? 'done' : 'todo'}`} href="#/discipline/weekly" data-testid="step-weekly">
            <span class="flow-step-body">
              <span class="flow-step-t"><StepBadge done={weekDone} n="W" />週檢討</span>
              <span class="flow-step-w">看本週完成率與違規標籤，在週報頁按「完成週檢討」</span>
              <span class={`flow-step-s ui-foot ${weekDone ? '' : 'ui-muted'}`}>{weekDone ? '本週已完成' : '待辦'}</span>
            </span>
            <span class="flow-step-go">{weekDone ? '查看' : '前往'}</span>
          </a>
        </div>
      </Section>

      <div class="ui-sec">
        <List chev testid="flow-glossary">
          <NavRow icon={<IconBooks />} title="名詞圖鑑" sub={`已讀 ${flow.terms.read}／${flow.terms.total}`} href="#/me/glossary" />
        </List>
      </div>

      <Section title="工具" testid="flow-entries">
        <List chev>
          <NavRow icon={<IconNotebook />} title="日誌" sub={`持倉 ${open.length}・已平倉 ${closed.length}${pendingReviews ? `・待檢討 ${pendingReviews}` : ''}`} href="#/discipline/journal" />
          <NavRow icon={<IconClipboard />} title="新增持倉前檢查表" sub="7 題・停損・計畫風險" href="#/discipline/checklist" />
          <NavRow icon={<IconBars />} title="個人統計" sub={recent.total ? `近 ${recent.total} 日完成率 ${pct(recent.rate)}・以 R 計` : '以 R 計・合規與不合規'} href="#/discipline/stats" />
          <NavRow icon={<IconMedal />} title="成就" sub={gamification ? `${earned}/${badges.length}` : '遊戲化已關閉'} href="#/discipline/badges" />
          <NavRow icon={<IconPaper />} title="週報" sub={week.completion.total ? `本週完成率 ${pct(week.completion.rate)}・違規 ${week.total} 次` : `本週違規 ${week.total} 次`} href="#/discipline/weekly" />
          <NavRow icon={<IconPulse />} title="訊號追蹤" sub="新觸發・紙上交易" href="#/discipline/tracking" />
        </List>
      </Section>
    </div>
  );
}
