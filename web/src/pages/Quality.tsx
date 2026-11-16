/**
 * 探索 › 生意體質（2026-11；#/explore/quality?s=all|mine&q=&k=）：全市場的簡式 ROIC。
 * - 一句結論＋高於／接近／低於門檻的家數。
 * - 四個走向（營收 3 年變化 × ROIC 3 年變化）：2 × 2 的家數，點一格只看那一格——公司很多時，家數比一千多個點好讀。
 * - 類型膠囊（報酬高且穩、跟著景氣走、營收增報酬降）與清單（依 ROIC 排序）。
 * 依規則計算與分類，非推薦；金融業與資料累積中的公司不列入（定義見 METHODOLOGY §18）。
 */
import { useState } from 'preact/hooks';
import { TopBar } from '../components/Chrome';
import { ErrorState, Loading } from '../components/DataStatus';
import { Conclusion, Interp } from '../components/kit';
import { Button, EmptyRow, List, Num, PageTitle, Section, Seg, Table, Tag } from '../components/ui';
import { loadSummary } from '../data/api';
import { listWatch } from '../db/db';
import { useAsync, useDb, useSegParam } from '../hooks';
import { qualityConfig, type BizKind } from '../lib/config';
import { fmtNum } from '../lib/format';
import { setListContext } from '../lib/listContext';
import { bizOverview, bizRows, kindName, overviewSentence, QUADS, quadOf, type BizRow, type Quad } from '../lib/quality';
import { navigate } from '../router';
import '../styles/explore.css';
import '../styles/quality.css';

const SCOPES = [['all', '全市場'], ['mine', '我的自選']] as const;
type Scope = (typeof SCOPES)[number][0];
const KINDS: BizKind[] = ['steady', 'cyclical', 'fading'];
const PAGE = 50;

