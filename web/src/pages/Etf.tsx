/**
 * 主動式 ETF（SPEC §7，2026-10 改版）：頁首一列「涵蓋 16/32 檔・持股日 10/2」，其餘說明（投信、欄位、判定方法、
 * 排序口徑驗證）進 ⓘ；加碼／減碼兩個區塊，每列 名稱 代號｜金額（億）｜佔 20 日均成交額 %，副資訊 幾檔同向・佔市值 %。
 * 2026-10-08：加碼／減碼與清單同一種排版（只有列間橫線）；清單的列進入 ETF 詳細頁（EtfDetail：持股占比、拉日期看加減碼）。
 * 排序口徑：金額｜佔均額｜佔市值，預設由 pipeline 的 sort_default 決定（驗證未通過時為佔均額）。
 * 判定（扣除受益權單位數變動）、金額門檻 0.3 億與驗證都在 pipeline（derive/etf.py）。
 * 2026-10-09：清單可依成交值｜市值｜績效排序，績效切期間（1 日～1 年）；每列一條橫條（績效為紅漲綠跌的發散橫條）。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { EmptyRow, List, PageTitle, Row, Section, Seg, Signed, Table, Num } from '../components/ui';
import { IconChevron } from '../components/Icons';
import { DivergingBar, Interp, ProgressBar } from '../components/kit';
import { barMax, LIST_SORTS, metricOf as listMetric, missingRetText, PERIOD_LABEL, PERIODS, periodSummary, rowSub, sortEtfs, type EtfListSort, type EtfPeriod } from '../lib/etfList';
import type { ActiveEtf } from '../data/types';
import '../styles/etf.css';
import { useAsync } from '../hooks';
import { loadMarket } from '../data/api';
import { ETF_KINDS, ETF_KIND_LABEL, type EtfCoverage, type EtfItem, type EtfKind, type EtfMove, type EtfSortMetric, type EtfValidation } from '../data/types';
import { setListContext } from '../lib/listContext';
import { fmtNum, md } from '../lib/format';
import { Term } from '../components/kit';
import { PageStale } from '../components/DataStatus';

/** 變動分類標籤：新增／加碼／減碼／剔除；舊版資料沒有 kind 時依方向寫加碼／減碼。 */
export function kindOf(e: Pick<EtfMove, 'kind' | 'net_shares'>): EtfKind {
  return e.kind ?? (e.net_shares > 0 ? 'add' : 'reduce');
}

/**
 * 分類筆數句：「新增 3・加碼 12・減碼 8・剔除 1（ETF × 股票筆數）」。
 * pipeline 的 kinds 優先（涵蓋全部變動）；舊版資料沒有時以排行列計數並註明。
 */
export function kindCountsText(rk: { kinds?: Partial<Record<EtfKind, number>>; add: EtfMove[]; reduce: EtfMove[] }): string {
  const counts: Record<EtfKind, number> = { new: 0, add: 0, reduce: 0, exit: 0 };
  const fromRows = !rk.kinds;
  if (rk.kinds) for (const k of ETF_KINDS) counts[k] = rk.kinds[k] ?? 0;
  else for (const e of [...rk.add, ...rk.reduce]) counts[kindOf(e)] += 1;
  const parts = ETF_KINDS.map((k) => `${ETF_KIND_LABEL[k]} ${fmtNum(counts[k], 0)}`).join('・');
  return `${parts}（${fromRows ? '排行內的股票數' : 'ETF × 股票筆數'}）`;
}

export const SORT_OPTIONS = [['value', '金額'], ['pct_avg20', '佔均額'], ['pct_mcap', '佔市值']] as const;
const METRIC_LABEL: Record<EtfSortMetric, string> = { value: '金額', pct_avg20: '佔 20 日均成交額', pct_mcap: '佔市值' };

const metricOf = (x: EtfItem, m: EtfSortMetric): number | null => (m === 'value' ? x.value_yi : x[m]);

/** 依口徑的絕對值由大到小（缺值排最後）；不改變原陣列。 */
export function sortItems(items: EtfItem[], metric: EtfSortMetric): EtfItem[] {
  const key = (x: EtfItem): number => {
    const v = metricOf(x, metric);
    return v === null || v === undefined || !Number.isFinite(v) ? -1 : Math.abs(v);
  };
  return [...items].sort((a, b) => key(b) - key(a));
}

