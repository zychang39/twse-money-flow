/**
 * 主動式 ETF 詳細頁（2026-10-08；#/explore/etf/{code}）：
 * - 期間：快速區間（前一次｜5 次｜20 次｜全部）＋兩個滑桿拉起日與迄日（單位＝一次持股揭露）。
 * - 加碼／減碼：起日 → 迄日的權重變化（百分點），發散橫條，紅＝權重增加、綠＝減少；
 *   每列標分類（新增／加碼／減碼／剔除，§7：扣除申購買回的等比例變動，與主頁同一套判定）與股數變化。
 * - 持股占比：迄日的權重，由大到小。
 * 2026-10-09：海外持股（f＝1）也列出，但不連到個股頁（不是台股），股數以「股」表示。
 * 資料：etf/{code}.json（pipeline/derive/etf.py detail_payload）；計算：lib/etfDetail.ts。
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading, PageStale } from '../components/DataStatus';
import { IconChevron } from '../components/Icons';
import { DivergingBar, Interp, ProgressBar, Term } from '../components/kit';
import { Button, EmptyRow, List, NavRow, PageTitle, Section, Seg, Signed } from '../components/ui';
import { loadEtfDetail } from '../data/api';
import { ETF_KIND_LABEL, type EtfKind } from '../data/types';
import { useAsync } from '../hooks';
import { holdingsAt, pairChanges, quickRange, sortByChange, TRADED, type EtfDetail as Detail, type Holding, type PairRow } from '../lib/etfDetail';
import { loadMarket } from '../data/api';
import type { JSX } from 'preact';
import { fmtNum, md } from '../lib/format';
import { setListContext } from '../lib/listContext';
import '../styles/etf.css';

type Quick = '1' | '5' | '20' | 'all' | 'custom';
const QUICK_BACK: Record<Exclude<Quick, 'custom'>, number | null> = { 1: 1, 5: 5, 20: 20, all: null };
const QUICK_LABEL: Record<Quick, string> = { 1: '前一次', 5: '5 次', 20: '20 次', all: '全部', custom: '自訂' };
const TOP_N = 15;

/** 目前區間對應的快速選項（與某個可用選項的區間相同；否則＝自訂）。 */
export function quickOf(n: number, i0: number, i1: number): Quick {
  for (const q of quickOptions(n)) {
    if (q === 'custom') continue;
    const [a, b] = quickRange(n, QUICK_BACK[q]);
    if (a === i0 && b === i1) return q;
  }
  return 'custom';
}

/** 可用的快速選項：往回次數超過可用天數的不列（「全部」已涵蓋）。 */
export function quickOptions(n: number): Quick[] {
  return [...(['1', '5', '20'] as const).filter((q) => (QUICK_BACK[q] as number) < n - 1), 'all', 'custom'];
}

/** 拉動其中一個滑桿：起日至少比迄日早一次揭露；碰到另一端時推著另一個走（不超出 0～n−1）。 */
export function clampRange(n: number, i0: number, i1: number, moved: 'from' | 'to'): [number, number] {
  if (moved === 'from') {
    const a = Math.min(i0, n - 2);
    return [a, Math.max(i1, a + 1)];
  }
  const b = Math.max(i1, 1);
  return [Math.min(i0, b - 1), b];
}

const lots = (shares: number) => shares / 1000;
/** 股數：台股以張（1,000 股），海外持股以股。 */
const qty = (shares: number, foreign = false) => (foreign ? `${fmtNum(shares, 0)} 股` : `${fmtNum(lots(shares), 0)} 張`);

