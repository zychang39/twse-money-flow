/**
 * 資料狀態（2026-10-02 健檢 M2）：每個資料集的來源、最新日、應有日、涵蓋率、回補進度、失敗原因。
 * 從各頁頁首的「資料至 …」點入。應有日依公布時程與交易日曆推算（lib/dataStatus.ts）；休市、尚未到公布時間都不是錯誤。
 */
import { TopBar } from '../components/Chrome';
import { List, PageTitle, Row, Section, Tag } from '../components/ui';
import { ErrorState, Loading } from '../components/DataStatus';
import { useAsync } from '../hooks';
import { loadHealth, loadJson, loadMarket, loadMeta } from '../data/api';
import type { EvidenceFile } from '../lib/evidence';
import { type DatasetRow, datasetRows, tpeNow } from '../lib/dataStatus';
import { md } from '../lib/format';
import { makeCalendar } from '../lib/tradingCalendar';

const STATE_TEXT = { ok: '已齊', lag: '落後', missing: '沒有資料', na: '—' } as const;

function DatasetSection({ r }: { r: DatasetRow }) {
  const risk = r.state === 'lag' || r.state === 'missing';
  return (
    <Section title={r.label} testid={`ds-${r.key}`} aside={<Tag tone={risk ? 'risk' : 'neutral'}>{STATE_TEXT[r.state]}</Tag>}>
      <List>
        <Row label="來源" sub={r.sources.length ? r.sources.join('、') : '未登錄來源'} />
        <Row label="最新日" value={r.latest ?? '—'} />
        <Row label="應有日" sub={r.lagText ?? undefined} value={r.expected} />
        {r.coverage ? <Row label="涵蓋率" sub={r.coverage} /> : null}
        {r.backfill ? <Row label="回補進度" sub={r.backfill} /> : null}
        {r.failure ? <Row label="失敗原因" sub={r.failure} /> : null}
      </List>
    </Section>
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
      <PageTitle title="資料狀態" sub={rows ? (lagging ? `${lagging} 個資料集未到應有日` : '全部資料集已到應有日') : undefined} />
      <Section title="說明" info={<><p>應有日依各資料的公布時程與證交所交易日曆推算：信用 21:30 後、集保每週六公布上週、主動式 ETF 隔天上午、月營收次月 10 日。休市或還沒到公布時間不算落後。</p>{meta.data?.generated_at ? <p>衍生資料產生 {meta.data.generated_at.replace('T', ' ').slice(0, 16)}。</p> : null}</>}>
        <List chev>
          <Row label="資料健康" sub={`最新交易日 ${md(meta.data?.market_date ?? null)}・執行紀錄與格式變動`} href="#/me/health" />
        </List>
      </Section>
      {meta.error ? <ErrorState error={meta.error} /> : null}
      {health.error ? <ErrorState error={health.error} /> : null}
      {!rows ? <Loading /> : rows.map((r) => <DatasetSection key={r.key} r={r} />)}
    </div>
  );
}