/** 頁首一列：「涵蓋 16/32 檔・持股日 10/2」。 */
export function coverageLine(cov: EtfCoverage | undefined | null): string {
  if (!cov || !cov.total || !cov.holdings_date) return '持股資料累積中';
  return `涵蓋 ${cov.covered}/${cov.total} 檔・持股日 ${md(cov.holdings_date, '無持股資料')}`;
}

/** 未驗證時頁首第二行：「排序口徑未驗證（樣本 156 筆、2025/10/3–2026/8/4）」；已驗證回 null。 */
export function unverifiedLine(v: EtfValidation | undefined | null): string | null {
  if (!v || v.verified) return null;
  const [a, b] = v.period ?? [null, null];
  const ymd = (s: string) => s.replace(/^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/, '$1/$2/$3');
  return `排序口徑未驗證（樣本 ${fmtNum(v.n, 0)} 筆${a && b ? `、${ymd(a)}–${ymd(b)}` : ''}）`;
}

/** 副資訊：「同向 2 檔・佔市值 0.04%」。 */
/** 金額下方的分類：只標新增、剔除（加碼／減碼已由區塊表示，不重複）。 */
export function itemKind(x: EtfItem): string | undefined {
  return x.kind === 'new' || x.kind === 'exit' ? ETF_KIND_LABEL[x.kind] : undefined;
}

export function itemSub(x: EtfItem): string {
  const parts: string[] = [];
  parts.push(`同向 ${x.etfs_same_dir} 檔`);
  if (x.pct_mcap !== null && Number.isFinite(x.pct_mcap)) parts.push(`佔市值 ${fmtNum(Math.abs(x.pct_mcap), 2)}%`);
  return parts.join('・');
}

const LIST_KEY = 'tmf-etf-list';
function savedList(): { sort: EtfListSort; period: EtfPeriod } {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? '{}') as { sort?: string; period?: string };
    return {
      sort: LIST_SORTS.some(([k]) => k === v.sort) ? (v.sort as EtfListSort) : 'value',
      period: PERIODS.some(([k]) => k === v.period) ? (v.period as EtfPeriod) : '20d',
    };
  } catch {
    return { sort: 'value', period: '20d' };
  }
}

/** 清單列：名稱｜橫條｜數值｜›（與詳細頁同一種橫條列）。 */
function EtfBarRow({ e, sort, period, max, onOpen }: { e: ActiveEtf; sort: EtfListSort; period: EtfPeriod; max: number; onOpen: () => void }) {
  const v = listMetric(e, sort, period);
  const sub = rowSub(e, sort) + (sort === 'ret' && v === null ? `・${missingRetText(e, period)}` : '');
  const valueText = v === null ? '無資料' : sort === 'ret' ? `${PERIOD_LABEL[period]} ${v > 0 ? '上漲' : v < 0 ? '下跌' : '持平'} ${fmtNum(Math.abs(v), 2)}%` : `${fmtNum(v, 1)} 億`;
  return (
    <a class="ui-row ui-tap el-row" href={`#/explore/etf/${e.code}`} data-testid="etf-list-row" onClick={onOpen}
      aria-label={`${e.name} ${e.code}，${sort === 'value' ? '20 日均成交值' : sort === 'mcap' ? '市值' : '報酬'} ${valueText}，${sub}`}>
      {/* 清單都是主動式 ETF：畫面上省略名稱前的「主動」（朗讀仍是全名） */}
      <span class="el-name ui-row-label" aria-hidden="true">{e.name.replace(/^主動/, '')}</span>
      <span class="el-bar" aria-hidden="true">
        {sort === 'ret' ? <DivergingBar value={v} max={max} /> : <ProgressBar value={v} max={max} color="var(--d-2)" />}
      </span>
      <span class="el-v" aria-hidden="true">
        {sort === 'ret' ? <Signed v={v} digits={2} unit="%" kind="arrow" /> : <span class="ui-num">{v === null ? '—' : `${fmtNum(v, v >= 100 ? 0 : 1)} 億`}</span>}
      </span>
      <span class="el-sub ui-row-sub ui-foot ui-muted" aria-hidden="true">{sub}</span>
      <span class="el-chev ui-row-chev" aria-hidden="true"><IconChevron /></span>
    </a>
  );
}