/** 列的副資訊：「加碼・+1,200 張」「新增・20 張」「不變（申購買回）」；海外持股以股表示。 */
export function changeSub(r: PairRow): string {
  const raw = r.s1 - r.s0;
  const signed = `${raw > 0 ? '+' : raw < 0 ? '−' : ''}${qty(Math.abs(raw), r.foreign)}`;
  if (r.kind === 'new') return `新增・${qty(r.s1, r.foreign)}`;
  if (r.kind === 'exit') return `剔除・${qty(r.s0, r.foreign)}`;
  if (r.kind === 'add' || r.kind === 'reduce') return `${ETF_KIND_LABEL[r.kind]}・${signed}`;
  if (r.kind === 'hold') return raw === 0 ? '股數不變' : `不變（申購買回 ${signed}）`;
  return `無法判定・${signed}`;
}

function kindCounts(rows: PairRow[]): string {
  const c: Record<EtfKind, number> = { new: 0, add: 0, reduce: 0, exit: 0 };
  for (const r of rows) if (r.kind && r.kind !== 'hold') c[r.kind] += 1;
  return (['new', 'add', 'reduce', 'exit'] as const).map((k) => `${ETF_KIND_LABEL[k]} ${c[k]}`).join('・');
}

function goStock(codes: string[], name: string) {
  setListContext({ name, codes });
}

/** 台股列連到個股頁；海外持股不是台股，只呈現（不可點）。 */
function BarRow({ foreign, code, codes, listName, label, testid, children }: {
  foreign: boolean; code: string; codes: string[]; listName: string; label: string; testid: string; children: JSX.Element[];
}) {
  if (foreign) return <div class="ui-row eb-row eb-static" data-testid={testid} aria-label={`${label}（海外持股）`}>{children}</div>;
  return (
    <a class="ui-row ui-tap eb-row" href={`#/stock/${code}`} data-testid={testid} onClick={() => goStock(codes, listName)} aria-label={label}>
      {children}
    </a>
  );
}

function ChangeRow({ r, max, codes, listName }: { r: PairRow; max: number; codes: string[]; listName: string }) {
  const pp = r.dWeight;
  const word = pp === null ? '無資料' : `${pp > 0 ? '增加' : pp < 0 ? '減少' : '持平'} ${fmtNum(Math.abs(pp), 2)} 個百分點`;
  return (
    <BarRow foreign={!!r.foreign} code={r.code} codes={codes} listName={listName} testid="etf-change-row"
      label={`${r.name} ${r.code}，權重${word}，${changeSub(r)}`}>
      <span class="ui-row-main">
        <span class="ui-row-label">{r.name} <span class="ui-muted">{r.code}</span></span>
        <span class="ui-row-sub ui-foot ui-muted">{changeSub(r)}</span>
      </span>
      <span class="eb-bar" aria-hidden="true"><DivergingBar value={pp} max={max} /></span>
      <span class="eb-v" aria-hidden="true"><Signed v={pp} digits={2} unit="pp" /></span>
      <span class="ui-row-chev" aria-hidden="true">{r.foreign ? null : <IconChevron />}</span>
    </BarRow>
  );
}

function WeightRow({ h, max, codes, listName }: { h: Holding; max: number; codes: string[]; listName: string }) {
  return (
    <BarRow foreign={h.foreign} code={h.code} codes={codes} listName={listName} testid="etf-weight-row"
      label={`${h.name} ${h.code}，權重 ${h.weight === null ? '無資料' : `${fmtNum(h.weight, 2)}%`}，持股 ${qty(h.shares, h.foreign)}`}>
      <span class="ui-row-main">
        <span class="ui-row-label">{h.name} <span class="ui-muted">{h.code}</span></span>
        <span class="ui-row-sub ui-foot ui-muted">持股 {qty(h.shares, h.foreign)}{h.foreign ? '・海外' : ''}</span>
      </span>
      <span class="eb-bar" aria-hidden="true"><ProgressBar value={h.weight} max={max} color="var(--d-2)" /></span>
      <span class="eb-v ui-num" aria-hidden="true">{h.weight === null ? '—' : `${fmtNum(h.weight, 2)}%`}</span>
      <span class="ui-row-chev" aria-hidden="true">{h.foreign ? null : <IconChevron />}</span>
    </BarRow>
  );
}

