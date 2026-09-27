import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { PAGE_SOURCES } from '../lib/health';

interface Data {
  date: string;
  watch: { code: string; name: string; consecutive: number; in10: number; in30: number; last_date: string; reason: string; risk: boolean; official: boolean }[];
  disposition: { code: string; name: string; start: string; end: string; reason: string | null; measure: string | null; interval_minutes: number | null }[];
  official: { code: string; name: string; situation: string }[];
  rules: { consecutive_days: number; within_10_days: number; within_30_days: number };
}

export default function Disposition() {
  const d = useAsync(() => loadJson<Data>('disposition.json'), []);
  const data = d.data;
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="哪些股票可能被分盤撮合？" title={data ? `處置中 ${data.disposition.length} 檔・可能進入 ${data.watch.filter((w) => w.risk).length} 檔` : '處置風險預警'}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依交易所注意／處置標準簡化；官方名單優先。</p>
      </PageHead>
      <DataStatus date={data?.date} uses={PAGE_SOURCES.disposition} />
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.loading ? <Loading /> : null}
      {data ? (
        <>
          <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>處置中</h2>
          <div class="list">
            {data.disposition.length ? data.disposition.map((r) => (
              <a key={`${r.code}-${r.start}`} class="list-item" href={`#/stock/${r.code}`} style={{ alignItems: 'flex-start' }}>
                <span class="tag risk">處置</span>
                <div class="grow">
                  <div class="small bold">{r.name} <span class="muted">{r.code}</span></div>
                  <div class="tiny muted">{r.start}～{r.end} · {r.measure ?? ''}{r.interval_minutes ? ` · 分盤撮合約每 ${r.interval_minutes} 分鐘` : ''}</div>
                  {r.reason ? <div class="tiny">{r.reason}</div> : null}
                </div>
              </a>
            )) : <div class="list-item small muted">目前沒有處置中的股票。</div>}
          </div>

          <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>官方：注意累計次數可能達處置標準</h2>
          <div class="list">
            {data.official.length ? data.official.map((r) => (
              <a key={r.code} class="list-item" href={`#/stock/${r.code}`}>
                <span class="grow small">{r.name} <span class="muted">{r.code}</span></span>
                <span class="tiny">{r.situation}</span>
              </a>
            )) : <div class="list-item small muted">無。</div>}
          </div>

          <h2 class="section" style={{ marginTop: 'var(--s-8)' }}>注意累計追蹤</h2>
          <p class="caption muted">門檻：連續注意 ≥ {data.rules.consecutive_days} 日、近 10 日 ≥ {data.rules.within_10_days} 次、近 30 日 ≥ {data.rules.within_30_days} 次時標示「可能進入處置」（再一次即達連續 3 日／10 日 6 次／30 日 12 次標準）。</p>
          <div class="card scroll-x">
            <table class="table">
              <thead><tr><th>股票</th><th>連續</th><th>10 日</th><th>30 日</th><th>最近注意</th></tr></thead>
              <tbody>
                {data.watch.slice(0, 100).map((r) => (
                  <tr key={r.code}>
                    <td><a href={`#/stock/${r.code}`}>{r.name}</a>{r.risk ? <span class="tag risk" style={{ marginLeft: 'var(--s-1)' }}>可能進入處置</span> : null}</td>
                    <td>{r.consecutive}</td><td>{r.in10}</td><td>{r.in30}</td><td>{r.last_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
