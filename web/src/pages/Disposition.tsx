/**
 * 處置與注意（2026-10 改版）：處置中、交易所公布的注意累計名單、注意次數表。
 * 只呈現交易所公告的事實與次數，不預測是否會被處置；作業要點與門檻放 ⓘ。
 */
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Card, EmptyRow, List, Num, PageTitle, Row, Section, Table } from '../components/ui';
import { useAsync } from '../hooks';
import { loadJson } from '../data/api';
import { navigate } from '../router';

interface Data {
  date: string;
  watch: { code: string; name: string; consecutive: number; in10: number; in30: number; last_date: string; reason: string; official: boolean }[];
  disposition: { code: string; name: string; start: string; end: string; reason: string | null; measure: string | null; interval_minutes: number | null }[];
  official: { code: string; name: string; situation: string }[];
}

/** 「2026-10-01」→「10/1」 */
export function md(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 處置列的副資訊：「10/1–10/12・第一次處置・連續三次」 */
export function dispositionSub(r: Data['disposition'][number]): string {
  return [`${md(r.start)}–${md(r.end)}`, r.measure, r.reason].filter(Boolean).join('・');
}

const RULES = (
  <>
    <p>依證交所「公布或通知注意交易資訊暨處置作業要點」第六條與櫃買中心對應規定（2026-08-10 起施行的修正）：</p>
    <ul>
      <li>處置條件：連續 3 個營業日達注意標準第一款；或連續 5 個營業日、最近 10 個營業日內 6 個營業日、最近 30 個營業日內 12 個營業日達第一款至第八款（另有當日沖銷標準與監視業務督導會報決議等情形）。</li>
      <li>處置期間：第一次與第二次以上都是 5 個營業日（同時達當日沖銷標準者 7 個營業日）；2026-08-10 前為 10 個（12 個）營業日。</li>
      <li>撮合間隔：人工管制撮合約每 2 分鐘一次；變更交易方法者第一次約 10 分鐘、第二次以上約 25 分鐘；變更交易方法且分盤集合競價者 45／60 分鐘。2026-08-10 前第一次 5 分鐘、第二次以上 20 分鐘。</li>
      <li>撮合間隔由處置公告內容解析「約每 N 分鐘撮合一次」；解析不到顯示「—」。</li>
    </ul>
    <p>資料來源：證交所、櫃買中心處置有價證券公告。</p>
  </>
);

const OFFICIAL_INFO = (
  <>
    <p>證交所（OpenAPI notetrans）與櫃買中心每日公布的名單，官方名稱為「公布注意累計次數可能達處置標準之有價證券」；右側文字為官方公布的情形（例：連續二次）。</p>
    <p>此處只列出名單內容，不另外推測是否會被處置；已在處置期間的股票不重複列出於個股旗標。</p>
  </>
);

const COUNT_INFO = (
  <>
    <p>連續＝由最新交易日往回連續被公布注意交易資訊的營業日數；10 日、30 日＝最近 10、30 個營業日內被公布注意的天數（同一天多款只算一次）；最近＝最近一次被公布注意的日期。</p>
    <p>依近 10 日次數排序，列出前 100 檔；資料來源：證交所、櫃買中心公布注意交易資訊。</p>
  </>
);

export default function Disposition() {
  const d = useAsync(() => loadJson<Data>('disposition.json'), []);
  const data = d.data;
  const noticed10 = data ? data.watch.filter((w) => w.in10 > 0).length : 0;
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle
        title="處置與注意"
        sub={data ? `資料至 ${md(data.date)}・處置中 ${data.disposition.length} 檔・近 10 日注意 ${noticed10} 檔` : '交易所公告'}
      />
      {d.error ? <ErrorState error={d.error} /> : null}
      {d.loading ? <Loading /> : null}
      {data ? (
        <>
          <Section title="處置中" info={RULES} aside={`${data.disposition.length} 檔`} testid="disp-active">
            <List chev>
              {data.disposition.length ? data.disposition.map((r) => (
                <Row key={`${r.code}-${r.start}`} label={<>{r.name} <span class="ui-muted">{r.code}</span></>}
                  sub={dispositionSub(r)} value={<Num v={r.interval_minutes} unit="分鐘" />} href={`#/stock/${r.code}`} />
              )) : <EmptyRow>無</EmptyRow>}
            </List>
          </Section>

          <Section title="注意累計（官方公布）" info={OFFICIAL_INFO} aside={`${data.official.length} 檔`} testid="disp-official">
            <List chev>
              {data.official.length ? data.official.map((r) => (
                <Row key={r.code} label={<>{r.name} <span class="ui-muted">{r.code}</span></>} sub={r.situation} href={`#/stock/${r.code}`} />
              )) : <EmptyRow>無</EmptyRow>}
            </List>
          </Section>

          <Section title="注意次數" info={COUNT_INFO} testid="disp-counts">
            {data.watch.length ? (
              <Card>
              <Table
                caption="注意次數"
                cols={[
                  { key: 'n', label: '股票', render: (r) => <>{r.name} <span class="ui-muted">{r.code}</span></> },
                  { key: 'c', label: '連續', align: 'r', width: '3.5rem', render: (r) => <Num v={r.consecutive} /> },
                  { key: 'a', label: '10 日', align: 'r', width: '3.5rem', render: (r) => <Num v={r.in10} /> },
                  { key: 'b', label: '30 日', align: 'r', width: '3.5rem', render: (r) => <Num v={r.in30} /> },
                  { key: 'd', label: '最近', align: 'r', width: '3.5rem', render: (r) => md(r.last_date) },
                ]}
                rows={data.watch.slice(0, 100)}
                rowKey={(r) => r.code}
                onRow={(r) => navigate(`/stock/${r.code}`)}
                sticky
              />
              </Card>
            ) : <List><EmptyRow>無</EmptyRow></List>}
          </Section>
        </>
      ) : null}
    </div>
  );
}
