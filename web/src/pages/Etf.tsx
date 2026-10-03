/**
 * 主動式 ETF（SPEC §7，2026-10 改版）：頁首一列「涵蓋 16/32 檔・持股日 10/2」，其餘說明（投信、欄位、判定方法、
 * 排序口徑驗證）進 ⓘ；加碼／減碼兩個區塊，每列 名稱 代號｜金額（億）｜佔 20 日均成交額 %，副資訊 幾檔同向・佔市值 %。
 * 排序口徑：金額｜佔均額｜佔市值，預設由 pipeline 的 sort_default 決定（驗證未通過時為佔均額）。
 * 判定（扣除受益權單位數變動）、金額門檻 0.3 億與驗證都在 pipeline（derive/etf.py）。
 */
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Card, CardLabel, EmptyRow, Info, List, Num, PageTitle, Row, Section, Seg, Signed, Table } from '../components/ui';
import { useAsync } from '../hooks';
import { loadMarket } from '../data/api';
import { ETF_KINDS, ETF_KIND_LABEL, type EtfCoverage, type EtfItem, type EtfKind, type EtfMove, type EtfSortMetric, type EtfValidation } from '../data/types';
import { setListContext } from '../lib/listContext';
import { fmtNum, md } from '../lib/format';

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
  if (!cov) return '持股資料累積中';
  return `涵蓋 ${cov.covered}/${cov.total} 檔・持股日 ${md(cov.holdings_date, '無持股資料')}`;
}

/** 未驗證時頁首第二行：「排序口徑未驗證（樣本 156 筆、2025/10/3–2026/8/4）」；已驗證回 null。 */
export function unverifiedLine(v: EtfValidation | undefined | null): string | null {
  if (!v || v.verified) return null;
  const [a, b] = v.period ?? [null, null];
  const ymd = (s: string) => s.replace(/^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/, '$1/$2/$3');
  return `排序口徑未驗證（樣本 ${fmtNum(v.n, 0)} 筆${a && b ? `、${ymd(a)}–${ymd(b)}` : ''}）`;
}

/** 副資訊：「新增・同向 2 檔・佔市值 0.04%」（加碼／減碼不重複標示，只標新增、剔除）。 */
export function itemSub(x: EtfItem): string {
  const parts: string[] = [];
  if (x.kind === 'new' || x.kind === 'exit') parts.push(ETF_KIND_LABEL[x.kind]);
  parts.push(`同向 ${x.etfs_same_dir} 檔`);
  if (x.pct_mcap !== null && Number.isFinite(x.pct_mcap)) parts.push(`佔市值 ${fmtNum(Math.abs(x.pct_mcap), 2)}%`);
  return parts.join('・');
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
  if (!items.length) return <Section title={title} aside="無" testid={testid} />;
  return (
    <Section title={title} aside={`${items.length} 檔`} testid={testid}>
      <Card>
        <CardLabel aside="金額｜佔均額">名稱｜同向・佔市值</CardLabel>
        <List extra chev>
          {items.map((x) => (
            <Row key={x.code} testid="etf-item" href={`#/stock/${x.code}`}
              onClick={() => setListContext({ name: '主動式 ETF 持股變動', codes: items.map((i) => i.code) })}
              label={<>{x.name} <span class="ui-muted">{x.code}</span></>}
              sub={itemSub(x)}
              value={<Signed v={x.value_yi} digits={2} unit="億" kind="sign" label={x.dir === 'add' ? '加碼金額' : '減碼金額'} />}
              extra={<span class="ui-v ui-foot"><Num v={x.pct_avg20 === null ? null : Math.abs(x.pct_avg20)} digits={1} unit="%" /></span>} />
          ))}
        </List>
      </Card>
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
    ? <><Signed v={r.excess} digits={2} unit="%" tone="plain" /> <span class="ui-muted">t {fmtNum(r.t, 2)}</span></>
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
          已實作 {cov.implemented_issuers ?? '—'} 家投信、{cov.implemented_etfs ?? '—'} 檔；其餘投信因反爬、導向循環、驗證機制或尚未找到端點而未涵蓋。
          {cov.lagging?.length ? ` 持股日較晚：${cov.lagging.map((l) => `${l.code} ${md(l.date)}`).join('、')}。` : ''}
        </p>
      ) : null}
      <p>
        各投信揭露股數與權重；受益權單位數除聯博外都有揭露
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
        aside={m ? <Info title="主動式 ETF 持股變動" testid="etf-info"><EtfInfo cov={cov} method={rk?.method} v={rk?.validation} kinds={kinds} /></Info> : undefined}
        sub={m ? <><div data-testid="etf-coverage">{coverageLine(cov)}</div>{warn ? <div data-testid="etf-unverified">{warn}</div> : null}</> : undefined} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          <Seg options={SORT_OPTIONS} value={sort} onChange={pick} label="排序口徑" testid="etf-sort" />
          <MoveList title="加碼" items={add} testid="etf-add" />
          <MoveList title="減碼" items={reduce} testid="etf-reduce" />
          <Section title="清單" aside={`${list.length} 檔・依 20 日均成交值`} testid="etf-list">
            <List chev>
              {list.length ? list.map((e) => (
                <Row key={e.code} href={`#/stock/${e.code}`}
                  onClick={() => setListContext({ name: '主動式 ETF', codes: list.map((x) => x.code) })}
                  label={e.name}
                  sub={`代號 ${e.code}・20 日均 ${e.value_million_20d === null ? '—' : `${fmtNum(e.value_million_20d / 100, 2)} 億`}${e.has_holdings === false ? '・無持股資料' : ''}`}
                  value={<Num v={e.close} digits={2} />}
                  value2={e.change_pct === 0 ? '平盤' : <Signed v={e.change_pct ?? null} digits={2} unit="%" kind="arrow" />} />
              )) : <EmptyRow>無主動式 ETF</EmptyRow>}
            </List>
          </Section>
        </>
      ) : null}
    </div>
  );
}
