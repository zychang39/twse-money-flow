import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { useAsync, useDb } from '../hooks';
import { loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';

export interface CalEvent { date: string; type: string; code: string | null; name: string | null; text: string }

export function filterEvents(events: CalEvent[], mine: Set<string>, all: boolean): CalEvent[] {
  return events.filter((e) => all || e.code === null || mine.has(e.code));
}

export default function CalendarPage() {
  const cal = useAsync(() => loadJson<{ date: string; events: CalEvent[] }>('calendar.json'), []);
  const mine = useDb(async () => new Set([...(await listWatch()).map((w) => w.code), ...(await listTrades()).filter((t) => t.status === 'open').map((t) => t.code)]));
  const [all, setAll] = useState(false);
  const events = useMemo(() => (cal.data && mine ? filterEvents(cal.data.events, mine, all) : []), [cal.data, mine, all]);
  const byDate = new Map<string, CalEvent[]>();
  events.forEach((e) => byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]));
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="接下來有哪些已知事件？" title={cal.data ? `近期 ${events.length} 件事件` : '行事曆'} />
      <DataStatus date={cal.data?.date} />
      <div class="segmented" role="group" aria-label="範圍" style={{ marginTop: 'var(--s-4)' }}>
        <button aria-pressed={!all} onClick={() => setAll(false)}>自選與持股</button>
        <button aria-pressed={all} onClick={() => setAll(true)}>全部</button>
      </div>
      {cal.error ? <ErrorState error={cal.error} /> : null}
      {cal.loading ? <Loading /> : null}
      {[...byDate.entries()].map(([d, evs]) => (
        <section key={d}>
          <h2 class="section-title">{d}（週{'日一二三四五六'[new Date(`${d}T12:00:00`).getDay()]}）</h2>
          <div class="list">
            {evs.map((e, i) => (
              <div key={i} class="list-item">
                <span class="badge">{e.type}</span>
                <span class="grow caption">{e.code ? <a href={`#/stock/${e.code}`}>{e.name} {e.code}</a> : null} {e.text}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {cal.data && !events.length ? <div class="empty"><p>近期沒有和你的自選或持股相關的事件。</p><button class="btn" onClick={() => setAll(true)}>查看全部事件</button></div> : null}
      <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>月營收公布日以法定期限（每月 10 日）標示；法說會資料來源若未就緒則不顯示。</p>
    </div>
  );
}
