import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { List, Num, PageTitle, Row, Section } from '../components/ui';
import { useFlow, type FlowState } from '../data/useFlow';
import { weeklyFlow } from '../lib/flowStats';
import { tpeDate, VIOLATION_TAGS, weekOf } from '../lib/ritual';
import { logActivity } from '../db/db';
import { mdw } from '../components/Brief';
import { DataStatus, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { scoreText } from '../components/Scores';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';
import { addDays } from '../lib/dates';
import { fmtLots, fmtNum, MINUS, orMissing } from '../lib/format';
import type { CalEvent } from './Calendar';
import type { StockRow } from '../data/types';
import { PAGE_SOURCES } from '../lib/health';

/** 本週流程：完成率、違規標籤次數、完成週檢討（每週一次，經驗值 30） */
function WeekFlow({ flow, day }: { flow: FlowState; day: string }) {
  const w = weeklyFlow(flow.input);
  const thisWeek = weekOf(tpeDate(flow.input.now));
  const done = flow.input.activities.some((a) => a.type === 'weekly_review' && weekOf(tpeDate(a.at)) === thisWeek);
  const tags = VIOLATION_TAGS.filter((t) => w.counts[t] > 0);
  return (
    <Section title="本週流程" aside={`${mdw(w.week)} 起`} testid="weekly-flow" info={<>
      <p>流程完成率＝本週已結算的交易日中三環全部完成的日數；寬限日算未完成，期限未到的當日不計入。</p>
      <p>違規標籤依發生日歸週：未檢查、無停損、超過風險上限＝進場日；虧損超出計畫＝平倉日；逾期檢討＝檢討到期日。只記錄、不扣分。</p>
    </>}>
      <List>
        <Row label="流程完成率" value={<Num v={w.completion.rate === null ? null : `${w.completion.done}/${w.completion.total}（${Math.round(w.completion.rate * 100)}%）`} />} testid="weekly-completion" />
        <Row label="違規標籤" sub={tags.length ? tags.map((t) => `${t} ${w.counts[t]}`).join('・') : undefined} value={<Num v={w.total} unit="次" />} testid="weekly-violations" />
      </List>
      {done ? (
        <List><Row label="週檢討" value="已完成" testid="weekly-review-done" /></List>
      ) : (
        <List chev><Row label="完成週檢討" onClick={() => { void logActivity('weekly_review', day || tpeDate(flow.input.now)); }} testid="weekly-review" /></List>
      )}
    </Section>
  );
}

export default function Weekly() {
  const summary = useScoredSummary();
  const cal = useAsync(() => loadJson<{ date: string; events: CalEvent[] }>('calendar.json'), []);
  const codes = useDb(async () => [...new Set([...(await listTrades()).filter((t) => t.status === 'open').map((t) => t.code), ...(await listWatch()).map((w) => w.code)])]);
  const rows = useMemo(() => (summary.data && codes ? codes.map((c) => summary.data!.byCode.get(c)).filter((r): r is StockRow => !!r) : []), [summary.data, codes]);
  const date = summary.data?.date;
  const upcoming = cal.data && date ? cal.data.events.filter((e) => e.date > date && e.date <= addDays(date, 10) && (e.code === null || codes?.includes(e.code))) : [];
  const newFlags = rows.flatMap((r) => r.flags.filter((f) => ((r.new_flags_5d as string[] | undefined) ?? []).includes(f.id)).map((f) => ({ r, f })));
  const flow = useFlow();
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageTitle title="週報" sub={summary.data ? `新風險旗標 ${newFlags.length}・下週事件 ${upcoming.length}` : undefined} />
      {flow ? <WeekFlow flow={flow} day={date ?? ''} /> : null}
      <DataStatus date={date} uses={PAGE_SOURCES.weekly} />
      {summary.loading ? <Loading /> : null}
      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>本週分數與籌碼</h2>
      <div class="scroll-x">
        <table class="table">
          <thead><tr><th>股票</th><th>收盤</th><th>綜合分</th><th>週變化</th><th>外資 5 日</th><th>投信 5 日</th></tr></thead>
          <tbody>
            {[...rows].sort((a, b) => Math.abs((b.composite_chg_5d as number) ?? 0) - Math.abs((a.composite_chg_5d as number) ?? 0)).map((r) => (
              <tr key={r.code}>
                <td><a href={`#/stock/${r.code}`}>{r.name}</a></td>
                <td><Change change={r.change} showPrice={r.close} /></td>
                <td>{scoreText(r.composite as number | null)}</td>
                <td><Signed value={r.composite_chg_5d as number | null} format={(v) => orMissing(v, (x) => `${x > 0 ? '+' : x < 0 ? MINUS : ''}${fmtNum(Math.abs(x), 0)} 分`, '沒有 5 日前的分數')} /></td>
                <td><Signed value={r.foreign_net_5d} format={fmtLots} /></td>
                <td><Signed value={r.trust_net_5d} format={fmtLots} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <div class="empty"><p>尚未加入自選或持股。</p><a class="btn primary" href="#/mine">加入自選股</a></div> : null}
      </div>
      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>本週新出現的風險旗標</h2>
      <div class="list">
        {newFlags.length ? newFlags.map(({ r, f }) => (
          <a key={`${r.code}-${f.id}`} class="list-item" href={`#/stock/${r.code}`}>
            <span class="tag risk">{f.label}</span>
            <span class="grow caption">{r.name}</span>
            <span class="caption muted">{f.detail ?? ''}</span>
          </a>
        )) : <div class="list-item caption muted">本週沒有新的風險旗標。</div>}
      </div>
      <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>下週事件</h2>
      <div class="list">
        {upcoming.length ? upcoming.map((e, i) => (
          <div key={i} class="list-item"><span class="caption muted">{e.date.slice(5)}</span><span class="badge">{e.type}</span><span class="grow caption">{e.name ?? ''} {e.text}</span></div>
        )) : <div class="list-item caption muted">無。</div>}
      </div>
    </div>
  );
}
