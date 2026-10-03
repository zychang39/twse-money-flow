/**
 * 主動式 ETF：清單（依 20 日均成交值）與持股變動排行（持股為部分涵蓋，如實標示來源與範圍）。
 * 2026-10-02 健檢 #7：排行依 market.json etf_ranking 的 cross（兩檔以上同向）拆成「跨檔加碼／減碼」與「單檔持股變動」；
 * 涵蓋說明放在清單上方；金額以億元（2 位小數）為主、張為副；清單列顯示漲跌 % 與「有／無持股資料」。
 */
import { PageHead, TopBar } from '../components/Chrome';
import { Banner, DataStatus, ErrorState, Loading } from '../components/DataStatus';
import { Signed } from '../components/Change';
import { IconInfo } from '../components/Icons';
import { useAsync } from '../hooks';
import { loadMarket } from '../data/api';
import { ETF_KINDS, ETF_KIND_LABEL, type EtfKind, type EtfMove } from '../data/types';
import { setListContext } from '../lib/listContext';
import { arrow, dirClass, fmtLots, fmtNum, missing, pctPlain } from '../lib/format';
import { PAGE_SOURCES } from '../lib/health';

/** 兩檔以上同向才算跨檔；舊版資料沒有 cross 欄位時以檔數判斷。 */
export const isCross = (e: EtfMove): boolean => (e.cross === undefined ? e.etfs >= 2 : e.cross);

/**
 * 涵蓋說明：pipeline 的 coverage 字串優先；否則「12／20 檔有持股資料」；covered／total 任一缺少時寫 missing，不輸出「—／— 檔」這種半句。
 */
export function coverageText(rk: { coverage?: string | object; coverage_text?: string; covered?: number; total?: number }): string {
  if (typeof rk.coverage === 'string' && rk.coverage) return rk.coverage;
  if (rk.coverage_text) return rk.coverage_text;
  if (rk.covered !== undefined && rk.total !== undefined) return `${rk.covered}／${rk.total} 檔有持股資料`;
  return missing('沒有持股資料');
}

/** 變動分類標籤（M2 2026-10-03）：新增／加碼／減碼／剔除；舊版資料沒有 kind 時依方向寫加碼／減碼。 */
export function kindOf(e: Pick<EtfMove, 'kind' | 'net_shares'>): EtfKind {
  return e.kind ?? (e.net_shares > 0 ? 'add' : 'reduce');
}

export function KindTag({ kind }: { kind: EtfKind }) {
  return <span class="tag" data-testid="etf-kind">{ETF_KIND_LABEL[kind]}</span>;
}

/**
 * 分類筆數句（M2）：「新增 3・加碼 12・減碼 8・剔除 1（ETF × 股票筆數）」。
 * pipeline 的 kinds 優先（涵蓋全部變動）；舊版資料沒有時以排行列計數（最多各 30 列）並註明。
 */
export function kindCountsText(rk: { kinds?: Partial<Record<EtfKind, number>>; add: EtfMove[]; reduce: EtfMove[] }): string {
  const counts: Record<EtfKind, number> = { new: 0, add: 0, reduce: 0, exit: 0 };
  const fromRows = !rk.kinds;
  if (rk.kinds) for (const k of ETF_KINDS) counts[k] = rk.kinds[k] ?? 0;
  else for (const e of [...rk.add, ...rk.reduce]) counts[kindOf(e)] += 1;
  const parts = ETF_KINDS.map((k) => `${ETF_KIND_LABEL[k]} ${fmtNum(counts[k], 0)}`).join('・');
  return `${parts}（${fromRows ? '排行內的股票數' : 'ETF × 股票筆數'}）`;
}

/** 「+1.82 億」（net_value 已是億元）；沒有均價時附原因。 */
function yiText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return missing('無均價');
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 2)} 億`;
}

/** 漲跌 %（▲▼＋顏色＋螢幕閱讀器文字）。 */
function PctChange({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span class="caption muted">{missing('無漲跌資料')}</span>;
  const d = dirClass(v);
  return (
    <span class={`num ${d}`}>
      <span class="sr-only">{d === 'up' ? '上漲' : d === 'down' ? '下跌' : '平盤'} {pctPlain(Math.abs(v))}</span>
      <span aria-hidden="true">{arrow(v)} {pctPlain(Math.abs(v))}</span>
    </span>
  );
}

function MoveCard({ title, items, testid }: { title: string; items: EtfMove[]; testid: string }) {
  return (
    <div class="card" data-testid={testid}>
      <div class="body w6">{title}</div>
      {items.length ? items.slice(0, 10).map((e) => (
        <a key={e.code} class="row between caption" href={`#/stock/${e.code}`} style={{ minHeight: 'var(--tap)', color: 'inherit', gap: 'var(--s-2)' }} title={e.detail}>
          <span class="grow" style={{ minWidth: 0 }}>{e.name} <span class="muted">{e.code}</span><span class="muted" style={{ display: 'block' }}>{e.etfs} 檔 <KindTag kind={kindOf(e)} /></span></span>
          <span class="right" style={{ textAlign: 'right' }}>
            <Signed value={e.net_value} label="金額" format={yiText} />
            <span class="muted" style={{ display: 'block' }}><Signed value={e.net_shares / 1000} label="張數" format={fmtLots} /> 張</span>
          </span>
        </a>
      )) : <p class="caption muted">沒有符合的股票。</p>}
    </div>
  );
}

