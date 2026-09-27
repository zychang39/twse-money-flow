import { useMemo } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { scoreText } from '../components/Scores';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';
import { addDays } from '../lib/dates';
import { fmtLots } from '../lib/format';
import type { CalEvent } from './Calendar';
import type { StockRow } from '../data/types';
import { PAGE_SOURCES } from '../lib/health';

export default function Weekly() {
  const summary = useScoredSummary();
  const cal = useAsync(() => loadJson<{ date: string; events: CalEvent[] }>('calendar.json'), []);
  const codes = useDb(async () => [...new Set([...(await listTrades()).filter((t) => t.status === 'open').map((t) => t.code), ...(await listWatch()).map((w) => w.code)])]);
  const rows = useMemo(() => (summary.data && codes ? codes.map((c) => summary.data!.byCode.get(c)).filter((r): r is StockRow => !!r) : []), [summary.data, codes]);
  const date = summary.data?.date;
  const upcoming = cal.data && date ? cal.data.events.filter((e) => e.date > date && e.date <= addDays(date, 10) && (e.code === null || codes?.includes(e.code))) : [];
  const newFlags = rows.flatMap((r) => r.flags.filter((f) => ((r.new_flags_5d as string[] | undefined) ?? []).includes(f.id)).map((f) => ({ r, f })));
  return (
    <div class="page">
      <TopBar back="/discipline" />
      <PageHead eyebrow="這一週我的股票發生了什麼？" title={summary.data ? `本週 ${newFlags.length} 個新風險旗標・下週 ${upcoming.length} 件事件` : '週報'}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>自選與持股：本週分數、籌碼、風險旗標變化與下週事件。</p>
      </PageHead>
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
                <td><Signed value={r.composite_chg_5d as number | null} format={(v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}`)} /></td>
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
