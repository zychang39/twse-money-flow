/** 產業資金輪動：熱力圖（紅＝法人淨買超／上漲、綠＝淨賣超／下跌，以濃淡表示強度），點選查看產業內個股。 */
import { useMemo } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { EmptyRow, List, PageTitle, Row, Section, Seg, Signed } from '../components/ui';
import { useAsync, useRestoredState } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadMarket } from '../data/api';
import { setListContext } from '../lib/listContext';
import { dirColor, fmtNum, missing, orMissing, pctPlain, pctSigned } from '../lib/format';
import { navigate } from '../router';

function heat(v: number | null, scale: number): string {
  if (v === null || v === undefined) return 'var(--surface-1)';
  const x = Math.max(-1, Math.min(1, v / scale));
  const pct = Math.round(18 + 52 * Math.abs(x));
  return `color-mix(in srgb, ${dirColor(x)} ${pct}%, var(--surface-1))`;
}

function SectorStocks({ industry }: { industry: string }) {
  const summary = useScoredSummary();
  const rows = useMemo(() => (summary.data?.rows ?? []).filter((r) => r.industry === industry)
    .sort((a, b) => ((b.foreign_net_5d ?? 0) + (b.trust_net_5d ?? 0)) * (b.close ?? 0) - ((a.foreign_net_5d ?? 0) + (a.trust_net_5d ?? 0)) * (a.close ?? 0)), [summary.data, industry]);
  const codes = rows.map((r) => r.code);
  return (
    <div class="page">
      <TopBar back="/explore/sectors" />
      <PageTitle title={industry} sub={`${rows.length} 檔・依外資＋投信近 5 日淨買超金額排序`} />
      {summary.loading ? <Loading /> : null}
      <Section title="個股" info={<p>外資＋投信近 5 日淨買超張數 × 收盤價排序；副資訊為近 5 日外資＋投信淨買超張數。</p>}>
        <List chev>
          {rows.length ? rows.map((r) => (
            <Row key={r.code} label={<>{r.name} <span class="ui-muted">{r.code}</span></>}
              value={<Signed v={(r.foreign_net_5d ?? 0) + (r.trust_net_5d ?? 0)} digits={0} unit="張" />}
              href={`#/stock/${r.code}`} onClick={() => setListContext({ name: industry, codes })} />
          )) : <EmptyRow>無</EmptyRow>}
        </List>
      </Section>
    </div>
  );
}

export default function Sectors({ industry }: { industry?: string }) {
  const market = useAsync(loadMarket, []);
  const [period, setPeriod] = useRestoredState<1 | 5 | 20>('sectors.period', 5);
  const [metric, setMetric] = useRestoredState<'net' | 'ret'>('sectors.metric', 'net');
  if (industry) return <SectorStocks industry={industry} />;
  const m = market.data;
  const values = m ? m.sectors.map((s) => (s[`${metric}_${period}`] as number | null) ?? 0) : [];
  const scale = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  const sorted = m ? [...m.sectors].sort((a, b) => ((b[`net_${period}`] as number) ?? 0) - ((a[`net_${period}`] as number) ?? 0)) : [];
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="產業資金輪動" sub={sorted[0] ? `近 ${period} 日法人淨買超最多：${sorted[0].industry}` : undefined} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <Section title="產業" info={
          <>
            <p>法人淨買超金額＝Σ（三大法人淨買超股數 × 收盤價）；漲跌幅為產業內個股還原報酬的中位數。</p>
            <p>顏色：紅＝淨買超／上漲、綠＝淨賣超／下跌，濃淡為相對強度。點選產業查看個股。</p>
          </>
        }>
          <Seg options={[['1', '1 日'], ['5', '5 日'], ['20', '20 日']] as const} value={String(period) as '1' | '5' | '20'} onChange={(v) => setPeriod(Number(v) as 1 | 5 | 20)} label="期間" />
          <Seg options={[['net', '法人淨買超'], ['ret', '漲跌幅']] as const} value={metric} onChange={setMetric} label="指標" />
          <div class="heat" data-audit-skip>
            {m.sectors.map((s) => {
              const v = s[`${metric}_${period}`] as number | null;
              const r = s[`ret_${period}`] as number | null;
              const n = s[`net_${period}`] as number | null;
              return (
                <button key={s.industry} style={{ background: heat(v, scale) }} onClick={() => navigate(`/explore/sectors/${encodeURIComponent(s.industry)}`)}
                  aria-label={`${s.industry}：法人淨買超 ${orMissing(n, (v) => `${fmtNum(v, 1)} 億`, '沒有資料')}、漲跌幅中位數 ${orMissing(r, pctSigned, '沒有資料')}（${period} 日）`}>
                  <div class="w6">{s.industry}</div>
                  <div aria-hidden="true">{metric === 'net'
                    ? n === null ? missing('沒有資料') : `${n > 0 ? '▲' : n < 0 ? '▼' : ''} ${fmtNum(Math.abs(n), 1)} 億`
                    : r === null ? missing('沒有資料') : `${r > 0 ? '▲' : r < 0 ? '▼' : ''} ${pctPlain(Math.abs(r))}`}</div>
                  <div class="muted t1" aria-hidden="true">{s.count} 檔</div>
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