export default function Quality() {
  const sum = useAsync(loadSummary, []);
  const watch = useDb(listWatch) ?? [];
  const [scope, setScope] = useSegParam<Scope>(SCOPES.map(([v]) => v), 'all', 's', 'quality-scope');
  const [quad, setQuad] = useState<Quad | null>(null);
  const [kind, setKind] = useState<BizKind | null>(null);
  const [shown, setShown] = useState(PAGE);

  if (sum.error) return <div class="page"><TopBar back="/explore" /><ErrorState error={sum.error} /></div>;
  if (!sum.data) return <div class="page"><TopBar back="/explore" /><PageTitle title="生意體質" /><Loading /></div>;

  const mine = new Set(watch.map((w) => w.code));
  const all = bizRows(sum.data.rows as unknown as Record<string, unknown>[]);
  const base = scope === 'mine' ? all.filter((r) => mine.has(r.code)) : all;
  const o = bizOverview(base);
  const rows = base.filter((r) => (!quad || quadOf(r) === quad) && (!kind || r.kind === kind)).sort((a, b) => b.roic - a.roic);
  const pick = <T,>(cur: T | null, v: T, set: (x: T | null) => void) => { set(cur === v ? null : v); setShown(PAGE); };
  const open = (code: string) => {
    setListContext({ name: '生意體質', codes: rows.map((r) => r.code) });
    navigate(`/stock/${code}?seg=f`);
  };
  const filterName = [quad ? QUADS.find((x) => x.id === quad)?.name : null, kind ? kindName(kind) : null].filter(Boolean).join('・');
  const years = qualityConfig.change_years;

  return (
    <div class="page" data-testid="quality-page">
      <TopBar back="/explore" />
      <PageTitle title="生意體質" sub={`簡式 ROIC・門檻 ${qualityConfig.hurdle_pct}%・依規則計算，非推薦`} />
      <Seg options={SCOPES} value={scope} onChange={(v) => { setScope(v); setQuad(null); setKind(null); setShown(PAGE); }} label="範圍" testid="quality-scope" />

      {!base.length ? (
        <Section title="總覽" testid="quality-overview">
          <List><EmptyRow testid="quality-none">{scope === 'mine'
            ? (mine.size ? '自選股裡還沒有可以計算 ROIC 的公司（金融業、ETF 與資料累積中的不列入）' : '還沒有自選股。到「我的股票」加入後，這裡會只看你的自選')
            : '資料累積中：季財報的營業利益與資產負債欄位補抓完成後，這裡會列出全市場的 ROIC'}</EmptyRow></List>
        </Section>
      ) : (
        <>
          <Section title="總覽" testid="quality-overview" info={
            <>
              <p>ROIC（簡式）＝近四季稅後營業利益 ÷（資產總計 − 流動負債）。門檻 {qualityConfig.hurdle_pct}%；上下 {qualityConfig.near_band} 個百分點以內算接近。</p>
              <p>金融業（報表沒有營業利益與流動負債）、ETF 與財報資料不足的公司不列入。</p>
              <p>數字每季財報公布後更新，依法定申報期限生效。這一頁只整理公開財報，不是推薦。</p>
            </>
          }>
            <Conclusion testid="quality-sentence">{overviewSentence(o)}</Conclusion>
            <Interp>{`${fmtNum(o.total, 0)} 檔可計算：高於門檻 ${fmtNum(o.above, 0)}・接近 ${fmtNum(o.near, 0)}・低於 ${fmtNum(o.below, 0)}`}</Interp>
          </Section>

          <Section title={`近 ${years} 年的走向`} testid="quality-quads" info={
            <>
              <p>把公司依「近四季營收比 {years} 年前增或減」與「ROIC 比 {years} 年前升或降」分成四格，數字是家數。</p>
              <p>營收變大、報酬卻變小，代表新投入的資本賺得比以前少。財報不足 {years} 年的公司不在這四格裡。</p>
            </>
          }>
            <div class="qx-grid" role="group" aria-label="四個走向（點一格只看那一格）">
              {QUADS.map((x) => (
                <button key={x.id} type="button" class="qx-cell ui-tap" aria-pressed={quad === x.id} onClick={() => pick(quad, x.id, setQuad)} data-testid={`quad-${x.id}`}>
                  <span class="qx-cell-n">{fmtNum(o.quads[x.id], 0)}<span class="ui-unit">檔</span></span>
                  <span class="qx-cell-l">{x.name}</span>
                </button>
              ))}
            </div>
            {o.unclassified ? <p class="ui-foot ui-muted qx-axis">另有 {fmtNum(o.unclassified, 0)} 檔財報不足 {years} 年，沒有分進四格</p> : null}
          </Section>

          <Section title="類型" testid="quality-kinds" info={
            <>{KINDS.map((k) => <p key={k}>{qualityConfig.labels[k].name}：{qualityConfig.labels[k].rule}。</p>)}<p>年度資料滿 {qualityConfig.history.min_years} 年才分類；都不符合的只標示高於、接近或低於門檻。依規則分類，非推薦。</p></>
          }>
            <div class="qx-chips" role="group" aria-label="類型（點一下只看那一類）">
              {KINDS.map((k) => (
                <button key={k} type="button" class="qx-chip" aria-pressed={kind === k} onClick={() => pick(kind, k, setKind)} data-testid={`kind-${k}`}>
                  {kindName(k)} {fmtNum(o.kinds[k] ?? 0, 0)}
                </button>
              ))}
            </div>
          </Section>

          <Section title={filterName || 'ROIC 由高到低'} aside={`${fmtNum(rows.length, 0)} 檔`} testid="quality-list">
            {rows.length ? (
              <div class="ui-card">
                <Table<BizRow> caption="ROIC（簡式）清單" testid="quality-table" rowKey={(r) => r.code} rows={rows.slice(0, shown)} onRow={(r) => open(r.code)} cols={[
                  { key: 'n', label: '公司', render: (r) => <><span class="qx-name">{r.name}</span><span class="qx-code ui-foot ui-muted">{r.code}</span></> },
                  { key: 'r', label: 'ROIC', align: 'r', width: '4.25rem', render: (r) => <Num v={r.roic} digits={1} unit="%" /> },
                  { key: 'c', label: `${years} 年變化`, align: 'r', width: '4.75rem', render: (r) => (r.chg === null ? '—' : `${r.chg > 0 ? '+' : r.chg < 0 ? '−' : ''}${fmtNum(Math.abs(r.chg), 1)}`) },
                  { key: 'k', label: '類型', align: 'r', width: '6.5rem', render: (r) => <Tag>{kindName(r.kind)}</Tag> },
                ]} />
                {rows.length > shown ? <div class="qx-more"><Button variant="plain" block onClick={() => setShown(shown + PAGE)} testid="quality-more">再看 {Math.min(PAGE, rows.length - shown)} 檔</Button></div> : null}
              </div>
            ) : <List><EmptyRow>這個條件下沒有公司；再點一次已選的格子或類型可以取消</EmptyRow></List>}
          </Section>
        </>
      )}
    </div>
  );
}