export default function Etf() {
  const market = useAsync(loadMarket, []);
  const m = market.data;
  const list = m?.active_etfs ?? [];
  const rk = m?.etf_ranking;
  const add = rk?.add ?? [];
  const reduce = rk?.reduce ?? [];
  const crossAdd = add.filter(isCross), crossReduce = reduce.filter(isCross);
  const singleAdd = add.filter((e) => !isCross(e)), singleReduce = reduce.filter((e) => !isCross(e));
  const any = add.length + reduce.length > 0;
  return (
    <div class="page">
      <TopBar back="/explore" />
      <PageHead eyebrow="主動式 ETF" title={m ? `${list.length} 檔主動式 ETF` : '主動式 ETF'} />
      <DataStatus date={m?.date} uses={PAGE_SOURCES.etf} />
      {market.error ? <ErrorState error={market.error} /> : null}
      {market.loading ? <Loading /> : null}
      {m ? (
        <>
          {rk ? (
            <p class="caption muted" style={{ marginTop: 'var(--s-3)' }} data-testid="etf-coverage">
              持股變動涵蓋：{coverageText(rk)}{rk.date ? `・持股資料日 ${rk.date}` : ''}。只有部分投信在官網揭露每日持股；金額＝變動股數 × 當日均價（估）。
            </p>
          ) : null}
          {any ? (
            <>
              {rk ? (
                <p class="caption muted" style={{ marginTop: 'var(--s-2)' }} data-testid="etf-kind-counts">
                  持股變動分類：{kindCountsText(rk)}。新增＝前次沒有、本次持有；剔除＝前次持有、本次 0 股。
                </p>
              ) : null}
              <h2 class="section" style={{ marginTop: 'var(--s-4)' }}>跨檔加碼／減碼<span class="caption muted" style={{ display: 'block', fontWeight: 'normal' }}>兩檔以上主動式 ETF 同方向變動</span></h2>
              {crossAdd.length || crossReduce.length ? (
                <div class="grid two" style={{ marginTop: 'var(--s-2)' }}>
                  <MoveCard title="跨檔加碼" items={crossAdd} testid="etf-cross-add" />
                  <MoveCard title="跨檔減碼" items={crossReduce} testid="etf-cross-reduce" />
                </div>
              ) : <p class="caption muted" data-testid="etf-cross-empty">{rk?.date ? `${rk.date} ` : ''}沒有兩檔以上同向變動的股票。</p>}
              <h2 class="section" style={{ marginTop: 'var(--s-5)' }}>單檔持股變動<span class="caption muted" style={{ display: 'block', fontWeight: 'normal' }}>只有一檔主動式 ETF 變動</span></h2>
              {singleAdd.length || singleReduce.length ? (
                <div class="grid two" style={{ marginTop: 'var(--s-2)' }}>
                  <MoveCard title="加碼" items={singleAdd} testid="etf-single-add" />
                  <MoveCard title="減碼" items={singleReduce} testid="etf-single-reduce" />
                </div>
              ) : <p class="caption muted">沒有單檔變動的股票。</p>}
            </>
          ) : (
            <Banner icon={<IconInfo />} title="持股變動：部分涵蓋">
              {rk?.status ?? '主動式 ETF 的每日持股只公布在各投信官網，尚未取得集中且可自動化的來源。清單與成交資訊照常顯示。'}
            </Banner>
          )}
          <h2 class="section" style={{ marginTop: 'var(--s-5)' }}>清單<span class="caption muted" style={{ display: 'block', fontWeight: 'normal' }}>依 20 日均成交值排序</span></h2>
          <div class="list" style={{ marginTop: 'var(--s-2)' }}>
            {list.map((e) => (
              <a key={e.code} class="list-item" href={`#/stock/${e.code}`} onClick={() => setListContext({ name: '主動式 ETF', codes: list.map((x) => x.code) })}>
                <span class="grow" style={{ minWidth: 0 }}>
                  <span class="body">{e.name}</span>
                  <span class="caption muted" style={{ display: 'block' }}>
                    {e.code}
                    {e.has_holdings !== undefined ? <span class="tag" style={{ marginLeft: 'var(--s-2)' }} data-testid="etf-holdings-tag">{e.has_holdings ? '有持股資料' : '無持股資料'}</span> : null}
                  </span>
                </span>
                <span class="right" style={{ textAlign: 'right' }}>
                  <span class="body" style={{ display: 'block' }}>{fmtNum(e.close, 2)} <span class="caption"><PctChange v={e.change_pct} /></span></span>
                  <span class="caption muted">20 日均 {e.value_million_20d === null ? missing('無成交值') : `${fmtNum(e.value_million_20d, 0)} 百萬`}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
