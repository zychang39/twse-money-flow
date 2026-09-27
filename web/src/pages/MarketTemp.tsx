/** 市場溫度：資金環境 5 項指標、市場溫度（反向參考）、三大法人金額走勢、全市場法人買超。 */
import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { EnvDetail, FlowsRow } from '../components/Market';
import { NetBars } from '../components/Viz';
import { StockListRow } from '../components/StockRow';
import { useAsync } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadMarket } from '../data/api';
import { envInfo } from '../lib/envState';
import { setListContext } from '../lib/listContext';
import { fmtNum } from '../lib/format';
import { navigate } from '../router';

export default function MarketTemp() {
  const market = useAsync(loadMarket, []);
  const summary = useScoredSummary();
  const m = market.data;
  const env = envInfo(m?.env?.lights);
  const top = useMemo(() => (summary.data ? [...summary.data.rows].filter((r) => (r.value_million ?? 0) > 50)
    .sort((a, b) => ((b.foreign_net_lots ?? 0) + (b.trust_net_lots ?? 0)) * (b.close ?? 0) - ((a.foreign_net_lots ?? 0) + (a.trust_net_lots ?? 0)) * (a.close ?? 0)).slice(0, 10) : []), [summary.data]);
  const flows = m?.flows ?? [];
  const [who, setWho] = useState<'all' | 'foreign' | 'trust' | 'dealer'>('all');
  const WHO: Record<typeof who, string> = { all: '三大法人合計', foreign: '外資', trust: '投信', dealer: '自營商' };
  const series = flows.slice(-60).map((f) => (who === 'all' ? (f.foreign ?? 0) + (f.trust ?? 0) + (f.dealer ?? 0) : f[who]));
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead twoLine eyebrow="大盤環境能不能積極？" title={m ? <>資金環境{env.label}<br />{env.counts}</> : '市場溫度'} />
      <DataStatus date={m?.date} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          <div style={{ marginTop: 'var(--s-5)' }}><EnvDetail market={m} /></div>
          <h2 class="section" style={{ marginTop: 'var(--s-10)' }}>三大法人買賣超</h2>
          <p class="caption muted">上漲 {m.breadth.up}・下跌 {m.breadth.down}・平盤 {m.breadth.flat}・加權指數年線 {fmtNum(m.taiex.ma240, 0)}</p>
          <FlowsRow flow={flows[flows.length - 1]} />
          <div class="segmented" role="group" aria-label="法人" style={{ marginTop: 'var(--s-4)' }}>
            {(Object.keys(WHO) as (typeof who)[]).map((k) => <button key={k} aria-pressed={who === k} onClick={() => setWho(k)}>{k === 'all' ? '合計' : WHO[k]}</button>)}
          </div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <NetBars values={series} label={`${WHO[who]}每日買賣超金額（近 60 日）`} />
            <div class="row between caption muted"><span>{WHO[who]}（億元）・近 60 個交易日</span><span><span class="up" aria-hidden="true">■</span> 買超 <span class="down" aria-hidden="true">■</span> 賣超</span></div>
          </div>
          <h2 class="section" style={{ marginTop: 'var(--s-10)' }}>全市場法人買超（外資＋投信，金額）</h2>
          <div class="stock-list">
            {top.map((r) => (
              <StockListRow key={r.code} code={r.code} row={r} sub={`${fmtNum((((r.foreign_net_lots ?? 0) + (r.trust_net_lots ?? 0)) * 1000 * (r.close ?? 0)) / 1e8, 2)} 億`}
                onOpen={() => { setListContext({ name: '法人買超', codes: top.map((x) => x.code) }); navigate(`/stock/${r.code}`); }} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