/** 起日／迄日滑桿（一格＝一次持股揭露）。 */
function DateSlider({ label, dates, value, min, max, onChange, testid }: {
  label: string; dates: string[]; value: number; min: number; max: number; onChange: (v: number) => void; testid: string;
}) {
  return (
    <label class="eb-slider" data-testid={testid}>
      <span class="eb-slider-l ui-foot ui-muted">{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} disabled={min === max}
        aria-valuetext={`${label} ${md(dates[value])}`}
        onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))} />
      <span class="eb-slider-v ui-num">{md(dates[value])}</span>
    </label>
  );
}

function Body({ d }: { d: Detail }) {
  const n = d.dates.length;
  const [range, setRange] = useState<[number, number]>(() => quickRange(n, 1));
  useEffect(() => setRange(quickRange(n, 1)), [d.code, n]);
  const [i0, i1] = range;
  const [all, setAll] = useState(false);
  const [onlyTraded, setOnlyTraded] = useState<'traded' | 'all'>('traded');
  const pair = useMemo(() => (n >= 2 && i0 < i1 ? pairChanges(d, i0, i1) : null), [d, i0, i1, n]);
  const changes = useMemo(() => {
    if (!pair) return [];
    const rows = onlyTraded === 'traded' ? pair.rows.filter((r) => TRADED.includes(r.kind)) : pair.rows;
    return sortByChange(rows);
  }, [pair, onlyTraded]);
  const maxPp = Math.max(0.01, ...changes.map((r) => Math.abs(r.dWeight ?? 0)));
  const held = holdingsAt(d, i1);
  const shown = all ? held : held.slice(0, TOP_N);
  const maxW = Math.max(0.01, ...held.map((h) => h.weight ?? 0));
  const total = held.reduce((s, h) => s + (h.weight ?? 0), 0);
  const nForeign = held.filter((h) => h.foreign).length;
  const tradable = (rows: { code: string; foreign?: boolean }[]) => rows.filter((x) => !x.foreign).map((x) => x.code);
  const quick = quickOf(n, i0, i1);
  const pickQuick = (q: Quick) => { if (q !== 'custom') setRange(quickRange(n, QUICK_BACK[q])); };
  const span = `${md(d.dates[i0])} → ${md(d.dates[i1])}`;
  return (
    <>
      <Section title="期間" aside={n >= 2 ? `${span}・${i1 - i0} 次揭露` : undefined} testid="etf-range">
        {n < 2 ? (
          <Interp>資料累積中：目前只有 {n} 次持股揭露（{md(d.dates[0])}），需要兩次才能比較加碼與減碼。</Interp>
        ) : (
          <>
            <Seg options={quickOptions(n).map((q) => [q, QUICK_LABEL[q]] as const)} value={quick} onChange={pickQuick} label="快速區間" testid="etf-quick" />
            <div class="eb-sliders">
              {/* 兩個滑桿用同一條時間軸（0～最新一次揭露），位置對得上；起日至少比迄日早一次 */}
              <DateSlider label="起日" dates={d.dates} value={i0} min={0} max={n - 1} testid="etf-from"
                onChange={(v) => setRange(clampRange(n, v, i1, 'from'))} />
              <DateSlider label="迄日" dates={d.dates} value={i1} min={0} max={n - 1} testid="etf-to"
                onChange={(v) => setRange(clampRange(n, i0, v, 'to'))} />
            </div>
          </>
        )}
      </Section>
      {pair ? (
        <Section title="加碼／減碼" aside={`${span}・權重變化`} testid="etf-changes"
          info={<><p>橫條＝起日到迄日的持股權重變化（百分點）：紅色＝權重增加、綠色＝權重減少；同一張圖用同一個刻度。</p>
            <p>分類只看經理人實際買賣：{d.method ?? ''}</p>
            <p>權重也會隨股價漲跌改變；選「全部」可以看到股數沒變、只因股價變動的持股。</p></>}
          infoTitle="加碼／減碼怎麼判定">
          <Seg options={[['traded', '有買賣'], ['all', '全部持股']] as const} value={onlyTraded} onChange={setOnlyTraded} label="顯示範圍" testid="etf-filter" />
          <Interp testid="etf-kind-counts">{kindCounts(pair.rows)}{pair.basis === 'implied' ? '（受益權單位數未揭露，以共同持股估計申購買回）' : ''}{pair.basis === null ? '（無法判定：缺受益權單位數且共同持股不足）' : ''}</Interp>
          <List chev label="權重變化">
            {changes.length ? changes.map((r) => (
              <ChangeRow key={r.code} r={r} max={maxPp} codes={tradable(changes)} listName={`${d.name} ${span}`} />
            )) : <EmptyRow testid="etf-no-change">這段期間沒有加碼或減碼（股數變動都在申購買回的等比例範圍內）</EmptyRow>}
          </List>
        </Section>
      ) : null}
      <Section title="持股占比" aside={`${md(d.dates[i1])}・股票合計 ${fmtNum(total, 1)}%${nForeign ? `・海外 ${nForeign} 檔` : ''}`} testid="etf-weights"
        info={<p>迄日的持股權重（投信揭露）。台股與海外股票都列出；海外持股不是台股，不連到個股頁，股數以「股」表示。合計不到 100% 的部分是現金、期貨或選擇權。</p>} infoTitle="持股占比">
        <List chev label="持股占比">
          {shown.length ? shown.map((h) => (
            <WeightRow key={h.code} h={h} max={maxW} codes={tradable(held)} listName={`${d.name} 持股`} />
          )) : <EmptyRow>這一天沒有股票持股</EmptyRow>}
        </List>
        {held.length > TOP_N ? (
          <Button onClick={() => setAll(!all)} testid="etf-weights-more">{all ? `只看前 ${TOP_N} 檔` : `顯示全部 ${held.length} 檔`}</Button>
        ) : null}
      </Section>
      <Section title="更多">
        <List chev>
          <NavRow title="股價與成交" sub={`${d.code} 個股頁`} href={`#/stock/${d.code}`} testid="etf-stock-link" />
        </List>
      </Section>
    </>
  );
}

