import { useMemo } from 'preact/hooks';
import { Nav } from '../components/Nav';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Change, Signed } from '../components/Change';
import { Flags } from '../components/Flags';
import { scoreText } from '../components/Scores';
import { useAsync, useDb } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadAiSummary, loadJson } from '../data/api';
import { listTrades, listWatch } from '../db/db';
import { fmtLots, fmtNum } from '../lib/format';
import { sortDaily } from '../lib/today';
import type { StockRow } from '../data/types';
import type { MarketData } from './Market';

function DailyRow({ r, holding }: { r: StockRow; holding: boolean }) {
  const newIds = new Set((r.new_flags as string[] | undefined) ?? []);
  const newFlags = r.flags.filter((f) => newIds.has(f.id));
  const chg = r.composite_chg as number | null | undefined;
  return (
    <a class="card" href={`#/stock/${r.code}`} style={{ display: 'block', color: 'inherit' }} aria-label={`${r.name} 日報`}>
      <div class="row between">
        <div>
          <span class="headline">{r.name}</span> <span class="small muted num">{r.code}</span>
          {holding ? <span class="badge" style={{ marginLeft: '0.375rem' }}>持股</span> : null}
          <div class="small"><Change change={r.change} pct={r.change_pct} showPrice={r.close} /></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div class="bold num">{scoreText(r.composite as number | null)} <span class="tiny muted">分</span></div>
          {chg ? <div class="tiny"><Signed value={chg} format={(v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}`)} label="分數" /></div> : null}
        </div>
      </div>
      <div class="row wrap small" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
        <span>外資 <Signed value={r.foreign_net_lots} format={fmtLots} /></span>
        <span>投信 <Signed value={r.trust_net_lots} format={fmtLots} /></span>
        <span>自營 <Signed value={r.dealer_net_lots} format={fmtLots} /></span>
        <span>融資 <Signed value={r.margin_change} format={fmtLots} /></span>
        <span>融券 <Signed value={r.short_change as number | null} format={fmtLots} /></span>
      </div>
      {newFlags.length ? (
        <div class="row wrap" style={{ gap: '0.375rem', marginTop: '0.375rem' }}>
          {newFlags.map((f) => <span key={f.id} class={`flag ${f.level === 'danger' ? 'danger' : ''}`}>新 ⚠︎ {f.label}</span>)}
        </div>
      ) : <Flags flags={r.flags} compact />}
    </a>
  );
}

export default function Today() {
  const summary = useScoredSummary();
  const market = useAsync(() => loadJson<MarketData>('market.json'), []);
  const ai = useAsync(() => loadAiSummary(), []);
  const mine = useDb(async () => {
    const w = await listWatch();
    const t = (await listTrades()).filter((x) => x.status === 'open');
    return { codes: [...new Set([...t.map((x) => x.code), ...w.map((x) => x.code)])], holdings: new Set(t.map((x) => x.code)) };
  });
  const rows = useMemo(() => {
    if (!summary.data || !mine) return [];
    return sortDaily(mine.codes.map((c) => summary.data!.byCode.get(c)).filter((r): r is StockRow => !!r));
  }, [summary.data, mine]);
  const topBuys = useMemo(() => {
    if (!summary.data) return [];
    return [...summary.data.rows].filter((r) => (r.value_million ?? 0) > 50).sort((a, b) => ((b.foreign_net_lots ?? 0) + (b.trust_net_lots ?? 0)) * (b.close ?? 0) - ((a.foreign_net_lots ?? 0) + (a.trust_net_lots ?? 0)) * (a.close ?? 0)).slice(0, 10);
  }, [summary.data]);
  const m = market.data;
  const flow = m?.flows[m.flows.length - 1];
  return (
    <div>
      <Nav title="今日" subtitle="盤後籌碼日報" />
      <DataStatus date={summary.data?.date} />
      {m ? (
        <a class="card glass" href="#/market" style={{ display: 'block', color: 'inherit' }}>
          <div class="row between">
            <div>
              <div class="small muted">加權指數</div>
              <div class="headline num">{fmtNum(m.taiex.close, 2)} <Change change={m.taiex.change} /></div>
            </div>
            <div class="small" style={{ textAlign: 'right' }}>
              <div>上漲 {m.breadth.up} · 下跌 {m.breadth.down}</div>
              {m.env ? <div>資金燈號：{m.env.summary}</div> : null}
            </div>
          </div>
          {flow ? (
            <div class="row wrap small" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
              <span>外資 <Signed value={flow.foreign} format={(v) => `${fmtNum(v, 1)} 億`} /></span>
              <span>投信 <Signed value={flow.trust} format={(v) => `${fmtNum(v, 1)} 億`} /></span>
              <span>自營商 <Signed value={flow.dealer} format={(v) => `${fmtNum(v, 1)} 億`} /></span>
            </div>
          ) : null}
        </a>
      ) : market.loading ? <div class="card glass skeleton" style={{ minHeight: '6.75rem' }} role="status" aria-busy="true" aria-label="載入大盤資料" /> : null}
      {ai.data && ai.data.date === m?.date ? (
        <div class="card">
          <div class="row between"><span class="headline">盤後摘要</span><span class="flag">AI 生成</span></div>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {ai.data.lines.map((l) => <li key={l} class="small">{l}</li>)}
          </ul>
          <p class="tiny muted">由 AI 依當日衍生數據自動摘要，可能有誤，僅供參考；分數與依據以各頁明細為準。</p>
        </div>
      ) : null}
      {summary.error ? <ErrorState error={summary.error} /> : null}
      {summary.loading && !summary.data ? <Loading /> : null}
      <h2 class="title-2">我的自選與持股</h2>
      {mine && !mine.codes.length ? (
        <div class="empty"><p>加入自選股或持倉後，這裡會顯示每天的法人、信用、分數變化與新的風險旗標。</p><a class="btn primary" href="#/watchlist">前往自選</a></div>
      ) : null}
      {rows.map((r) => <DailyRow key={r.code} r={r} holding={!!mine?.holdings.has(r.code)} />)}
      {topBuys.length ? (
        <>
          <h2 class="title-2">全市場法人買超（外資＋投信，金額）</h2>
          <div class="list">
            {topBuys.map((r) => (
              <a key={r.code} class="list-item" href={`#/stock/${r.code}`}>
                <span class="grow">{r.name} <span class="muted small">{r.code}</span></span>
                <span class="small"><Change change={r.change} pct={r.change_pct} /></span>
                <span class="small num">{fmtNum((((r.foreign_net_lots ?? 0) + (r.trust_net_lots ?? 0)) * 1000 * (r.close ?? 0)) / 1e8, 2)} 億</span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
