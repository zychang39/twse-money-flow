/**
 * 主動式 ETF（SPEC §7，2026-10 改版）：頁首一列「涵蓋 16/32 檔・持股日 10/2」，其餘說明（投信、欄位、判定方法、
 * 排序口徑驗證）進 ⓘ；「持股變動」一張圖（2026-10-09 改版）：加碼在上、減碼在下，每列 名稱｜以 0 為中線的發散橫條｜金額
 * （或佔均額、佔市值），副資訊 代號・幾檔同向，數值下方標新增／剔除或另一個口徑；預設加碼、減碼各前 10 檔，「顯示全部」展開
 * （components/BarRows.tsx）。清單的列進入 ETF 詳細頁（EtfDetail：持股占比、拉日期看加減碼）；清單列的副資訊前有策略標籤（config/active_etf.yml）。
 * 排序口徑：金額｜佔均額｜佔市值，預設由 pipeline 的 sort_default 決定（驗證未通過時為佔均額）。
 * 判定（扣除受益權單位數變動）、金額門檻 0.3 億與驗證都在 pipeline（derive/etf.py）。
 * 2026-10-09：清單可依成交值｜市值｜績效排序，績效切期間（1 日～1 年）；每列一條橫條（績效為紅漲綠跌的發散橫條）。
 * 2026-10-10：首屏改成「資金流向」一張圖（components/EtfFlowChart：加碼在上、減碼在下，列數依螢幕高度，一眼看完），
 *   期間 1 日｜1 週｜2 週｜1 個月｜1 季（etf_flows.json）；原本的持股變動列表改名「明細」放在圖下方、跟著期間切換，
 *   「排序口徑未驗證」移到明細區塊；清單在最下面。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Button, EmptyRow, List, PageTitle, Section, Seg, Signed, Table } from '../components/ui';
import { IconChevron } from '../components/Icons';
import { DataState, DivergingBar, Interp, ProgressBar } from '../components/kit';
import { BarRow } from '../components/BarRows';
import { EtfTagPills, TagDefs } from '../components/EtfTags';
import { etfTags } from '../lib/etfTags';
import { barMax, LIST_SORTS, mergeMoves, metricOf as listMetric, missingRetText, PERIOD_LABEL, PERIODS, periodSummary, rowSub, sortEtfs, type EtfListSort, type EtfPeriod } from '../lib/etfList';
import type { ActiveEtf } from '../data/types';
import '../styles/etf.css';
import { useAsync, useSegParam } from '../hooks';
import { loadEtfFlows, loadMarket } from '../data/api';
import { EtfFlowChart } from '../components/EtfFlowChart';
import { FLOW_PERIOD_KEYS, FLOW_PERIOD_LABEL, FLOW_PERIODS, type FlowPeriodKey, flowSummary, periodData, periodItems, spanLabel } from '../lib/etfFlows';
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

/** 清單列：第一行 名稱｜橫條｜數值｜›，第二行 策略標籤＋代號，第三行 均額／市值／持股檔數（或沒有持股的原因）。 */
function EtfBarRow({ e, sort, period, max, onOpen }: { e: ActiveEtf; sort: EtfListSort; period: EtfPeriod; max: number; onOpen: () => void }) {
  const v = listMetric(e, sort, period);
  const info = rowSub(e, sort) + (sort === 'ret' && v === null ? `・${missingRetText(e, period)}` : '');
  const valueText = v === null ? '無資料' : sort === 'ret' ? `${PERIOD_LABEL[period]} ${v > 0 ? '上漲' : v < 0 ? '下跌' : '持平'} ${fmtNum(Math.abs(v), 2)}%` : `${fmtNum(v, 1)} 億`;
  const tags = etfTags(e.code);
  return (
    <a class="ui-row ui-tap el-row" href={`#/explore/etf/${e.code}`} data-testid="etf-list-row" onClick={onOpen}
      aria-label={`${e.name} ${e.code}，${sort === 'value' ? '20 日均成交值' : sort === 'mcap' ? '市值' : '報酬'} ${valueText}，${info}${tags.length ? `，策略 ${tags.join('、')}` : ''}`}>
      {/* 清單都是主動式 ETF：畫面上省略名稱前的「主動」（朗讀仍是全名） */}
      <span class="el-name ui-row-label" aria-hidden="true">{e.name.replace(/^主動/, '')}</span>
      <span class="el-bar" aria-hidden="true">
        {sort === 'ret' ? <DivergingBar value={v} max={max} /> : <ProgressBar value={v} max={max} color="var(--d-2)" />}
      </span>
      <span class="el-v" aria-hidden="true">
        {sort === 'ret' ? <Signed v={v} digits={2} unit="%" kind="arrow" /> : <span class="ui-num">{v === null ? '—' : `${fmtNum(v, v >= 100 ? 0 : 1)} 億`}</span>}
      </span>
      <span class="el-sub ui-row-sub ui-foot ui-muted" aria-hidden="true"><EtfTagPills code={e.code} /><span class="ui-num">{e.code}</span></span>
      <span class="el-info ui-row-sub ui-foot ui-muted" aria-hidden="true">{info}</span>
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
        <p>橫條：同一張圖用同一個刻度；績效以 0 為中心，紅色＝上漲、綠色＝下跌。</p>
        <p>副資訊前的策略標籤依各投信官網、公開說明書或證交所 ETF 資訊站的投資策略文字歸納（config/active_etf.yml），只描述選股方式與範圍，依規則整理、非推薦；點進詳細頁看一句摘要與依據。</p>
        <TagDefs /></>} infoTitle="主動式 ETF 清單">
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

const MOVE_FOLD = 10;
const MOVE_UNIT: Record<EtfSortMetric, string> = { value: '億', pct_avg20: '%', pct_mcap: '%' };
const MOVE_DIGITS: Record<EtfSortMetric, number> = { value: 2, pct_avg20: 1, pct_mcap: 2 };

/** 一行摘要：「加碼 17 檔・減碼 14 檔（橫條＝金額）」；紅加碼、綠減碼在 ⓘ 說明。 */
export function moveSummary(add: number, reduce: number, sort: EtfSortMetric): string {
  return `加碼 ${add} 檔・減碼 ${reduce} 檔（橫條＝${METRIC_LABEL[sort].replace('佔 20 日均成交額', '佔均額')}）`;
}

/** 數值下方一行：新增／剔除優先；否則另一個口徑（依金額時為佔均額，否則為金額）。 */
export function moveValueSub(x: EtfItem, sort: EtfSortMetric): string | undefined {
  const kind = itemKind(x);
  if (kind) return kind;
  if (sort === 'value') return x.pct_avg20 === null || !Number.isFinite(x.pct_avg20) ? undefined : `佔均額 ${fmtNum(Math.abs(x.pct_avg20), 1)}%`;
  return x.value_yi === null || !Number.isFinite(x.value_yi) ? undefined : `${fmtNum(Math.abs(x.value_yi), 2)} 億`;
}

function MoveRow({ x, sort, max, codes }: { x: EtfItem; sort: EtfSortMetric; max: number; codes: string[] }) {
  const v = metricOf(x, sort);
  const dir = x.dir === 'add' ? '加碼' : '減碼';
  const valueText = v === null || !Number.isFinite(v) ? '無資料' : `${fmtNum(Math.abs(v), MOVE_DIGITS[sort])} ${MOVE_UNIT[sort]}`;
  const kind = itemKind(x);
  return (
    <BarRow name={x.name} sub={`${x.code}・同向 ${x.etfs_same_dir} 檔`} testid="etf-item"
      bar={{ kind: 'diverging', value: v, max }}
      value={<Signed v={v} digits={MOVE_DIGITS[sort]} unit={MOVE_UNIT[sort]} kind="sign" />}
      valueSub={moveValueSub(x, sort)}
      href={`#/stock/${x.code}`} onClick={() => setListContext({ name: '主動式 ETF 持股變動', codes })}
      label={`${x.name} ${x.code}，${dir}${sort === 'value' ? '' : METRIC_LABEL[sort]} ${valueText}，同向 ${x.etfs_same_dir} 檔${kind ? `，${kind}` : ''}`} />
  );
}

/**
 * 持股變動一張圖（2026-10-09）：加碼在上（大到小）、減碼在下（最大的減碼在最底），同一個刻度；
 * 預設加碼、減碼各前 10 檔，「顯示全部」展開（列數多時一頁放不下）。
 */
function MoveChart({ add, reduce, sort }: { add: EtfItem[]; reduce: EtfItem[]; sort: EtfSortMetric }) {
  const [all, setAll] = useState(false);
  const { rows, folded } = mergeMoves(add, reduce, MOVE_FOLD, all);
  const max = Math.max(1e-9, ...[...add, ...reduce].map((x) => Math.abs(metricOf(x, sort) ?? 0)));
  const codes = rows.map((x) => x.code);
  if (!rows.length) return <List><EmptyRow testid="etf-no-moves">這一天沒有跨檔的加碼或減碼</EmptyRow></List>;
  return (
    <>
      <List label="持股變動" testid="etf-move-rows">
        {rows.map((x) => <MoveRow key={x.code} x={x} sort={sort} max={max} codes={codes} />)}
      </List>
      {folded || all ? (
        <Button onClick={() => setAll(!all)} testid="etf-moves-more">
          {all ? `只看加碼、減碼各前 ${MOVE_FOLD} 檔` : `顯示全部 ${add.length + reduce.length} 檔（加碼 ${add.length}・減碼 ${reduce.length}）`}
        </Button>
      ) : null}
    </>
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
      <p>圖：加碼在上、減碼在下，橫條以 0 為中線（紅＝加碼、綠＝減碼）、同一個刻度；預設加碼、減碼各列前 10 檔，「顯示全部」展開。數值下方標新增／剔除，否則標另一個口徑。</p>
      {v ? (
        <>
          <p>{v.rule ?? ''}{v.verified ? '' : ` 結果：${v.reason ?? '未通過'}。`}</p>
          {v.rows.length ? <ValidationTable v={v} /> : null}
        </>
      ) : null}
    </>
  );
}

/** 資金流向圖的 ⓘ */
function FlowInfo({ days }: { days?: number }) {
  return (
    <>
      <p>資金流向＝主動式 ETF 依每日持股揭露算出的跨檔加碼、減碼金額（已扣除申購買回造成的等比例增減；判定方法見「明細」的 ⓘ）。</p>
      <p>1 日＝各 ETF 最新一次揭露；1 週、2 週、1 個月、1 季＝持股日落在最近 5、10、20、60 個交易日內的每一次揭露加總，同一檔 ETF 在期間內的加碼與減碼先互相抵銷。{days && days > 1 ? `目前期間 ${days} 個交易日。` : ''}</p>
      <p>圖：加碼在上（紅）、減碼在下（綠），以中線為 0、同一個刻度，數字單位億元；列數依螢幕高度，完整清單在下方「明細」。未達 0.3 億的股票不畫在圖上，但計入上方的合計與檔數。</p>
      <p>只涵蓋官網揭露持股的 ETF；新掛牌的 ETF 只計入掛牌之後。依規則整理、非推薦。</p>
    </>
  );
}

export default function Etf() {
  const market = useAsync(loadMarket, []);
  const flows = useAsync(loadEtfFlows, []);
  const m = market.data;
  const list = m?.active_etfs ?? [];
  const rk = m?.etf_ranking;
  const cov = rk && typeof rk.coverage === 'object' ? rk.coverage : undefined;
  const [period, setPeriod] = useSegParam<FlowPeriodKey>(FLOW_PERIOD_KEYS, '1d', 'fp', 'etf-flow-period');
  const [sort, setSort] = useState<EtfSortMetric>(() => savedSort() ?? 'pct_avg20');
  useEffect(() => { if (!savedSort() && rk?.sort_default) setSort(rk.sort_default); }, [rk?.sort_default]);
  const pick = (v: EtfSortMetric) => {
    setSort(v);
    try { localStorage.setItem(SORT_KEY, v); } catch { /* 無痕模式：只在本次有效 */ }
  };
  const data = periodData(flows.data, period, rk?.items, rk?.date);
  const items = periodItems(data, period, rk?.items);
  const add = sortItems(items.filter((x) => x.dir === 'add'), sort);
  const reduce = sortItems(items.filter((x) => x.dir === 'reduce'), sort);
  const warn = unverifiedLine(rk?.validation);
  const kinds = rk ? kindCountsText({ kinds: rk.kinds, add: rk.add ?? [], reduce: rk.reduce ?? [] }) : undefined;
  const pname = FLOW_PERIOD_LABEL[period];
  const flowPhase = !data ? (flows.loading && period !== '1d' ? 'loading' : 'empty') : 'ok';
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageTitle title="主動式 ETF" sub={m ? <div data-testid="etf-coverage">{coverageLine(cov)}</div> : undefined} />
      <PageStale />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          {/* 2026-10-10：首屏就是完整的資金流向圖（期間 1 日～1 季）；明細與清單往下滑 */}
          <Section title="資金流向" testid="etf-flow" aside={spanLabel(data) || undefined} info={<FlowInfo days={data?.days} />} infoTitle="主動式 ETF 資金流向">
            <Seg options={FLOW_PERIODS} value={period} onChange={setPeriod} label="期間" testid="etf-flow-period" />
            <DataState phase={flowPhase} reason={period === '1d' ? '持股資料累積中' : `${pname}資金流向資料累積中（下一次部署後出現）`}>
              <Interp testid="etf-flow-summary">{flowSummary(data)}</Interp>
              <EtfFlowChart items={items} label={`主動式 ETF ${pname}資金流向（億元）`} />
            </DataState>
          </Section>
          <Section title="明細" testid="etf-moves" aside={cov ? `${cov.issuers} 家投信` : undefined}
            info={<EtfInfo cov={cov} method={rk?.method} v={rk?.validation} kinds={kinds} />} infoTitle="主動式 ETF 持股變動">
            {warn ? <Interp testid="etf-unverified">{warn}</Interp> : null}
            <Seg options={SORT_OPTIONS} value={sort} onChange={pick} label="排序口徑" testid="etf-sort" />
            <Interp testid="etf-moves-summary">{`${pname}・${moveSummary(add.length, reduce.length, sort)}`}</Interp>
            <MoveChart add={add} reduce={reduce} sort={sort} />
          </Section>
          <EtfList list={list} />
        </>
      ) : null}
    </div>
  );
}
