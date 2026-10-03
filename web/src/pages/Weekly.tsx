import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { Card, List, Num, PageTitle, Row, Section, Signed as USigned, Table, Tag } from '../components/ui';
import { useFlow, type FlowState } from '../data/useFlow';
import { weeklyFlow } from '../lib/flowStats';
import { tpeDate, VIOLATION_TAGS, weekOf } from '../lib/ritual';
import { logActivity } from '../db/db';
import { mdw } from '../components/Brief';
import { DataStatus, Loading } from '../components/DataStatus';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';
import { addDays } from '../lib/dates';
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
      <Section title="自選與持股" aside="法人 5 日">
        {rows.length ? (
          <Card>
            <Table cols={[
              { key: 'n', label: '股票', render: (r) => <a href={`#/stock/${r.code}`}>{r.name}</a> },
              { key: 'c', label: '漲跌', align: 'r', width: '5.5rem', render: (r) => <USigned v={r.change_pct} kind="arrow" unit="%" /> },
              { key: 'f', label: '外資（張）', align: 'r', width: '6rem', render: (r) => <USigned v={r.foreign_net_5d} digits={0} /> },
              { key: 't', label: '投信（張）', align: 'r', width: '6rem', render: (r) => <USigned v={r.trust_net_5d} digits={0} /> },
            ]} rows={[...rows].sort((a, b) => Math.abs((b.foreign_net_5d ?? 0) + (b.trust_net_5d ?? 0)) - Math.abs((a.foreign_net_5d ?? 0) + (a.trust_net_5d ?? 0)))} rowKey={(r) => r.code} caption="自選與持股的本週籌碼" />
          </Card>
        ) : <List chev><Row label="無自選或持股" href="#/mine" /></List>}
      </Section>
      <Section title="新風險旗標" aside={newFlags.length ? undefined : '無'}>
        {newFlags.length ? (
          <List tags chev>
            {newFlags.map(({ r, f }) => <Row key={`${r.code}-${f.id}`} label={r.name} sub={f.detail ?? undefined} tag={<Tag tone="risk">{f.label}</Tag>} href={`#/stock/${r.code}`} />)}
          </List>
        ) : null}
      </Section>
      <Section title="下週事件" aside={upcoming.length ? undefined : '無'}>
        {upcoming.length ? (
          <List>
            {upcoming.map((e, i) => <Row key={i} label={`${e.name ?? ''} ${e.text}`.trim()} sub={e.type} value={mdw(e.date)} />)}
          </List>
        ) : null}
      </Section>
    </div>
  );
}
