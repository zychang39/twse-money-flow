/**
 * 資料狀態（2026-10-02 健檢 M2）：每個資料集的來源、最新日、應有日、涵蓋率、回補進度、失敗原因。
 * 從各頁頁首的「資料至 …」點入。應有日依公布時程與交易日曆推算（lib/dataStatus.ts）；休市、尚未到公布時間都不是錯誤。
 */
import { PageHead, TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { KeyValueList } from '../components/Metrics';
import { useAsync } from '../hooks';
import { loadHealth, loadJson, loadMarket, loadMeta } from '../data/api';
import type { EvidenceFile } from '../lib/evidence';
import { type DatasetRow, datasetRows, tpeNow } from '../lib/dataStatus';
import { md } from '../lib/format';
import { makeCalendar } from '../lib/tradingCalendar';

const STATE_TEXT = { ok: '已齊', lag: '落後', missing: '沒有資料', na: '—' } as const;

function Row({ r }: { r: DatasetRow }) {
  const risk = r.state === 'lag' || r.state === 'missing';
  const rows = [
    { k: '來源', v: r.sources.length ? r.sources.join('、') : '—（config/sources.yml 沒有這個來源）' },
    { k: '最新日', v: r.latest ?? '—（尚未取得）' },
    { k: '應有日', v: r.expected, sub: r.lagText },
    ...(r.coverage ? [{ k: '涵蓋率', v: r.coverage }] : []),
    ...(r.backfill ? [{ k: '回補進度', v: r.backfill }] : []),
    ...(r.failure ? [{ k: '失敗原因', v: r.failure }] : []),
  ];
  return (
    <section class="ds-item" data-testid={`ds-${r.key}`}>
      <div class="row between" style={{ marginTop: 'var(--s-6)', marginBottom: 'var(--s-2)' }}>
        <h2 class="section">{r.label}</h2>
        <span class={`tag${risk ? ' risk' : ''}`}>{STATE_TEXT[r.state]}</span>
      </div>
      <KeyValueList rows={rows} label={`${r.label}的資料狀態`} />
    </section>
  );
}

export default function Data() {
  const meta = useAsync(loadMeta, []);
  const health = useAsync(loadHealth, []);
  const ev = useAsync(() => loadJson<EvidenceFile>('evidence.json').catch(() => null), []);
  const market = useAsync(loadMarket, []);
  const rows = (() => {
    if (!meta.data) return null;
    const cal = makeCalendar(meta.data.calendar);
    const weeks = ev.data?.meta.coverage_weekly?.whale ?? [];
    const last = weeks[weeks.length - 1];
    const rk = market.data?.etf_ranking;
    return datasetRows(health.data ?? null, meta.data.asof ?? health.data?.asof, cal, tpeNow(), {
      tdcc: last ? { ratio: last.ratio, included: last.included, universe: last.universe, date: last.date, note: ev.data?.meta.coverage_backfill ?? null } : null,
      etf: rk?.total !== undefined ? { covered: rk.covered ?? 0, total: rk.total } : null,
    });
  })();
  const lagging = rows?.filter((r) => r.state !== 'ok').length ?? 0;
  return (
    <div class="page">
      <TopBar back="/me/health" avatar={false} />
      <PageHead eyebrow="資料狀態" title={rows ? (lagging ? `${lagging} 個資料集未到應有日` : '所有資料集都到應有日') : '資料狀態'}>
        <p class="caption muted" style={{ marginTop: 'var(--s-1)' }}>
          應有日依各資料的公布時程與證交所交易日曆推算：信用 21:30 後、集保每週六公布上週、主動式 ETF 隔天上午、月營收次月 10 日。休市或還沒到公布時間不算落後。
          {meta.data?.generated_at ? `衍生資料產生 ${meta.data.generated_at.replace('T', ' ').slice(0, 16)}。` : ''}
        </p>
      </PageHead>
      {meta.error ? <ErrorState error={meta.error} /> : null}
      {health.error ? <ErrorState error={health.error} /> : null}
      {!rows ? <Loading /> : rows.map((r) => <Row key={r.key} r={r} />)}
      {rows ? <p class="caption muted" style={{ marginTop: 'var(--s-6)' }}>最新交易日 {md(meta.data?.market_date ?? null)}；資料源的執行紀錄與格式變動在 <a href="#/me/health">資料健康</a>。</p> : null}
    </div>
  );
}