function EtfList({ list }: { list: ActiveEtf[] }) {
  const [state, setState] = useState(savedList);
  const { sort, period } = state;
  const save = (next: { sort: EtfListSort; period: EtfPeriod }) => {
    setState(next);
    try { localStorage.setItem(LIST_KEY, JSON.stringify(next)); } catch { /* 無痕模式：只在本次有效 */ }
  };
  const rows = sortEtfs(list, sort, period);
  const max = barMax(list, sort, period);
  const covered = list.filter((e) => e.has_holdings !== false).length;
  const open = () => setListContext({ name: '主動式 ETF', codes: rows.map((e) => e.code) });
  return (
    <Section title="清單" aside={`${list.length} 檔・持股 ${covered}/${list.length} 檔`} testid="etf-list"
      info={<><p>成交值＝近 20 個交易日平均成交金額；市值＝最新持股日的受益權單位數 × 收盤價（投信沒有揭露單位數時用揭露的基金淨資產）。</p>
        <p>績效＝還原價（含息）報酬：1 日～60 日、1 年為交易日數，今年＝對去年最後一個交易日；上市未滿期間的不列報酬。</p>
        <p>橫條：同一張圖用同一個刻度；績效以 0 為中心，紅色＝上漲、綠色＝下跌。</p></>} infoTitle="主動式 ETF 清單">
      <Interp><Term id="active_etf">主動式 ETF</Term> 每日公布持股；點進去看持股占比與任一段期間的加碼、減碼</Interp>
      <Seg options={LIST_SORTS} value={sort} onChange={(v) => save({ sort: v, period })} label="清單排序" testid="etf-list-sort" />
      <Seg options={PERIODS} value={period} onChange={(v) => save({ sort: sort === 'value' || sort === 'mcap' ? 'ret' : sort, period: v })} label="績效期間" testid="etf-period" small />
      <Interp testid="etf-period-summary">{periodSummary(list, period)}</Interp>
      <List chev label="主動式 ETF 清單">
        {rows.length ? rows.map((e) => <EtfBarRow key={e.code} e={e} sort={sort} period={period} max={max} onOpen={open} />) : <EmptyRow>無主動式 ETF</EmptyRow>}
      </List>
    </Section>
  );
}

const SORT_KEY = 'tmf-etf-sort';
function savedSort(): EtfSortMetric | null {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'value' || v === 'pct_avg20' || v === 'pct_mcap' ? v : null;
  } catch {
    return null;
  }
}

function MoveList({ title, items, testid }: { title: string; items: EtfItem[]; testid: string }) {
  // 無資料的區塊不顯示（M4：不留空卡片）
  if (!items.length) return null;
  return (
    <Section title={title} aside={`${items.length} 檔・金額｜佔均額`} testid={testid}>
      {/* 2026-10-08：與下方「清單」同一種排版（列與列之間只有橫線，不再包一層卡片與欄名列） */}
      <List extra chev>
        {items.map((x) => (
          <Row key={x.code} testid="etf-item" href={`#/stock/${x.code}`}
            onClick={() => setListContext({ name: '主動式 ETF 持股變動', codes: items.map((i) => i.code) })}
            label={<>{x.name} <span class="ui-muted">{x.code}</span></>}
            sub={itemSub(x)}
            value={<Signed v={x.value_yi} digits={2} unit="億" kind="sign" label={x.dir === 'add' ? '加碼金額' : '減碼金額'} />}
            value2={itemKind(x) ? <span class="ui-muted" data-testid="etf-kind">{itemKind(x)}</span> : undefined}
            extra={<span class="ui-v ui-foot"><Num v={x.pct_avg20 === null ? null : Math.abs(x.pct_avg20)} digits={1} unit="%" /></span>} />
        ))}
      </List>
    </Section>
  );
}

function ValidationTable({ v }: { v: EtfValidation }) {
  const metrics: EtfSortMetric[] = ['value', 'pct_avg20', 'pct_mcap'];
  const rows = metrics.flatMap((m) => [20, 40].map((h) => ({
    m, h,
    b: v.rows.find((r) => r.metric === m && r.h === h && r.vs === '0050'),
    e: v.rows.find((r) => r.metric === m && r.h === h && r.vs === 'ew'),
  })));
  const cell = (r?: { excess: number | null; t: number | null }) => (r && r.excess !== null
    ? <><Signed v={r.excess} digits={2} unit="%" tone="plain" /> <span class="ui-muted">t {fmtNum(r.t, 2).replace('-', '−')}</span></>
    : '—');
  return (
    <Table caption="排序口徑驗證" rowKey={(r) => `${r.m}-${r.h}`} rows={rows} cols={[
      { key: 'm', label: '口徑', render: (r) => `${METRIC_LABEL[r.m].replace('佔 20 日均成交額', '佔均額')} ${r.h} 日` },
      { key: 'b', label: '相對 0050', align: 'r', render: (r) => cell(r.b) },
      { key: 'e', label: '相對等權', align: 'r', render: (r) => cell(r.e) },
      { key: 'n', label: '樣本', align: 'r', width: '3.5rem', render: (r) => fmtNum(r.e?.n ?? r.b?.n ?? null, 0) },
    ]} />
  );
}

