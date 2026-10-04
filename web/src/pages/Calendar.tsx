import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Button, EmptyRow, List, PageTitle, Row, Section, Seg, Tag } from '../components/ui';
import { useAsync, useDb, useRestoredState } from '../hooks';
import { loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';
import { Term } from '../components/kit';

const CAL_INFO = (
  <>
    <p>除權息、減資、月營收公布期限、法說會、融券最後回補日、休市日；資料來源：證交所、櫃買中心、公開資訊觀測站。</p>
    <p>月營收公布日以法定期限（每月 10 日）標示；法說會資料未就緒時不顯示。「自選與持股」只列自選股與未平倉持股的事件與全市場事件（休市）。</p>
  </>
);

export interface CalEvent { date: string; type: string; code: string | null; name: string | null; text: string }

/** 事件副資訊一行：過長的說明（法說會內容等）只留第一個子句（最多 22 字）；完整內容在個股頁事件。 */
export function eventSub(text: string, max = 22): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).search(/[，。；、（(]/);
  return cut > 4 ? t.slice(0, cut) : t.slice(0, max);
}

export function filterEvents(events: CalEvent[], mine: Set<string>, all: boolean): CalEvent[] {
  return events.filter((e) => all || e.code === null || mine.has(e.code));
}

export default function CalendarPage() {
  const cal = useAsync(() => loadJson<{ date: string; events: CalEvent[] }>('calendar.json'), []);
  const mine = useDb(async () => new Set([...(await listWatch()).map((w) => w.code), ...(await listTrades()).filter((t) => t.status === 'open').map((t) => t.code)]));
  const [all, setAll] = useRestoredState('calendar.all', false);
  const events = useMemo(() => (cal.data && mine ? filterEvents(cal.data.events, mine, all) : []), [cal.data, mine, all]);
  const byDate = new Map<string, CalEvent[]>();
  events.forEach((e) => byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]));
  const WD = '日一二三四五六';
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="行事曆" sub={cal.data ? `近期 ${events.length} 件` : undefined} />
      <Seg options={[['mine', '自選與持股'], ['all', '全部']] as const} value={all ? 'all' : 'mine'} onChange={(v) => setAll(v === 'all')} label="範圍" />
      {cal.error ? <ErrorState error={cal.error} /> : null}
      {cal.loading ? <Loading /> : null}
      {[...byDate.entries()].map(([d, evs], i) => (
        <Section key={d} title={`${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(`${d}T12:00:00`).getDay()]}）`}
          info={i === 0 ? CAL_INFO : undefined}>
          <List tags>
            {evs.map((e, j) => (
              <Row key={j} label={e.code ? <>{e.name} <span class="ui-muted">{e.code}</span></> : e.text} sub={e.code ? eventSub(e.text) : undefined}
                tag={<Tag>{e.type}</Tag>} href={e.code ? `#/stock/${e.code}` : undefined} noChev />
            ))}
          </List>
        </Section>
      ))}
      {cal.data && !events.length ? (
        <Section title="事件" info={CAL_INFO}>
          <p class="interp"><Term id="exright">除權息</Term>・營收公布・法說會；只列自選與持股</p>
          <List>
            <EmptyRow>自選與持股近期無事件</EmptyRow>
          </List>
          <Button block onClick={() => setAll(true)}>全部事件</Button>
        </Section>
      ) : null}
    </div>
  );
}