export default function EtfDetail({ code }: { code: string }) {
  const st = useAsync(() => loadEtfDetail(code), [code]);
  // 沒有持股檔時，用清單（market.json）上的原因說明（投信擋自動抓取／資料累積中）
  const market = useAsync(() => (st.data || st.loading ? Promise.resolve(null) : loadMarket()), [code, st.loading, !!st.data]);
  const note = market.data?.active_etfs?.find((e) => e.code === code)?.holdings_note;
  const d = st.data;
  const last = d?.dates.at(-1);
  return (
    <div class="page">
      <TopBar back="/explore/etf" />
      <PageTitle title={d?.name ?? code}
        sub={d ? <span data-testid="etf-detail-sub">{[d.code, d.issuer, `持股 ${holdingsAt(d, d.dates.length - 1).length} 檔`, `持股日 ${md(last)}`].filter(Boolean).join('・')}</span> : undefined} />
      <PageStale />
      {st.error ? <ErrorState error={st.error} /> : null}
      {st.loading ? <Loading /> : null}
      {!st.loading && !st.error && !d ? (
        <Section title="持股">
          <Interp testid="etf-detail-missing"><Term id="active_etf">主動式 ETF</Term> 的持股來自各投信官網：{note ?? '這一檔的持股資料累積中（新掛牌或投信尚未公告）'}。</Interp>
          <List chev><NavRow title="股價與成交" sub={`${code} 個股頁`} href={`#/stock/${code}`} /></List>
        </Section>
      ) : null}
      {d ? <Body d={d} /> : null}
    </div>
  );
}