function EtfInfo({ cov, method, v, kinds }: { cov?: EtfCoverage; method?: string; v?: EtfValidation; kinds?: string }) {
  return (
    <>
      {cov ? (
        <p>
          持股日 {md(cov.holdings_date, '無')} 有持股資料的主動式 ETF {cov.covered} 檔（全部 {cov.total} 檔），
          來自 {cov.issuers} 家投信{cov.issuer_names?.length ? `（${cov.issuer_names.map((n) => n.replace(/投信$/, '')).join('、')}）` : ''}的官網揭露。
          {cov.implemented_issuers !== undefined && cov.implemented_etfs !== undefined ? `已實作 ${cov.implemented_issuers} 家投信、${cov.implemented_etfs} 檔；` : ''}{cov.skipped_issuers?.length ? `${cov.skipped_issuers.join('、')}的官網擋本工具的自動抓取，未涵蓋。` : ''}
          {cov.lagging?.length ? ` 持股日較晚：${cov.lagging.map((l) => `${l.code} ${md(l.date)}`).join('、')}。` : ''}
        </p>
      ) : null}
      <p>
        各投信揭露股數與權重（海外持股也列在詳細頁，跨檔加碼／減碼只算台股）；受益權單位數除聯博外都有揭露
        {cov?.units_missing?.length ? `（本次用持股股數比估計單位數變化：${cov.units_missing.join('、')}）` : ''}。
      </p>
      {method ? <p>{method}</p> : null}
      {kinds ? <p>持股變動分類：{kinds}。</p> : null}
      {v ? (
        <>
          <p>{v.rule ?? ''}{v.verified ? '' : ` 結果：${v.reason ?? '未通過'}。`}</p>
          {v.rows.length ? <ValidationTable v={v} /> : null}
        </>
      ) : null}
    </>
  );
}

export default function Etf() {
  const market = useAsync(loadMarket, []);
  const m = market.data;
  const list = m?.active_etfs ?? [];
  const rk = m?.etf_ranking;
  const cov = rk && typeof rk.coverage === 'object' ? rk.coverage : undefined;
  const [sort, setSort] = useState<EtfSortMetric>(() => savedSort() ?? 'pct_avg20');
  useEffect(() => { if (!savedSort() && rk?.sort_default) setSort(rk.sort_default); }, [rk?.sort_default]);
  const pick = (v: EtfSortMetric) => {
    setSort(v);
    try { localStorage.setItem(SORT_KEY, v); } catch { /* 無痕模式：只在本次有效 */ }
  };
  const items = rk?.items ?? [];
  const add = sortItems(items.filter((x) => x.dir === 'add'), sort);
  const reduce = sortItems(items.filter((x) => x.dir === 'reduce'), sort);
  const warn = unverifiedLine(rk?.validation);
  const kinds = rk ? kindCountsText({ kinds: rk.kinds, add: rk.add ?? [], reduce: rk.reduce ?? [] }) : undefined;
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="主動式 ETF"
        sub={m ? <><div data-testid="etf-coverage">{coverageLine(cov)}</div>{warn ? <div data-testid="etf-unverified">{warn}</div> : null}</> : undefined} />
      <PageStale />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          <Section title="持股變動" testid="etf-moves" aside={cov ? `${cov.issuers} 家投信` : undefined}
            info={<EtfInfo cov={cov} method={rk?.method} v={rk?.validation} kinds={kinds} />} infoTitle="主動式 ETF 持股變動">
            <Seg options={SORT_OPTIONS} value={sort} onChange={pick} label="排序口徑" testid="etf-sort" />
          </Section>
          <MoveList title="加碼" items={add} testid="etf-add" />
          <MoveList title="減碼" items={reduce} testid="etf-reduce" />
          <EtfList list={list} />
        </>
      ) : null}
    </div>
  );
}
