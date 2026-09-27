/** 產業資金輪動：熱力圖（紅＝法人淨買超／上漲、綠＝淨賣超／下跌，以濃淡表示強度），點選查看產業內個股。 */
import { useMemo, useState } from 'preact/hooks';
import { PageHead, TopBar } from '../components/Chrome';
import { DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { StockListRow } from '../components/StockRow';
import { useAsync } from '../hooks';
import { useScoredSummary } from '../data/useSummary';
import { loadMarket } from '../data/api';
import { setListContext } from '../lib/listContext';
import { fmtLots, fmtNum, fmtPct } from '../lib/format';
import { navigate } from '../router';

function heat(v: number | null, scale: number): string {
  if (v === null || v === undefined) return 'var(--surface-1)';
  const x = Math.max(-1, Math.min(1, v / scale));
  const pct = Math.round(18 + 52 * Math.abs(x));
  return `color-mix(in srgb, ${x >= 0 ? 'var(--up)' : 'var(--down)'} ${pct}%, var(--surface-1))`;
}

function SectorStocks({ industry }: { industry: string }) {
  const summary = useScoredSummary();
  const rows = useMemo(() => (summary.data?.rows ?? []).filter((r) => r.industry === industry)
    .sort((a, b) => ((b.foreign_net_5d ?? 0) + (b.trust_net_5d ?? 0)) * (b.close ?? 0) - ((a.foreign_net_5d ?? 0) + (a.trust_net_5d ?? 0)) * (a.close ?? 0)), [summary.data, industry]);
  const codes = rows.map((r) => r.code);
  return (
    <div class="page">
      <TopBar back="/explore/sectors" />
      <PageHead eyebrow="產業資金輪動" title={industry}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>依外資＋投信近 5 日淨買超金額排序・{rows.length} 檔</p>
      </PageHead>
      {summary.loading ? <Loading /> : null}
      <div class="stock-list">
        {rows.map((r) => (
          <StockListRow key={r.code} code={r.code} row={r} sub={`5 日 ${fmtLots((r.foreign_net_5d ?? 0) + (r.trust_net_5d ?? 0))} 張`}
            onOpen={() => { setListContext({ name: industry, codes }); navigate(`/stock/${r.code}`); }} />
        ))}
      </div>
    </div>
  );
}

export default function Sectors({ industry }: { industry?: string }) {
  const market = useAsync(loadMarket, []);
  const [period, setPeriod] = useState<1 | 5 | 20>(5);
  const [metric, setMetric] = useState<'net' | 'ret'>('net');
  if (industry) return <SectorStocks industry={industry} />;
  const m = market.data;
  const values = m ? m.sectors.map((s) => (s[`${metric}_${period}`] as number | null) ?? 0) : [];
  const scale = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  const sorted = m ? [...m.sectors].sort((a, b) => ((b[`net_${period}`] as number) ?? 0) - ((a[`net_${period}`] as number) ?? 0)) : [];
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="資金流向哪些產業？" title={sorted[0] ? <>近 {period} 日法人淨買超最多：<br />{sorted[0].industry}</> : '產業資金輪動'} />
      <DataStatus date={m?.date} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          <div class="segmented" role="group" aria-label="期間" style={{ marginTop: 'var(--s-5)' }}>
            {([1, 5, 20] as const).map((k) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{k} 日</button>)}
          </div>
          <div class="segmented" role="group" aria-label="指標" style={{ marginTop: 'var(--s-2)' }}>
            <button aria-pressed={metric === 'net'} onClick={() => setMetric('net')}>法人淨買超</button>
            <button aria-pressed={metric === 'ret'} onClick={() => setMetric('ret')}>漲跌幅</button>
          </div>
          <div class="heat" style={{ marginTop: 'var(--s-4)' }}>
            {m.sectors.map((s) => {
              const v = s[`${metric}_${period}`] as number | null;
              const r = s[`ret_${period}`] as number | null;
              const n = s[`net_${period}`] as number | null;
              return (
                <button key={s.industry} style={{ background: heat(v, scale) }} onClick={() => navigate(`/explore/sectors/${encodeURIComponent(s.industry)}`)}
                  aria-label={`${s.industry}：法人淨買超 ${fmtNum(n, 1)} 億、漲跌幅中位數 ${fmtPct(r)}（${period} 日）`}>
                  <div class="w6">{s.industry}</div>
                  <div aria-hidden="true">{metric === 'net' ? `${n !== null && n > 0 ? '▲' : n !== null && n < 0 ? '▼' : ''} ${fmtNum(n === null ? null : Math.abs(n), 1)} 億` : `${r !== null && r > 0 ? '▲' : r !== null && r < 0 ? '▼' : ''} ${r === null ? '—' : `${Math.abs(r).toFixed(2)}%`}`}</div>
                  <div class="muted t1" aria-hidden="true">{s.count} 檔</div>
                </button>
              );
            })}
          </div>
          <p class="caption muted" style={{ marginTop: 'var(--s-3)' }}>法人淨買超金額 = Σ(三大法人淨買超股數 × 收盤價)；漲跌幅為產業內個股還原報酬的中位數。</p>
        </>
      ) : null}
    </div>
  );
}
